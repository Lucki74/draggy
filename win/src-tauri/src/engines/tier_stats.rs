//! Measured speed per colibri model on this computer: tokens per second and, when the gateway reports it,
//! the expert cache hit rate. Numbers only, never text. Port of electron/tierStats.cjs.
//! The file is `tier-stats.json` in the data folder; a missing or damaged file starts empty.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

const FILE: &str = "tier-stats.json";
const SMOOTHING: f64 = 0.3;
/// Replies measured before the plan's range is replaced by the measured one.
pub const MIN_SAMPLES: u32 = 3;
/// Replies shorter than this say little about steady speed.
pub const MIN_TOKENS: u32 = 16;
/// The band around a measured speed; replies vary with prompt length and cache warmth.
const BAND: f64 = 0.25;
const USAGE_DIR: &str = "colibri-usage";
const USAGE_FILE: &str = ".coli_usage";

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub tok_per_sec: f64,
    pub hit_rate: Option<f64>,
    pub samples: u32,
}

/// One finished reply: its speed, the hit rate if known, and its token count.
#[derive(Debug, Clone, Copy)]
pub struct Sample {
    pub tok_per_sec: f64,
    pub hit_rate: Option<f64>,
    pub tokens: u32,
}

fn file(dir: &Path) -> PathBuf {
    dir.join(FILE)
}

fn load(dir: &Path) -> Map<String, Value> {
    fs::read_to_string(file(dir))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| match value {
            Value::Object(map) => Some(map),
            _ => None,
        })
        .unwrap_or_default()
}

fn save(dir: &Path, map: &Map<String, Value>) {
    if let Ok(text) = serde_json::to_string(map) {
        let _ = fs::write(file(dir), text);
    }
}

fn blend(previous: Option<f64>, next: f64) -> f64 {
    previous.map_or(next, |p| p * (1.0 - SMOOTHING) + next * SMOOTHING)
}

fn entry_of(value: &Value) -> Option<Entry> {
    serde_json::from_value(value.clone()).ok()
}

/// Folds one reply into the model's running averages. Short or unusable replies are ignored.
pub fn record(dir: &Path, model_id: &str, sample: Sample) {
    let rate = sample.tok_per_sec;
    if model_id.is_empty() || !rate.is_finite() || rate <= 0.0 || sample.tokens < MIN_TOKENS {
        return;
    }
    let mut all = load(dir);
    let prev = all.get(model_id).and_then(entry_of);
    let hit = sample
        .hit_rate
        .filter(|h| h.is_finite() && (0.0..=1.0).contains(h));
    let next = Entry {
        tok_per_sec: blend(prev.map(|p| p.tok_per_sec), rate),
        hit_rate: match hit {
            None => prev.and_then(|p| p.hit_rate),
            Some(h) => Some(blend(prev.and_then(|p| p.hit_rate), h)),
        },
        samples: prev.map_or(0, |p| p.samples) + 1,
    };
    if let Ok(value) = serde_json::to_value(next) {
        all.insert(model_id.to_string(), value);
        save(dir, &all);
    }
}

/// The measured numbers of a model, or None until enough replies back them.
pub fn observed(dir: &Path, model_id: &str) -> Option<Entry> {
    load(dir)
        .get(model_id)
        .and_then(entry_of)
        .filter(|e| e.samples >= MIN_SAMPLES)
}

/// A plan whose speed range is centred on what this computer measured. Refusals and plans without speed pass through.
pub fn apply_observed(plan: &Value, entry: Option<Entry>) -> Value {
    let Some(entry) = entry else {
        return plan.clone();
    };
    let has_speed = plan.get("expectedTokPerSec").is_some_and(|v| !v.is_null());
    if plan.get("refusal").is_some() || !has_speed {
        return plan.clone();
    }
    let round = |v: f64| (v * 100.0).round() / 100.0;
    let mut out = plan.clone();
    out["expectedTokPerSec"] = json!([
        round(entry.tok_per_sec * (1.0 - BAND)),
        round(entry.tok_per_sec * (1.0 + BAND))
    ]);
    if let Some(hit) = entry.hit_rate {
        out["expectedHitRate"] = json!([round(hit), round(hit)]);
    }
    out["measured"] = json!(true);
    out
}

