//! Handlers for the model download and lookup channels.

use std::sync::{Arc, Mutex, PoisonError};

use draggy_models::download::Cancel;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use super::{IpcError, Registry};
use crate::AppState;
use crate::models::{drives, hub, large_store};

pub fn register_all(registry: &mut Registry) {
    register!(registry, "largemodel:plan" => plan);
    register!(registry, "largemodel:download" => download);
    register!(registry, "largemodel:cancel" => cancel);
    register!(registry, "largemodel:mirrors-get" => mirrors_get);
    register!(registry, "largemodel:mirrors-set" => mirrors_set);
    register!(registry, "search-models" => search_models);
    register!(registry, "resolve-model-url" => resolve_model_url);
    register!(registry, "model-size" => model_size);
}

/// The one repository download allowed at a time, as the Electron build kept `largeDownload`.
static ACTIVE: Mutex<Option<Arc<Cancel>>> = Mutex::new(None);

/// Holds the busy slot until dropped.
struct Busy;

impl Drop for Busy {
    fn drop(&mut self) {
        *ACTIVE.lock().unwrap_or_else(PoisonError::into_inner) = None;
    }
}

fn claim(cancel: Arc<Cancel>) -> Option<Busy> {
    let mut slot = ACTIVE.lock().unwrap_or_else(PoisonError::into_inner);
    if slot.is_some() {
        return None;
    }
    *slot = Some(cancel);
    Some(Busy)
}

fn text(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
}

fn number(value: Option<&Value>) -> f64 {
    match value {
        Some(Value::Number(number)) => number.as_f64().unwrap_or(0.0),
        Some(Value::String(text)) => text.parse().unwrap_or(0.0),
        _ => 0.0,
    }
}

fn data_dir() -> Result<std::path::PathBuf, IpcError> {
    crate::paths::data_dir(std::env::var_os("APPDATA")).map_err(IpcError::Failed)
}

async fn plan(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let repo = text(args.first());
    let client = match hub::client() {
        Ok(client) => client,
        Err(error) => return Ok(json!({ "success": false, "error": error })),
    };
    let files = match large_store::fetch_manifest(client.as_ref(), &repo).await {
        Ok(files) => files,
        Err(error) => return Ok(json!({ "success": false, "error": error })),
    };
    let target = large_store::plan_target(&repo, &files, &drives::drives());
    Ok(json!({
        "success": true,
        "files": files.len(),
        "totalBytes": large_store::total_bytes(&files),
        "target": target.to_json(),
    }))
}

async fn download(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let cancel = Arc::new(Cancel::new());
    let Some(_busy) = claim(cancel.clone()) else {
        return Ok(json!({ "ok": false, "error": "busy" }));
    };
    let options = args.first().cloned().unwrap_or(Value::Null);
    let repo = text(options.get("repo"));
    let client = match hub::client() {
        Ok(client) => client,
        Err(error) => return Ok(json!({ "ok": false, "error": error })),
    };
    let files = match large_store::fetch_manifest(client.as_ref(), &repo).await {
        Ok(files) => files,
        Err(error) => return Ok(json!({ "ok": false, "error": error })),
    };
    let volume = match large_store::plan_target(&repo, &files, &drives::drives()) {
        large_store::Target::Found { volume, .. } => volume,
        large_store::Target::Refused { reason, need_bytes } => {
            let mut refusal = json!({ "ok": false, "error": reason });
            if let Some(need) = need_bytes {
                refusal["needBytes"] = json!(need);
            }
            return Ok(refusal);
        }
    };
    let dest = match options.get("destDir").and_then(Value::as_str) {
        Some(dir) if !dir.is_empty() => std::path::PathBuf::from(dir),
        _ => large_store::default_dir(&volume, &repo),
    };
    let diag = Some(app.state::<AppState>().diag.clone());
    let emitter = app.clone();
    let request = large_store::Request {
        repo,
        files,
        dest,
        bandwidth_bps: number(options.get("bandwidthBps")).max(0.0) as u64,
        cancel,
        diag,
        progress: Arc::new(move |progress| {
            crate::ipc::emit(&emitter, "largemodel-progress", progress);
        }),
    };
    Ok(large_store::download_repo(client, request).await)
}

async fn cancel(_app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let active = ACTIVE
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone();
    if let Some(cancel) = active {
        cancel.cancel();
    }
    Ok(json!({ "success": true }))
}

async fn mirrors_get(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let store = large_store::Mirrors::new(&data_dir()?);
    Ok(store.get(&text(args.first())))
}

async fn mirrors_set(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let store = large_store::Mirrors::new(&data_dir()?);
    let paths = match args.get(1) {
        Some(Value::Array(paths)) => paths.clone(),
        _ => Vec::new(),
    };
    store
        .set(&text(args.first()), &paths)
        .map_err(IpcError::Failed)
}

async fn search_models(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let query = text(args.first());
    let hub = match hub::hub() {
        Ok(hub) => hub,
        Err(error) => return Ok(json!({ "success": false, "error": error })),
    };
    let models = hub.search(&query, hub::now_ms()).await;
    Ok(json!({ "success": true, "models": models }))
}

async fn model_size(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let name = text(args.first());
    let tag = match args.get(1) {
        Some(Value::String(tag)) if !tag.is_empty() => tag.clone(),
        _ => "latest".to_owned(),
    };
    let hub = match hub::hub() {
        Ok(hub) => hub,
        Err(error) => return Ok(json!({ "success": false, "error": error })),
    };
    Ok(match hub.model_size(&name, &tag).await {
        Some(bytes) => json!({ "success": true, "bytes": bytes }),
        None => json!({ "success": false, "error": "Size lookup unavailable" }),
    })
}

async fn resolve_model_url(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let reference = text(args.first());
    let include_draft = args
        .get(1)
        .and_then(|options| options.get("includeDraft"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let hub = hub::hub().map_err(IpcError::Failed)?;
    let download = hub.resolve_download(&reference, include_draft).await;
    Ok(serde_json::to_value(download).unwrap_or(Value::Null))
}
