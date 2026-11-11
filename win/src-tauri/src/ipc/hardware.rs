//! Handlers for the hardware and runner channels: system specs, the machine report, the disk benchmark and the code
//! runner's probe. Ports of main.cjs (`get-system-specs`, `hardware:*`), hardwareProbe.cjs and runner.cjs `probe`.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use draggy_engine::command::{ProcessRunner, run_text};
use draggy_engine::hardware_probe::{BenchContext, BenchRun, FileBench, Progress};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use super::{IpcError, Registry, emit};
use crate::AppState;
use crate::engines::{Engines, now_ms, sysinfo};

pub fn register_all(registry: &mut Registry) {
    register!(registry, "get-system-specs" => get_system_specs);
    register!(registry, "hardware:probe" => probe);
    register!(registry, "hardware:benchmark" => benchmark);
    register!(registry, "hardware:cancel-benchmark" => cancel_benchmark);
    register!(registry, "runner:probe" => runner_probe);
}

/// Several callers probe at once on a cold start; the same line once is enough.
static SPECS_LOGGED: AtomicBool = AtomicBool::new(false);

fn engines_of(app: &AppHandle) -> Arc<Engines> {
    Arc::clone(&app.state::<AppState>().engines)
}

async fn get_system_specs(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let state = app.state::<AppState>();
    let (specs, _) = state.engines.specs().await;
    if !SPECS_LOGGED.swap(true, Ordering::Relaxed) {
        let text = |key: &str| specs.get(key).and_then(Value::as_str).map(str::to_owned);
        let line = format!(
            "{} | {} | {} GB RAM | {} GB VRAM",
            text("cpu").unwrap_or_default(),
            text("gpu").unwrap_or_else(|| "no GPU name".to_owned()),
            specs.get("ram").and_then(Value::as_f64).unwrap_or(0.0),
            specs.get("vram").and_then(Value::as_f64).unwrap_or(0.0),
        );
        state.diag.info("specs", &line, None);
    }
    Ok(specs)
}

async fn probe(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let engines = engines_of(&app);
    let specs = engines.hardware_specs().await;
    let topology = engines.topology().await;
    let report = engines
        .probe
        .probe(Some(&specs), sysinfo::memory(), topology, now_ms() as f64)
        .await;
    serde_json::to_value(report).map_err(|error| IpcError::Failed(error.to_string()))
}

/// What `hardware:benchmark` answers for each way a run can end.
pub fn benchmark_result(run: BenchRun) -> Value {
    match run {
        BenchRun::Done {
            disk_key,
            benchmark,
        } => json!({ "ok": true, "diskKey": disk_key, "benchmark": benchmark }),
        BenchRun::Refused(reason) => json!({ "ok": false, "error": reason }),
        BenchRun::Cancelled => json!({ "ok": false, "error": "cancelled" }),
        BenchRun::Failed(detail) => json!({ "ok": false, "error": "failed", "detail": detail }),
    }
}

fn progress_value(progress: Progress) -> Value {
    json!({ "phase": progress.phase, "done": progress.done, "total": progress.total })
}

async fn benchmark(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let volume = args
        .first()
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let size_gb = args
        .get(1)
        .and_then(|options| options.get("sizeGB"))
        .and_then(Value::as_f64)
        .unwrap_or(4.0);
    let engines = engines_of(&app);
    let sink = app.clone();
    // The file work is blocking; it gets its own thread so it never holds a runtime worker.
    let run = tauri::async_runtime::spawn_blocking(move || {
        tauri::async_runtime::block_on(async move {
            let now = || now_ms() as f64;
            let random = rand_unit;
            let report = |progress: Progress| {
                emit(
                    &sink,
                    "hardware-benchmark-progress",
                    progress_value(progress),
                );
            };
            report(Progress {
                phase: "writing",
                done: 0,
                total: 1,
            });
            let ctx = BenchContext {
                now: &now,
                random: &random,
                progress: &report,
            };
            engines
                .probe
                .run_benchmark(
                    &FileBench,
                    &volume,
                    size_gb,
                    &std::process::id().to_string(),
                    &ctx,
                )
                .await
        })
    })
    .await
    .map_err(|error| IpcError::Failed(error.to_string()))?;
    let diag = &app.state::<AppState>().diag;
    match &run {
        BenchRun::Done { .. } => diag.info("engine.bench", "disk benchmark done", None),
        BenchRun::Cancelled => diag.info("engine.bench", "disk benchmark cancelled", None),
        BenchRun::Failed(_) => diag.warn("engine.bench", "disk benchmark failed", None),
        BenchRun::Refused(_) => {}
    }
    Ok(benchmark_result(run))
}

/// A value in [0, 1) for the benchmark's random reads; no cryptographic strength needed.
fn rand_unit() -> f64 {
    use std::hash::{BuildHasher, Hasher};
    let bits = std::collections::hash_map::RandomState::new()
        .build_hasher()
        .finish();
    (bits >> 11) as f64 / (1u64 << 53) as f64
}

async fn cancel_benchmark(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    Ok(Value::Bool(engines_of(&app).probe.cancel_benchmark()))
}

/// Whether Python can run here, as the code runner's first call asks.
async fn runner_probe(_app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let mut found: Option<&str> = None;
    for candidate in ["python", "py"] {
        if run_text(&ProcessRunner, candidate, &["--version"], 5000)
            .await
            .is_some()
        {
            found = Some(candidate);
            break;
        }
    }
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    };
    Ok(json!({
        "success": true,
        "python": found.is_some(),
        "pythonCommand": found,
        "javascript": true,
        "platform": format!("win32 {arch}"),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_benchmark_outcome_maps_to_the_electron_shape() {
        assert_eq!(
            benchmark_result(BenchRun::Refused("busy")),
            json!({"ok": false, "error": "busy"})
        );
        assert_eq!(
            benchmark_result(BenchRun::Cancelled),
            json!({"ok": false, "error": "cancelled"})
        );
        assert_eq!(
            benchmark_result(BenchRun::Failed("EPERM".into())),
            json!({"ok": false, "error": "failed", "detail": "EPERM"})
        );
        assert_eq!(
            benchmark_result(BenchRun::Done {
                disk_key: "k".into(),
                benchmark: json!({"at": 1})
            }),
            json!({"ok": true, "diskKey": "k", "benchmark": {"at": 1}})
        );
    }

    #[test]
    fn progress_keeps_the_renderer_field_names() {
        let value = progress_value(Progress {
            phase: "writing",
            done: 0,
            total: 1,
        });
        assert_eq!(value, json!({"phase": "writing", "done": 0, "total": 1}));
    }

    #[test]
    fn unit_randoms_stay_below_one() {
        for _ in 0..100 {
            let value = rand_unit();
            assert!((0.0..1.0).contains(&value));
        }
    }
}
