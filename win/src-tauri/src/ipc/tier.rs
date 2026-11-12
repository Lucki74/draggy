//! Handlers for the tier planner channels: the model catalog with each plan on this machine, the speed of a
//! finished reply, and the report file a person attaches to a bug report. Ports of main.cjs `tier:*` and
//! tierDiagnostics.cjs.

use std::path::PathBuf;

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use super::hardware::probe_report;
use super::{IpcError, Registry};
use crate::AppState;
use crate::engines::colibri_catalog::{self, Entry};
use crate::engines::tier_planner::{self, DEFAULT_CONTEXT_TOKENS, Model};
use crate::engines::tier_stats::{self, Sample};
use crate::engines::{Engines, colibri, now_ms};
use crate::models::large_store;
use crate::pricing::build::iso_utc;

/// Engine lines kept in the report and their length cap.
const LOG_LINES: usize = 200;
const LINE_CHARS: usize = 300;
/// The newest part of the app log the report reads.
const LOG_TAIL_BYTES: usize = 512 * 1024;
const REPORT_FILE: &str = "large-models-report.json";

pub fn register_all(registry: &mut Registry) {
    register!(registry, "tier:catalog" => catalog);
    register!(registry, "tier:record" => record);
    register!(registry, "tier:report" => report);
}

/// The planner's view of a catalog entry: the colibri model with its sizes.
fn model_of(entry: &Entry) -> Model {
    Model {
        total_gb: entry.total_gb,
        dense_gb: entry.dense_gb,
        routed_gb: entry.routed_gb,
        ram_min_gb: entry.ram_min_gb,
        estimated: entry.estimated,
        kv_bytes_per_token: 60.0 * 1024.0,
    }
}

/// The volumes the probe found, where a model copy may already sit.
fn drive_volumes(hardware: &Value) -> Vec<PathBuf> {
    hardware
        .get("drives")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|drive| drive.get("volume").and_then(Value::as_str))
        .map(PathBuf::from)
        .collect()
}

/// The hardware report and every catalog entry with its plan here. A context of zero or less means the default.
async fn build_catalog(
    engines: &Engines,
    context_tokens: f64,
) -> Result<(Value, Vec<Value>), IpcError> {
    let hardware = probe_report(engines)
        .await
        .map_err(|error| IpcError::Failed(error.to_string()))?;
    let tokens = if context_tokens > 0.0 {
        context_tokens
    } else {
        DEFAULT_CONTEXT_TOKENS
    };
    let volumes = drive_volumes(&hardware);
    let models = colibri_catalog::CATALOG
        .iter()
        .map(|entry| {
            let plan = tier_planner::plan_model(&model_of(entry), &hardware, tokens);
            let plan = tier_stats::apply_observed(
                &plan,
                tier_stats::observed(&engines.user_data, entry.id),
            );
            let downloaded = large_store::locate(entry.repo, volumes.iter().map(PathBuf::as_path))
                .map(|(dir, complete)| json!({ "dir": dir, "complete": complete }));
            let mut value = serde_json::to_value(entry).unwrap_or(Value::Null);
            value["downloaded"] = downloaded.unwrap_or(Value::Null);
            value["plan"] = plan;
            value
        })
        .collect();
    Ok((hardware, models))
}

async fn catalog(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let engines = app.state::<AppState>().engines.clone();
    let tokens = args.first().and_then(Value::as_f64).unwrap_or(0.0);
    let (hardware, models) = build_catalog(&engines, tokens).await?;
    Ok(json!({ "hardware": hardware, "models": models }))
}

/// One finished reply: tokens per second from the renderer's own timing, the hit rate from the gateway.
async fn record(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let engines = app.state::<AppState>().engines.clone();
    let Some((id, _)) = engines.colibri.served().and_then(|served| served.catalog) else {
        return Ok(json!({ "recorded": false }));
    };
    let sample = args.first().cloned().unwrap_or(Value::Null);
    let tok_per_sec = sample
        .get("tokPerSec")
        .and_then(Value::as_f64)
        .unwrap_or(f64::NAN);
    let tokens = sample
        .get("tokens")
        .and_then(Value::as_f64)
        .unwrap_or(f64::NAN);
    let hit_rate = tier_stats::hit_rate_from(&engines.colibri.experts().await);
    tier_stats::record(
        &engines.user_data,
        &id,
        Sample {
            tok_per_sec,
            hit_rate,
            tokens: tokens as u32,
        },
    );
    Ok(json!({ "recorded": true }))
}

