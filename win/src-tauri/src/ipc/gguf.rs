//! Handlers for the GGUF engine channels. Port of the `gguf:*` handlers in main.cjs and the glue around them.

use std::path::PathBuf;
use std::sync::Arc;

use draggy_engine::binary_manager::{
    DownloadProgress, SetupOutcome, TarExtractor, Toolkit, engine_environment, ensure_engine_ready,
    find_llama_binary, has_nvidia_driver, read_engine_meta,
};
use draggy_engine::command::ProcessRunner;
use draggy_engine::engine_updater::{confirm_engine, is_unconfirmed, rollback_engine};
use draggy_engine::llama_args::MoeStream;
use draggy_engine::llama_process::{StartFailure, StartRequest, Started};
use draggy_models::download::{DownloadError, DownloadRequest, Phase, Progress};
use draggy_models::draft_pairing::plan_draft;
use draggy_models::model_storage::{ModelEntry, delete_gguf_model, list_gguf_models};
use serde_json::{Map, Value, json};
use tauri::{AppHandle, Manager};

use super::{IpcError, Registry, emit};
use crate::AppState;
use crate::engines::load_stage::StageWatch;
use crate::engines::{host_platform, locked, now_ms};

pub fn register_all(registry: &mut Registry) {
    register!(registry, "gguf:status" => status);
    register!(registry, "gguf:setup-engine" => setup_engine);
    register!(registry, "gguf:start" => start);
    register!(registry, "gguf:stop" => stop);
    register!(registry, "gguf:models" => models);
    register!(registry, "gguf:delete" => delete);
    register!(registry, "gguf:download" => download);
    register!(registry, "gguf:cancel-download" => cancel_download);
}

const DEFAULT_PORT: u16 = 11435;

fn text_arg(args: &[Value], index: usize) -> String {
    args.get(index)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn system_root() -> PathBuf {
    PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()))
}

fn nvidia() -> bool {
    has_nvidia_driver(&host_platform(), &system_root())
}

/// Electron's `sanitizeMoeStream`: a stream setting from the renderer is only used when its numbers make sense.
pub fn sanitize_moe_stream(value: Option<&Value>) -> Option<MoeStream> {
    let object = value?.as_object()?;
    let number = |key: &str| object.get(key).and_then(Value::as_f64);
    let cache_gb = number("cacheGB").filter(|n| n.is_finite() && *n > 0.0)?;
    Some(MoeStream {
        cache_gb: cache_gb.min(4096.0),
        io_threads: number("ioThreads")
            .filter(|n| n.is_finite() && *n > 0.0)
            .map(|n| (n.floor() as i64).min(64)),
        direct: object.get("direct").and_then(Value::as_bool) == Some(true),
        vram_slots: number("vramSlots")
            .filter(|n| n.is_finite() && *n > 0.0)
            .map_or(0.0, |n| n.min(100_000.0)),
    })
}

pub fn failure_value(failure: &StartFailure) -> Value {
    let params: Map<String, Value> = failure
        .params
        .iter()
        .map(|(key, value)| ((*key).to_owned(), json!(value)))
        .collect();
    json!({
        "success": false,
        "error": failure.error,
        "kind": failure.kind.as_str(),
        "params": params,
    })
}

pub fn started_value(started: &Started) -> Value {
    let mut value = json!({ "success": true, "port": started.port });
    if let Some(size) = started.context_size {
        value["contextSize"] = json!(size);
    }
    if started.already_running {
        value["alreadyRunning"] = json!(true);
    }
    if started.projector_refused {
        value["projectorRefused"] = json!(true);
    }
    value
}

pub fn model_value(entry: &ModelEntry) -> Value {
    json!({
        "name": entry.filename,
        "filename": entry.filename,
        "size": entry.size,
        "path": entry.path.to_string_lossy(),
        "architecture": entry.architecture,
        "contextLength": entry.context_length,
        "blockCount": entry.block_count,
        "fileType": entry.file_type,
        "capabilities": entry.capabilities,
    })
}

pub fn progress_value(progress: &Progress, label: &str) -> Value {
    let phase = match progress.phase {
        Phase::Preparing => "preparing",
        Phase::Downloading => "downloading",
        Phase::Done => "done",
    };
    json!({
        "phase": phase,
        "completed": progress.completed,
        "total": progress.total,
        "percent": progress.percent,
        "remainingSeconds": progress.remaining_seconds,
        "label": label,
    })
}

