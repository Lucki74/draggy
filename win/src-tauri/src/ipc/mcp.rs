//! Handlers for the MCP channels and `registry:search`. Ports of the `mcp:*` handlers in main.cjs. The server
//! table is `crate::mcp::Host`; the stored config and enabled list live in the storage key-value store.

use std::sync::Arc;

use draggy_mcp::catalogue;
use draggy_mcp::definition::ServerConfig;
use draggy_mcp::server::CallOptions;
use serde_json::{Map, Value, json};
use tauri::{AppHandle, Manager};

use super::storage::with_storage;
use super::{IpcError, Registry, emit};
use crate::AppState;
use crate::mcp::{self, Host, config};

const CONFIG_KEY: &str = "mcpServers";
const ENABLED_KEY: &str = "mcpEnabledByWorkspace";
const SCOPE: &str = "mcp";
const SAVE_FAILED: &str = "Draggy could not save the MCP settings.";

pub fn register_all(registry: &mut Registry) {
    register!(registry, "mcp:catalogue" => catalogue_list);
    register!(registry, "mcp:config" => config_list);
    register!(registry, "mcp:save" => save);
    register!(registry, "mcp:forget" => forget);
    register!(registry, "mcp:start" => start);
    register!(registry, "mcp:stop" => stop);
    register!(registry, "mcp:running" => running);
    register!(registry, "mcp:start-enabled" => start_enabled);
    register!(registry, "mcp:enabled" => enabled);
    register!(registry, "mcp:set-enabled" => set_enabled);
    register!(registry, "mcp:sign-in" => sign_in);
    register!(registry, "mcp:sign-out" => sign_out);
    register!(registry, "mcp:call" => call);
    register!(registry, "registry:search" => search);
}

fn host(app: &AppHandle) -> Arc<Host> {
    Arc::clone(&app.state::<AppState>().mcp)
}

fn arg(args: &[Value], index: usize) -> Option<&Value> {
    args.get(index)
}