/// The engine lines of the app log: the colibri and llama lines, newest last, each capped in length.
pub fn engine_lines(log_text: &str) -> Vec<String> {
    let lines: Vec<&str> = log_text
        .lines()
        .filter(|line| line.contains("[colibri]") || line.contains("[llama]"))
        .collect();
    lines[lines.len().saturating_sub(LOG_LINES)..]
        .iter()
        .map(|line| {
            if line.chars().count() > LINE_CHARS {
                format!("{}…", line.chars().take(LINE_CHARS).collect::<String>())
            } else {
                (*line).to_owned()
            }
        })
        .collect()
}

/// One drive as the report shows it: size and free space in whole GB, with its benchmark.
fn describe_drive(drive: &Value) -> Value {
    const GB: f64 = 1024.0 * 1024.0 * 1024.0;
    let gb = |key: &str| {
        drive
            .get(key)
            .and_then(Value::as_f64)
            .map_or(Value::Null, |bytes| json!((bytes / GB).round()))
    };
    json!({
        "volume": drive.get("volume"),
        "bus": drive.get("bus"),
        "role": drive.get("role"),
        "sizeGB": gb("sizeBytes"),
        "freeGB": gb("freeBytes"),
        "benchmark": drive.get("benchmark").cloned().unwrap_or(Value::Null),
    })
}

/// The report the person attaches to a bug report. Pure: every input is passed in.
pub fn assemble_report(
    created_at: &str,
    app_version: &str,
    hardware: &Value,
    models: &[Value],
    engine: &Value,
    speeds: Value,
    log_text: &str,
) -> Value {
    let hardware_part = if hardware.is_null() {
        Value::Null
    } else {
        json!({
            "ramGB": hardware.pointer("/ram/totalGB"),
            "gpu": hardware.get("gpu"),
            "cpu": hardware.get("cpu"),
            "smartAppControl": hardware.get("smartAppControl"),
            "drives": hardware
                .get("drives")
                .and_then(Value::as_array)
                .map(|drives| drives.iter().map(describe_drive).collect::<Vec<_>>())
                .unwrap_or_default(),
        })
    };
    let plans: Vec<Value> = models
        .iter()
        .map(|entry| {
            let plan = entry.get("plan").cloned().unwrap_or(Value::Null);
            let downloaded = entry.get("downloaded").filter(|d| !d.is_null());
            json!({
                "id": entry.get("id"),
                "downloaded": downloaded.is_some(),
                "complete": downloaded.and_then(|d| d.get("complete")).and_then(Value::as_bool).unwrap_or(false),
                "refusal": plan.pointer("/refusal/reason").cloned().unwrap_or(Value::Null),
                "expectedTokPerSec": plan.get("expectedTokPerSec").cloned().unwrap_or(Value::Null),
                "expectedHitRate": plan.get("expectedHitRate").cloned().unwrap_or(Value::Null),
                "bottleneck": plan.get("bottleneck").cloned().unwrap_or(Value::Null),
                "measured": plan.get("measured").and_then(Value::as_bool).unwrap_or(false),
                "estimated": plan.get("estimated").and_then(Value::as_bool).unwrap_or(false),
                "warnings": plan.get("warnings").cloned().unwrap_or_else(|| json!([])),
            })
        })
        .collect();
    json!({
        "createdAt": created_at,
        "appVersion": app_version,
        "engine": engine,
        "hardware": hardware_part,
        "plans": plans,
        "speeds": speeds,
        "engineLog": engine_lines(log_text),
    })
}