fn setup_progress_value(progress: &DownloadProgress) -> Value {
    json!({
        "percent": progress.percent,
        "completed": progress.completed,
        "total": progress.total,
        "phase": progress.phase,
        "label": progress.label,
    })
}

async fn status(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let state = app.state::<AppState>();
    state.diag.debug("gguf", "gguf:status requested", None);
    let engines = &state.engines;
    let (_, vram) = engines.specs().await;
    let platform = host_platform();
    let env = engine_environment(&platform, &engines.user_data, vram, None, nvidia());
    let server = engines.llama().await.status();
    let has_binary = env.binary_path.is_some();
    let ready = has_binary && (env.runner_type != "cpu" || vram <= 0.0);
    let build = read_engine_meta(&platform.engine_dir(&engines.user_data))
        .get("tag")
        .cloned()
        .filter(|tag| tag.as_str().is_some_and(|s| !s.is_empty()))
        .unwrap_or(Value::Null);
    let offload = server
        .offload
        .map(|o| json!({ "layers": o.layers, "total": o.total }));
    Ok(json!({
        "running": server.running,
        "port": server.port,
        "model": server.model.map(|p| p.to_string_lossy().into_owned()),
        "contextSize": server.context_size,
        "offload": offload,
        "speculation": server.speculation.as_str(),
        "baseUrl": server.base_url,
        "hasBinary": has_binary,
        "ready": ready,
        "runnerType": env.runner_type,
        "engineBuild": build,
        "modelsDir": engines.models_dir.to_string_lossy(),
    }))
}

async fn setup_engine(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let state = app.state::<AppState>();
    state.diag.info("gguf", "gguf:setup-engine requested", None);
    let engines = &state.engines;
    let Some(net) = engines.net.as_ref() else {
        return Ok(
            json!({ "success": false, "runnerType": "cpu", "error": "network unavailable" }),
        );
    };
    let (_, vram) = engines.specs().await;
    let platform = host_platform();
    let runner = ProcessRunner;
    let extractor = TarExtractor::for_platform(&runner, &platform);
    let clock = now_ms;
    let kit = Toolkit {
        runner: &runner,
        downloader: net,
        extractor: &extractor,
        policy: &engines.policy,
        clock: &clock,
    };
    let sink = app.clone();
    let report = move |progress: DownloadProgress| {
        let value = setup_progress_value(&progress);
        emit(&sink, "gguf:progress", value.clone());
        emit(&sink, "download-progress", value);
    };
    let outcome =
        ensure_engine_ready(&kit, &platform, &engines.user_data, vram, nvidia(), &report).await;
    let (ready, runner_type, error) = match outcome {
        SetupOutcome::Ready { runner_type, .. } => (true, runner_type, Value::Null),
        SetupOutcome::NotReady { error } => (false, "cpu", json!(error)),
    };
    state.diag.info(
        "gguf",
        &format!("gguf:setup-engine result: ready={ready} runner={runner_type}"),
        None,
    );
    Ok(json!({ "success": ready, "runnerType": runner_type, "error": error }))
}

