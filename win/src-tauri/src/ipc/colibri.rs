//! Handlers for the colibri engine channels: status, install, rollback, start, stop and health.

use std::path::Path;

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use super::{IpcError, Registry, emit};
use crate::AppState;
use crate::engines::colibri;
use crate::engines::{RUNNER, host_platform};
use draggy_engine::binary_manager::TarExtractor;

pub fn register_all(registry: &mut Registry) {
    register!(registry, "colibri:status" => status);
    register!(registry, "colibri:install" => install);
    register!(registry, "colibri:health" => health);
    register!(registry, "colibri:rollback" => rollback);
    register!(registry, "colibri:start" => start);
    register!(registry, "colibri:stop" => stop);
}

/// Installs the colibri engine and the Python it needs. Safe to call when it is already there.
pub async fn install_engine(app: &AppHandle) -> Value {
    let state = app.state::<AppState>();
    let engines = state.engines.clone();
    let user_data = engines.user_data.clone();
    let Some(net) = engines.net.as_ref() else {
        return json!({ "success": false, "error": "The network is not available" });
    };
    let extractor = TarExtractor::for_platform(&RUNNER, &host_platform());
    let cuda = colibri::cuda_capable().await;
    let progress = |value: Value| {
        emit(app, "colibri-install-progress", value);
    };
    let result = async {
        let installed =
            colibri::install(&user_data, net, &extractor, None, cuda, &progress).await?;
        colibri::ensure_python(&user_data, net, &extractor, &progress).await?;
        Ok::<_, String>(installed)
    }
    .await;
    match result {
        Ok(installed) => {
            json!({ "success": true, "tag": installed.tag, "variant": installed.variant })
        }
        Err(error) => {
            state
                .diag
                .warn("colibri", &format!("install failed: {error}"), None);
            json!({ "success": false, "error": error })
        }
    }
}

async fn status(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let engines = app.state::<AppState>().engines.clone();
    let engine = match engines.colibri.status() {
        Some((model, port)) => {
            json!({ "kind": "colibri", "running": true, "port": port, "model": model, "slow": false })
        }
        None => {
            json!({ "kind": null, "running": false, "port": null, "model": null, "slow": false })
        }
    };
    Ok(json!({
        "installed": colibri::runtime(&engines.user_data).is_some(),
        "state": colibri::read_state(&engines.user_data),
        "engine": engine,
    }))
}

async fn install(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    Ok(install_engine(&app).await)
}

async fn health(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let engines = app.state::<AppState>().engines.clone();
    Ok(engines.colibri.health().await)
}

async fn rollback(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let engines = app.state::<AppState>().engines.clone();
    Ok(json!({ "tag": colibri::rollback(&engines.user_data) }))
}

/// Starts a model on colibri. The engine installs itself the first time a large model needs it.
async fn start(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let options = args.first().cloned().unwrap_or(Value::Null);
    let model_name = options
        .get("modelName")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let model_dir = options
        .get("modelDir")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let engines = app.state::<AppState>().engines.clone();

    if colibri::runtime(&engines.user_data).is_none() {
        let installed = install_engine(&app).await;
        if installed["success"] != true {
            return Ok(json!({
                "success": false,
                "error": installed["error"],
                "kind": "engine-missing",
                "params": { "model": model_name },
            }));
        }
    }
    let Some(rt) = colibri::prepare_runtime(&engines.user_data) else {
        return Ok(json!({
            "success": false,
            "error": "colibri is not installed",
            "kind": "engine-missing",
            "params": { "model": model_name },
        }));
    };
    let name = model_name.unwrap_or_else(|| {
        Path::new(&model_dir)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    });
    let plan = options.get("plan").cloned().unwrap_or(Value::Null);
    let lossy = options.get("lossy").and_then(Value::as_bool) == Some(true);
    let physical = engines.topology().await.physical;
    Ok(engines
        .colibri
        .start(&rt, Path::new(&model_dir), &name, &plan, lossy, physical)
        .await)
}

async fn stop(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    app.state::<AppState>().engines.colibri.stop().await;
    Ok(json!({ "success": true }))
}
