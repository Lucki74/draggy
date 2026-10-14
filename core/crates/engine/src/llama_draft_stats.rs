//! How well each model's draft has guessed, kept across runs in `draft-stats.json`. A draft that is mostly rejected
//! costs more than it saves, so the draft settings follow what was measured. Port of electron/draftStats.cjs.

use std::fs;
use std::path::Path;

use serde_json::{Map, Value, json};

use crate::llama_output::Acceptance;

const FILE: &str = "draft-stats.json";
/// Weight of the newest reply in the running average.
const SMOOTHING: f64 = 0.3;
/// Replies measured before a verdict is trusted.
const MIN_SAMPLES: f64 = 3.0;
/// Below this acceptance rate the draft slows generation down.
const DISABLE_BELOW: f64 = 0.3;
const DEFAULT_MAX: u64 = 8;

/// Whether to use a model's draft at all, and how many tokens it drafts per step.
#[derive(Debug, Clone, PartialEq)]
pub struct DraftSettings {
    pub enabled: bool,
    pub max: u64,
    pub rate: Option<f64>,
}

/// Settings for a model nothing has measured: draft, eight tokens at a time.
pub fn default_settings() -> DraftSettings {
    DraftSettings {
        enabled: true,
        max: DEFAULT_MAX,
        rate: None,
    }
}

/// Entries are keyed by the lowercased file name, so a model keeps its record across folders.
fn key_of(model: &Path) -> String {
    file_name_of(&model.to_string_lossy(), cfg!(windows)).to_lowercase()
}

/// The last component of a path, split on the separators the platform's basename splits on, as the reference does.
fn file_name_of(path: &str, windows: bool) -> &str {
    let trimmed = path.trim_end_matches(|c| c == '/' || (windows && c == '\\'));
    let split = if windows {
        trimmed.rfind(['/', '\\'])
    } else {
        trimmed.rfind('/')
    };
    split.map_or(trimmed, |at| &trimmed[at + 1..])
}

/// The stored entries, or none when the file is missing or unreadable, which measures again.
fn load(dir: &Path) -> Map<String, Value> {
    let text = match fs::read_to_string(dir.join(FILE)) {
        Ok(text) => text,
        Err(_) => return Map::new(),
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(map)) => map,
        _ => Map::new(),
    }
}

fn save(dir: &Path, entries: &Map<String, Value>) {
    let text = Value::Object(entries.clone()).to_string();
    if let Err(error) = fs::write(dir.join(FILE), text) {
        tracing::debug!(target: "files", error = %error, "draft stats not saved");
    }
}

/// Folds one reply's acceptance into the model's running average.
pub fn record(dir: &Path, model: &Path, sample: Acceptance) {
    if sample.generated == 0 {
        return;
    }
    let mut entries = load(dir);
    let key = key_of(model);
    let mut entry = entries
        .get(&key)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let samples = entry.get("samples").and_then(Value::as_f64).unwrap_or(0.0);
    let rate = if samples == 0.0 {
        sample.rate
    } else {
        let previous = entry
            .get("rate")
            .and_then(Value::as_f64)
            .unwrap_or(f64::NAN);
        previous * (1.0 - SMOOTHING) + sample.rate * SMOOTHING
    };
    entry.insert("rate".to_owned(), json!(rate));
    entry.insert("samples".to_owned(), json!(samples + 1.0));
    entries.insert(key, Value::Object(entry));
    save(dir, &entries);
}

/// Remembers that the engine would not load this model's draft, so it is not tried again.
pub fn record_refusal(dir: &Path, model: &Path) {
    let mut entries = load(dir);
    let key = key_of(model);
    let mut entry = entries
        .get(&key)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_else(|| {
            let mut fresh = Map::new();
            fresh.insert("rate".to_owned(), json!(0));
            fresh.insert("samples".to_owned(), json!(0));
            fresh
        });
    entry.insert("refused".to_owned(), Value::Bool(true));
    entries.insert(key, Value::Object(entry));
    save(dir, &entries);
}