/// A JSON object read from the store. Anything missing or unreadable is an empty object.
async fn read_object(app: &AppHandle, key: &'static str) -> Map<String, Value> {
    let raw = with_storage(app, SCOPE, Value::Null, move |db| {
        Ok(match db.get_value(key)? {
            Some(text) => Value::String(text),
            None => Value::Null,
        })
    })
    .await
    .unwrap_or(Value::Null);
    raw.as_str()
        .and_then(|text| serde_json::from_str::<Value>(text).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

/// Writes a JSON value to the store. False when it could not be saved.
async fn write_object(app: &AppHandle, key: &'static str, value: &Map<String, Value>) -> bool {
    let text = Value::Object(value.clone()).to_string();
    let saved = with_storage(app, SCOPE, json!({"success": false}), move |db| {
        db.set_value(key, &text)?;
        Ok(json!({"success": true}))
    })
    .await
    .unwrap_or(json!({"success": false}));
    saved.get("success") == Some(&json!(true))
}

async fn enabled_ids(app: &AppHandle) -> Vec<String> {
    let record = Value::Object(read_object(app, ENABLED_KEY).await);
    let config = read_object(app, CONFIG_KEY).await;
    config::enabled_ids(&record, &config)
}

/// The config entry with the keystore's secrets merged in, read as the core's server config.
fn server_config(app: &AppHandle, id: &str, entry: &Value) -> ServerConfig {
    let merged = config::with_secrets(entry, &mcp::owner_fields(app, id));
    serde_json::from_value(merged).unwrap_or_default()
}

async fn broadcast(app: &AppHandle) {
    let servers = host(app).list().await;
    emit(app, "mcp-state", json!({ "servers": servers }));
}

fn to_value<T: serde::Serialize>(value: &T) -> Result<Value, IpcError> {
    serde_json::to_value(value).map_err(|error| IpcError::Failed(error.to_string()))
}

async fn catalogue_list(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let shipped = catalogue::list_catalogue();
    let ids: Vec<String> = shipped.iter().map(|entry| entry.id.clone()).collect();
    let config = read_object(&app, CONFIG_KEY).await;
    let mut servers = Vec::with_capacity(shipped.len());
    for entry in &shipped {
        servers.push(to_value(entry)?);
    }
    servers.extend(config::custom_entries(&config, &ids));
    Ok(json!({ "success": true, "servers": servers }))
}

async fn config_list(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let stored = read_object(&app, CONFIG_KEY).await;
    let mut out = Map::new();
    for (id, entry) in &stored {
        let merged = config::with_secrets(entry, &mcp::owner_fields(&app, id));
        out.insert(id.clone(), merged);
    }
    Ok(json!({ "success": true, "config": out }))
}

async fn save(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = config::text(arg(&args, 0));
    let entry = arg(&args, 1).cloned().unwrap_or(Value::Null);
    let mut stored = read_object(&app, CONFIG_KEY).await;
    let known = catalogue::find_entry(&id).is_some();
    let existing = stored.get(&id).cloned();
    let plan = match config::plan_save(&id, &entry, existing.as_ref(), known, |field| {
        catalogue::is_secret_field(&id, field)
    }) {
        Ok(plan) => plan,
        Err(error) => return Ok(json!({ "success": false, "error": error })),
    };
    if let Some(fields) = &plan.secrets {
        let present: Map<String, Value> = fields
            .iter()
            .filter(|(_, value)| !config::text(Some(value)).is_empty())
            .map(|(field, value)| (field.clone(), value.clone()))
            .collect();
        if !mcp::replace_owner(&app, &id, &present) {
            return Ok(json!({ "success": false, "error": "Draggy could not save the secret." }));
        }
    }
    stored.insert(id, plan.entry);
    if !write_object(&app, CONFIG_KEY, &stored).await {
        return Ok(json!({ "success": false, "error": SAVE_FAILED }));
    }
    Ok(json!({ "success": true }))
}

async fn forget(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = config::text(arg(&args, 0));
    let mut stored = read_object(&app, CONFIG_KEY).await;
    stored.remove(&id);
    if !write_object(&app, CONFIG_KEY, &stored).await {
        return Ok(json!({ "success": false, "error": SAVE_FAILED }));
    }
    mcp::forget_owner(&app, &id);
    host(&app).stop(&id).await;
    Ok(json!({ "success": true }))
}

async fn start(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = config::text(arg(&args, 0));
    let stored = read_object(&app, CONFIG_KEY).await;
    let entry = stored.get(&id).cloned().unwrap_or_else(|| json!({}));
    let state = host(&app)
        .start(&id, &server_config(&app, &id, &entry))
        .await;
    broadcast(&app).await;
    Ok(json!({ "success": state.status == "ready", "state": to_value(&state)? }))
}

async fn stop(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = config::text(arg(&args, 0));
    host(&app).stop(&id).await;
    broadcast(&app).await;
    Ok(json!({ "success": true }))
}

async fn running(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let servers = host(&app).list().await;
    Ok(json!({ "success": true, "servers": to_value(&servers)? }))
}

async fn enabled(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    Ok(json!({ "success": true, "ids": enabled_ids(&app).await }))
}

async fn set_enabled(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = config::text(arg(&args, 0));
    let on = config::truthy(arg(&args, 1));
    let ids = config::with_enabled(enabled_ids(&app).await, &id, on);
    let record = json!({ config::DEFAULT_WORKSPACE: ids });
    let saved = record.as_object().cloned().unwrap_or_default();
    if !write_object(&app, ENABLED_KEY, &saved).await {
        return Ok(json!({ "success": false, "error": SAVE_FAILED }));
    }
    let stored = read_object(&app, CONFIG_KEY).await;
    let entry = stored.get(&id).cloned().unwrap_or_else(|| json!({}));
    if on {
        // A remote server waits to be asked: switching it on must not reach the network yet.
        if !config::truthy(entry.get("url")) {
            host(&app)
                .start(&id, &server_config(&app, &id, &entry))
                .await;
        }
    } else {
        host(&app).stop(&id).await;
    }
    broadcast(&app).await;
    Ok(json!({ "success": true, "ids": ids }))
}

async fn start_enabled(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let stored = read_object(&app, CONFIG_KEY).await;
    let host = host(&app);
    for id in enabled_ids(&app).await {
        let entry = stored.get(&id).cloned().unwrap_or_else(|| json!({}));
        // A remote server reaches the network, so it waits to be asked.
        if config::truthy(entry.get("url")) {
            continue;
        }
        host.start(&id, &server_config(&app, &id, &entry)).await;
    }
    let servers = host.list().await;
    emit(&app, "mcp-state", json!({ "servers": servers }));
    Ok(json!({ "success": true, "servers": to_value(&servers)? }))
}

async fn sign_in(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = config::text(arg(&args, 0));
    let stored = read_object(&app, CONFIG_KEY).await;
    let url = match stored.get(&id).and_then(|entry| entry.get("url")) {
        Some(Value::String(url)) if !url.is_empty() => url.clone(),
        _ => {
            return Ok(json!({ "success": false, "error": "That server is not a remote one." }));
        }
    };
    Ok(match host(&app).sign_in(&id, &url).await {
        Ok(()) => json!({ "success": true }),
        Err(error) => json!({ "success": false, "error": error }),
    })
}

async fn sign_out(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = config::text(arg(&args, 0));
    host(&app).sign_out(&id).await;
    broadcast(&app).await;
    Ok(json!({ "success": true }))
}

async fn call(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let server = config::text(arg(&args, 0));
    let tool = config::text(arg(&args, 1));
    let tool_args = arg(&args, 2)
        .filter(|value| config::truthy(Some(value)))
        .cloned()
        .unwrap_or_else(|| json!({}));
    let options = CallOptions {
        cid: arg(&args, 3).and_then(Value::as_str).map(str::to_owned),
        widgets: true,
    };
    let outcome = host(&app)
        .call_tool(&server, &tool, tool_args, &options)
        .await;
    to_value(&outcome)
}

async fn search(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let query = config::text(arg(&args, 0));
    Ok(host(&app).search(&query).await)
}

/// Moves secrets that older builds kept in the config into the keystore. Runs once at startup.
pub fn adopt_stored_credentials(app: &AppHandle) {
    let state = app.state::<AppState>();
    let Some(db) = state.storage.handle() else {
        return;
    };
    let Ok(Some(text)) = db.get_value(CONFIG_KEY) else {
        return;
    };
    let Some(stored) = serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|value| value.as_object().cloned())
    else {
        return;
    };
    let (records, moved) = config::adopt(&stored, catalogue::is_secret_field);
    if moved.is_empty() {
        return;
    }
    // A failed keystore write keeps the config as it was, so no secret is lost.
    for (owner, fields) in &moved {
        let mut all = mcp::owner_fields(app, owner);
        all.extend(fields.clone());
        if !mcp::replace_owner(app, owner, &all) {
            state
                .diag
                .warn("mcp", "could not move credentials into the store", None);
            return;
        }
    }
    let _ = db.set_value(CONFIG_KEY, &Value::Object(records).to_string());
    state.diag.info(
        "mcp",
        "credentials moved into the store",
        Some(json!({ "servers": moved.len() })),
    );
}