/// Writes the report into the log folder, reveals it, and returns its path.
async fn report(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let state = app.state::<AppState>();
    let engines = state.engines.clone();
    let (hardware, models) = build_catalog(&engines, 0.0).await?;
    let runtime = colibri::runtime(&engines.user_data);
    let served = engines.colibri.served();
    let engine = json!({
        "colibri": runtime.as_ref().map(|rt| json!({ "tag": rt.tag, "variant": rt.variant })),
        "running": served.is_some(),
        "kind": served.as_ref().map(|_| "colibri"),
        "slow": served.as_ref().is_some_and(|s| s.slow),
    });
    let log_text = read_log_tail(&state.diag.dir().join("app.log"));
    let report = assemble_report(
        &iso_utc(now_ms()),
        &app.package_info().version.to_string(),
        &hardware,
        &models,
        &engine,
        tier_stats::summary(&engines.user_data),
        &log_text,
    );
    let file = state.diag.dir().join(REPORT_FILE);
    let text = serde_json::to_string_pretty(&report)
        .map_err(|error| IpcError::Failed(error.to_string()))?;
    std::fs::write(&file, text).map_err(|error| IpcError::Failed(error.to_string()))?;
    let _ = app.opener().reveal_item_in_dir(&file);
    Ok(json!({ "file": file.to_string_lossy() }))
}

/// The last part of the app log as text; empty when it cannot be read.
fn read_log_tail(path: &std::path::Path) -> String {
    let Ok(bytes) = std::fs::read(path) else {
        return String::new();
    };
    let start = bytes.len().saturating_sub(LOG_TAIL_BYTES);
    String::from_utf8_lossy(&bytes[start..]).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_lines_keep_only_engine_lines_and_the_newest() {
        let text = "a\n[colibri] one\nb\n[llama] two\n";
        assert_eq!(engine_lines(text), vec!["[colibri] one", "[llama] two"]);
        let many: String = (0..250).map(|i| format!("[colibri] {i}\n")).collect();
        let kept = engine_lines(&many);
        assert_eq!(kept.len(), LOG_LINES);
        assert_eq!(kept.last().unwrap(), "[colibri] 249");
    }

    #[test]
    fn engine_lines_cap_long_lines() {
        let long = format!("[colibri] {}", "x".repeat(400));
        let kept = engine_lines(&long);
        assert_eq!(kept[0].chars().count(), LINE_CHARS + 1);
        assert!(kept[0].ends_with('…'));
    }

    #[test]
    fn drive_sizes_round_to_whole_gb() {
        let drive = json!({ "volume": "D:\\", "sizeBytes": 2.0 * 1024.0 * 1024.0 * 1024.0 * 1.4, "freeBytes": 0.0 });
        let value = describe_drive(&drive);
        assert_eq!(value["sizeGB"], json!(3.0));
        assert_eq!(value["freeGB"], json!(0.0));
        assert_eq!(value["benchmark"], Value::Null);
    }

    #[test]
    fn report_marks_downloads_and_refusals() {
        let hardware = json!({ "ram": { "totalGB": 32.0 }, "drives": [] });
        let models = vec![json!({
            "id": "m",
            "downloaded": { "dir": "x", "complete": true },
            "plan": { "refusal": { "reason": "ram-floor" }, "warnings": ["w"] },
        })];
        let report = assemble_report(
            "2026-01-01T00:00:00Z",
            "1.0.0",
            &hardware,
            &models,
            &json!({ "running": false }),
            json!({}),
            "[colibri] ok",
        );
        assert_eq!(report["hardware"]["ramGB"], json!(32.0));
        assert_eq!(report["plans"][0]["downloaded"], json!(true));
        assert_eq!(report["plans"][0]["complete"], json!(true));
        assert_eq!(report["plans"][0]["refusal"], json!("ram-floor"));
        assert_eq!(report["engineLog"], json!(["[colibri] ok"]));
    }

    #[test]
    fn volumes_come_from_the_drive_list() {
        let hardware = json!({ "drives": [{ "volume": "D:\\" }, { "bus": "usb" }] });
        assert_eq!(drive_volumes(&hardware), vec![PathBuf::from("D:\\")]);
    }
}