/// Hit rate from the gateway's `/experts` counts; None when it sends none we recognise.
pub fn hit_rate_from(experts: &Value) -> Option<f64> {
    let hits = experts.get("hits")?.as_f64()?;
    let misses = experts.get("misses")?.as_f64()?;
    if !hits.is_finite()
        || !misses.is_finite()
        || hits < 0.0
        || misses < 0.0
        || hits + misses == 0.0
    {
        return None;
    }
    Some(hits / (hits + misses))
}

/// Every model's running numbers, for the diagnostics report.
pub fn summary(dir: &Path) -> Value {
    Value::Object(load(dir))
}

/// Keeps colibri's learned hot set outside the model folder, so a re-download or a moved model keeps it.
pub fn backup_usage(user_data: &Path, model_id: &str, model_dir: &Path) -> bool {
    let source = model_dir.join(USAGE_FILE);
    if !source.exists() {
        return false;
    }
    let target_dir = user_data.join(USAGE_DIR).join(model_id);
    fs::create_dir_all(&target_dir)
        .and_then(|_| fs::copy(&source, target_dir.join(USAGE_FILE)).map(|_| ()))
        .is_ok()
}

/// Puts a backed-up history back when the model folder has none.
pub fn restore_usage(user_data: &Path, model_id: &str, model_dir: &Path) -> bool {
    let destination = model_dir.join(USAGE_FILE);
    let backup = user_data.join(USAGE_DIR).join(model_id).join(USAGE_FILE);
    if destination.exists() || !backup.exists() {
        return false;
    }
    fs::copy(&backup, &destination).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(rate: f64, tokens: u32) -> Sample {
        Sample {
            tok_per_sec: rate,
            hit_rate: Some(0.5),
            tokens,
        }
    }

    #[test]
    fn needs_min_samples_before_observed() {
        let dir = tempfile::tempdir().unwrap();
        for _ in 0..2 {
            record(dir.path(), "m", sample(4.0, 40));
        }
        assert!(observed(dir.path(), "m").is_none());
        record(dir.path(), "m", sample(4.0, 40));
        let entry = observed(dir.path(), "m").unwrap();
        assert_eq!(entry.samples, 3);
        assert!((entry.tok_per_sec - 4.0).abs() < 1e-9);
    }

    #[test]
    fn short_replies_are_ignored() {
        let dir = tempfile::tempdir().unwrap();
        record(dir.path(), "m", sample(4.0, MIN_TOKENS - 1));
        assert!(summary(dir.path()).as_object().unwrap().is_empty());
    }

    #[test]
    fn applies_band_and_skips_refusals() {
        let entry = Entry {
            tok_per_sec: 4.0,
            hit_rate: Some(0.8),
            samples: 3,
        };
        let plan = json!({ "expectedTokPerSec": [1.0, 2.0] });
        let applied = apply_observed(&plan, Some(entry));
        assert_eq!(applied["expectedTokPerSec"], json!([3.0, 5.0]));
        assert_eq!(applied["expectedHitRate"], json!([0.8, 0.8]));
        assert_eq!(applied["measured"], true);
        let refusal = json!({ "refusal": {}, "expectedTokPerSec": null });
        assert_eq!(apply_observed(&refusal, Some(entry)), refusal);
    }

    #[test]
    fn hit_rate_from_counts() {
        assert_eq!(
            hit_rate_from(&json!({ "hits": 3, "misses": 1 })),
            Some(0.75)
        );
        assert_eq!(hit_rate_from(&json!({ "hits": 0, "misses": 0 })), None);
        assert_eq!(hit_rate_from(&json!({})), None);
    }

    #[test]
    fn usage_backup_round_trip() {
        let root = tempfile::tempdir().unwrap();
        let model = root.path().join("model");
        let user = root.path().join("user");
        fs::create_dir_all(&model).unwrap();
        fs::write(model.join(USAGE_FILE), b"hot").unwrap();
        assert!(backup_usage(&user, "m", &model));
        fs::remove_file(model.join(USAGE_FILE)).unwrap();
        assert!(restore_usage(&user, "m", &model));
        assert_eq!(fs::read(model.join(USAGE_FILE)).unwrap(), b"hot");
        assert!(!restore_usage(&user, "m", &model));
    }
}