async fn start(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let state = app.state::<AppState>();
    let engines = Arc::clone(&state.engines);
    let model_arg = text_arg(&args, 0);
    let options = args.get(1).cloned().unwrap_or(Value::Null);
    let context = options
        .get("contextSize")
        .and_then(Value::as_f64)
        .filter(|n| *n > 0.0)
        .map(|n| n as u64);
    state.diag.info(
        "gguf",
        &format!(
            "gguf:start model={model_arg} context={}",
            context.map_or_else(|| "undefined".to_owned(), |c| c.to_string())
        ),
        None,
    );
    let platform = host_platform();
    let Some(binary) = find_llama_binary(&platform, Some(&engines.user_data)) else {
        state.diag.error(
            "gguf",
            "gguf:start failed: llama-server binary not found",
            None,
        );
        return Ok(json!({
            "success": false,
            "error": "llama-server binary not found",
            "kind": "engine-missing",
        }));
    };
    let model = {
        let given = PathBuf::from(&model_arg);
        if given.is_absolute() {
            given
        } else {
            engines.models_dir.join(given)
        }
    };
    let (_, vram) = engines.specs().await;
    let nvidia = nvidia();
    let llama = engines.llama().await;
    let build_request = |binary: PathBuf| {
        let environment =
            engine_environment(&platform, &engines.user_data, vram, Some(&binary), nvidia);
        let mut request = StartRequest::new(binary, model.clone());
        request.load_watch = Some(Arc::new(StageWatch::new({
            let app = app.clone();
            move |event| {
                emit(&app, "gguf:stage", event);
            }
        })));
        request.context = context;
        request.port = Some(
            options
                .get("port")
                .and_then(Value::as_u64)
                .filter(|p| *p > 0 && *p <= u64::from(u16::MAX))
                .map_or(DEFAULT_PORT, |p| p as u16),
        );
        request.gpu_layers = options.get("gpuLayers").and_then(Value::as_i64);
        request.user_data = Some(engines.user_data.clone());
        request.vram_gb = vram;
        request.engine = Some(environment);
        request.exact_context = options.get("exactContext").is_some_and(truthy);
        request.moe_stream = sanitize_moe_stream(options.get("moeStream"));
        request
    };
    let mut result = llama.start(build_request(binary)).await;
    if result.is_ok() {
        confirm_engine(&platform, &engines.user_data);
    } else if let Err(failure) = &result
        && failure.kind.as_str() == "stopped-loading"
        && is_unconfirmed(&platform, &engines.user_data)
    {
        // A new engine that crashed on its first load goes back to the one that worked.
        state.diag.warn(
            "gguf",
            "new engine crashed on first load; rolling back",
            None,
        );
        let outcome = rollback_engine(&platform, &engines.user_data);
        if outcome.rolled_back
            && let Some(restored) = find_llama_binary(&platform, Some(&engines.user_data))
        {
            result = llama.start(build_request(restored)).await;
            if result.is_ok() {
                confirm_engine(&platform, &engines.user_data);
            }
        }
    }
    let value = match &result {
        Ok(started) => started_value(started),
        Err(failure) => failure_value(failure),
    };
    state.diag.info(
        "gguf",
        &format!("gguf:start result: success={}", result.is_ok()),
        None,
    );
    Ok(value)
}

fn truthy(value: &Value) -> bool {
    match value {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|n| n != 0.0),
        Value::String(s) => !s.is_empty(),
        Value::Null => false,
        _ => true,
    }
}

async fn stop(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let state = app.state::<AppState>();
    state.diag.info("gguf", "gguf:stop requested", None);
    state.engines.llama().await.stop().await;
    Ok(json!({ "success": true }))
}

async fn models(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let state = app.state::<AppState>();
    state
        .diag
        .debug("gguf", "gguf:models listing requested", None);
    let engines = Arc::clone(&state.engines);
    let list = tauri::async_runtime::spawn_blocking(move || {
        let projectors = locked(&engines.projectors);
        let mut cache = locked(&engines.capabilities);
        list_gguf_models(&engines.models_dir, &projectors, &mut cache)
    })
    .await
    .map_err(|error| IpcError::Failed(error.to_string()))?
    .map_err(|error| IpcError::Failed(error.to_string()))?;
    Ok(Value::Array(list.iter().map(model_value).collect()))
}

async fn delete(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let state = app.state::<AppState>();
    let filename = text_arg(&args, 0);
    state
        .diag
        .info("gguf", &format!("gguf:delete requested: {filename}"), None);
    let dir = state.engines.models_dir.clone();
    let removed =
        delete_gguf_model(&dir, &filename).map_err(|error| IpcError::Failed(error.to_string()))?;
    Ok(json!({ "success": removed }))
}

async fn download(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let state = app.state::<AppState>();
    let url = text_arg(&args, 0);
    let filename = text_arg(&args, 1);
    let engines = Arc::clone(&state.engines);
    let Some(downloader) = engines.models_dl.as_ref() else {
        return Err(IpcError::Failed("network unavailable".into()));
    };
    let sink = app.clone();
    let label = filename.clone();
    let request = DownloadRequest::new(url, &engines.models_dir, &filename);
    let result = downloader
        .download(request, move |progress| {
            let value = progress_value(&progress, &label);
            emit(&sink, "gguf:progress", value.clone());
            emit(&sink, "download-progress", value);
        })
        .await;
    match result {
        Ok(done) => {
            fetch_family_draft(&app, &done.path).await;
            Ok(json!({
                "success": true,
                "path": done.path.to_string_lossy(),
                "filename": done.filename,
            }))
        }
        Err(DownloadError::Cancelled) => Ok(json!({ "success": false, "cancelled": true })),
        Err(error) => Err(IpcError::Failed(error.to_string())),
    }
}