/// Whether the engine was found to refuse this model's draft, so it is not tried again.
pub fn is_refused(dir: &Path, model: &Path) -> bool {
    load(dir)
        .get(&key_of(model))
        .and_then(Value::as_object)
        .and_then(|entry| entry.get("refused"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// The draft settings for a model. Without a folder to read from, nothing has been measured.
pub fn draft_settings(dir: Option<&Path>, model: &Path) -> DraftSettings {
    let Some(dir) = dir else {
        return default_settings();
    };
    let entries = load(dir);
    let entry = entries.get(&key_of(model)).and_then(Value::as_object);
    let Some(entry) = entry else {
        return default_settings();
    };
    let refused = entry
        .get("refused")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let rate = entry.get("rate").and_then(Value::as_f64);
    let samples = entry.get("samples").and_then(Value::as_f64);
    if samples.is_some_and(|count| count < MIN_SAMPLES) {
        return DraftSettings {
            enabled: !refused,
            max: DEFAULT_MAX,
            rate,
        };
    }
    if refused || rate.is_some_and(|value| value < DISABLE_BELOW) {
        return DraftSettings {
            enabled: false,
            max: 0,
            rate,
        };
    }
    let max = match rate {
        Some(value) if value >= 0.8 => 16,
        Some(value) if value >= 0.6 => 12,
        Some(value) if value >= 0.45 => 8,
        _ => 4,
    };
    DraftSettings {
        enabled: true,
        max,
        rate,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(accepted: u64, generated: u64) -> Acceptance {
        Acceptance {
            rate: accepted as f64 / generated as f64,
            accepted,
            generated,
        }
    }

    fn model() -> &'static Path {
        Path::new("models/Qwen-7B-Q4.gguf")
    }

    #[test]
    fn a_reply_is_folded_into_a_running_average() {
        let dir = tempfile::tempdir().expect("temp dir");
        record(dir.path(), model(), sample(8, 10));
        record(dir.path(), model(), sample(2, 10));
        let entry = load(dir.path());
        let stored = entry["qwen-7b-q4.gguf"].as_object().expect("entry");
        assert_eq!(stored["samples"], json!(2.0));
        let expected = 0.8 * 0.7 + 0.2 * 0.3;
        assert!((stored["rate"].as_f64().expect("rate") - expected).abs() < 1e-12);
    }

    #[test]
    fn a_draft_that_is_mostly_rejected_is_switched_off() {
        let dir = tempfile::tempdir().expect("temp dir");
        for _ in 0..3 {
            record(dir.path(), model(), sample(1, 10));
        }
        let settings = draft_settings(Some(dir.path()), model());
        assert!(!settings.enabled);
        assert_eq!(settings.max, 0);
        assert!(settings.rate.is_some_and(|rate| (rate - 0.1).abs() < 1e-9));
    }

    #[test]
    fn a_well_guessing_draft_is_asked_for_longer_runs() {
        let dir = tempfile::tempdir().expect("temp dir");
        for _ in 0..3 {
            record(dir.path(), model(), sample(9, 10));
        }
        assert_eq!(draft_settings(Some(dir.path()), model()).max, 16);
    }

    #[test]
    fn an_unmeasured_model_drafts_eight_tokens() {
        let dir = tempfile::tempdir().expect("temp dir");
        assert_eq!(
            draft_settings(Some(dir.path()), model()),
            default_settings()
        );
        assert_eq!(draft_settings(None, model()), default_settings());
    }

    #[test]
    fn a_refusal_turns_the_draft_off() {
        let dir = tempfile::tempdir().expect("temp dir");
        record_refusal(dir.path(), model());
        assert!(!draft_settings(Some(dir.path()), model()).enabled);
    }

    fn stored_with(dir: &Path, text: &str) {
        fs::write(dir.join(FILE), text).expect("stats");
    }

    #[test]
    fn a_model_is_keyed_by_its_file_name_on_each_platform() {
        assert_eq!(file_name_of("/m/Seer.GGUF/", false), "Seer.GGUF");
        assert_eq!(file_name_of("C:\\Models\\Seer.gguf", true), "Seer.gguf");
        assert_eq!(
            file_name_of("C:\\Models\\Seer.gguf", false),
            "C:\\Models\\Seer.gguf"
        );
        assert_eq!(
            key_of(Path::new("D:\\x\\Qwen-7B.gguf")),
            if cfg!(windows) {
                "qwen-7b.gguf"
            } else {
                "d:\\x\\qwen-7b.gguf"
            }
        );
    }

    #[test]
    fn a_high_rate_before_three_replies_still_drafts_eight_tokens() {
        let dir = tempfile::tempdir().expect("temp dir");
        stored_with(
            dir.path(),
            r#"{"qwen-7b-q4.gguf":{"rate":0.95,"samples":2}}"#,
        );
        assert_eq!(
            draft_settings(Some(dir.path()), model()),
            DraftSettings {
                enabled: true,
                max: 8,
                rate: Some(0.95),
            }
        );
    }

    #[test]
    fn the_draft_length_follows_the_measured_rate_in_tiers() {
        let dir = tempfile::tempdir().expect("temp dir");
        let cases = [
            (0.9, 16),
            (0.8, 16),
            (0.79, 12),
            (0.6, 12),
            (0.59, 8),
            (0.45, 8),
            (0.44, 4),
            (0.3, 4),
        ];
        for (rate, max) in cases {
            stored_with(
                dir.path(),
                &format!(r#"{{"qwen-7b-q4.gguf":{{"rate":{rate},"samples":5}}}}"#),
            );
            let settings = draft_settings(Some(dir.path()), model());
            assert!(settings.enabled, "rate {rate}");
            assert_eq!(settings.max, max, "rate {rate}");
        }
    }

    #[test]
    fn a_rate_just_under_the_floor_turns_the_draft_off() {
        let dir = tempfile::tempdir().expect("temp dir");
        stored_with(
            dir.path(),
            r#"{"qwen-7b-q4.gguf":{"rate":0.29,"samples":5}}"#,
        );
        assert_eq!(
            draft_settings(Some(dir.path()), model()),
            DraftSettings {
                enabled: false,
                max: 0,
                rate: Some(0.29),
            }
        );
    }

    #[test]
    fn a_refusal_is_remembered_for_the_model_in_any_folder() {
        let dir = tempfile::tempdir().expect("temp dir");
        assert!(!is_refused(dir.path(), model()));
        record_refusal(dir.path(), model());
        assert!(is_refused(
            dir.path(),
            Path::new("/elsewhere/QWEN-7B-Q4.gguf")
        ));
        assert!(!is_refused(dir.path(), Path::new("other.gguf")));
    }

    #[test]
    fn a_report_with_nothing_generated_is_not_recorded() {
        let dir = tempfile::tempdir().expect("temp dir");
        record(
            dir.path(),
            model(),
            Acceptance {
                rate: 0.0,
                accepted: 0,
                generated: 0,
            },
        );
        assert!(!dir.path().join(FILE).exists());
    }
}