/// Best effort: the family's draft model rides along with the main download, and a failure here never fails it.
async fn fetch_family_draft(app: &AppHandle, model_path: &std::path::Path) {
    let state = app.state::<AppState>();
    let engines = &state.engines;
    let Some(downloader) = engines.models_dl.as_ref() else {
        return;
    };
    let Some(plan) = plan_draft(model_path) else {
        return;
    };
    if engines.models_dir.join(&plan.filename).exists() {
        return;
    }
    let sink = app.clone();
    let label = plan.filename.clone();
    let request = DownloadRequest::new(plan.url, &engines.models_dir, &plan.filename);
    let outcome = downloader
        .download(request, move |progress| {
            let value = progress_value(&progress, &label);
            emit(&sink, "gguf:progress", value.clone());
            emit(&sink, "download-progress", value);
        })
        .await;
    if outcome.is_err() {
        state
            .diag
            .warn("gguf", "family draft download failed", None);
    }
}

async fn cancel_download(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let state = app.state::<AppState>();
    let filename = text_arg(&args, 0);
    state.diag.info(
        "gguf",
        &format!("gguf:cancel-download requested: {filename}"),
        None,
    );
    if let Some(downloader) = state.engines.models_dl.as_ref() {
        downloader.cancel(&state.engines.models_dir, &filename, false);
    }
    Ok(json!({ "success": true }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn moe_stream_needs_a_positive_cache() {
        assert!(sanitize_moe_stream(None).is_none());
        assert!(sanitize_moe_stream(Some(&json!({"cacheGB": 0}))).is_none());
        assert!(sanitize_moe_stream(Some(&json!("x"))).is_none());
    }

    #[test]
    fn moe_stream_caps_its_numbers() {
        let moe = sanitize_moe_stream(Some(&json!({
            "cacheGB": 9999, "ioThreads": 100.7, "direct": true, "vramSlots": 1e9
        })))
        .expect("valid");
        assert_eq!(moe.cache_gb, 4096.0);
        assert_eq!(moe.io_threads, Some(64));
        assert!(moe.direct);
        assert_eq!(moe.vram_slots, 100_000.0);
        let plain = sanitize_moe_stream(Some(&json!({"cacheGB": 2, "direct": 1}))).expect("valid");
        assert!(!plain.direct);
        assert_eq!(plain.io_threads, None);
    }

    #[test]
    fn started_value_lists_only_the_flags_that_are_set() {
        let started = Started {
            port: 11435,
            context_size: None,
            already_running: false,
            projector_refused: false,
        };
        assert_eq!(
            started_value(&started),
            json!({"success": true, "port": 11435})
        );
        let full = Started {
            port: 1,
            context_size: Some(4096),
            already_running: true,
            projector_refused: true,
        };
        assert_eq!(
            started_value(&full),
            json!({"success": true, "port": 1, "contextSize": 4096,
                   "alreadyRunning": true, "projectorRefused": true})
        );
    }

    #[test]
    fn failure_value_carries_kind_and_params() {
        let mut params = BTreeMap::new();
        params.insert("port", "11435".to_owned());
        let failure = StartFailure {
            kind: draggy_engine::llama_process::FailureKind::PortInUse,
            error: "busy".into(),
            params,
        };
        let value = failure_value(&failure);
        assert_eq!(value["success"], json!(false));
        assert_eq!(value["params"]["port"], json!("11435"));
        assert_eq!(value["kind"], json!(failure.kind.as_str()));
    }

    #[test]
    fn model_entries_keep_the_electron_fields() {
        let entry = ModelEntry {
            filename: "a.gguf".into(),
            size: 5,
            path: PathBuf::from("m/a.gguf"),
            architecture: "llama".into(),
            context_length: None,
            block_count: Some(32.0),
            file_type: None,
            capabilities: vec!["vision".into()],
        };
        let value = model_value(&entry);
        assert_eq!(value["name"], value["filename"]);
        assert_eq!(value["contextLength"], Value::Null);
        assert_eq!(value["blockCount"], json!(32.0));
    }

    #[test]
    fn download_progress_uses_renderer_field_names() {
        let value = progress_value(
            &Progress {
                phase: Phase::Downloading,
                completed: 1,
                total: 2,
                percent: 50.0,
                remaining_seconds: None,
            },
            "a.gguf",
        );
        assert_eq!(value["phase"], json!("downloading"));
        assert_eq!(value["remainingSeconds"], Value::Null);
        assert_eq!(value["label"], json!("a.gguf"));
    }
}
