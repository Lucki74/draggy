//! Handlers for the research channels. The saved runs live in library.db beside the library index, as in Electron.

use serde_json::{Value, json};
use tauri::AppHandle;

use super::library::research::{get_run, list_runs, remove_run, save_run, search};
use super::library::{data_dir, db};
use super::storage::js_string;
use super::{IpcError, Registry};

const LIST_LIMIT: i64 = 100;
const SEARCH_LIMIT: i64 = 20;

pub fn register_all(registry: &mut Registry) {
    register!(registry, "research:list" => list);
    register!(registry, "research:get" => get);
    register!(registry, "research:save" => save);
    register!(registry, "research:remove" => remove);
    register!(registry, "research:search" => search_runs);
}

fn failure(error: String) -> Value {
    json!({ "success": false, "error": error })
}

async fn list(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let workspace = js_string(args.first());
    let dir = data_dir(&app);
    Ok(
        match db(&dir, move |s| {
            let scope = (!workspace.is_empty()).then_some(workspace);
            list_runs(s.conn(), scope.as_deref(), LIST_LIMIT)
        })
        .await
        {
            Ok(runs) => json!({ "success": true, "runs": runs }),
            Err(error) => failure(error),
        },
    )
}

async fn get(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = js_string(args.first());
    let dir = data_dir(&app);
    Ok(match db(&dir, move |s| get_run(s.conn(), &id)).await {
        Ok(run) => json!({ "success": true, "run": run }),
        Err(error) => failure(error),
    })
}

async fn save(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let run = args.into_iter().next().unwrap_or(Value::Null);
    let dir = data_dir(&app);
    Ok(
        match db(&dir, move |s| save_run(s.conn_mut(), &run)).await {
            Ok(()) => json!({ "success": true }),
            Err(error) => failure(error),
        },
    )
}

async fn remove(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = js_string(args.first());
    let dir = data_dir(&app);
    Ok(
        match db(&dir, move |s| remove_run(s.conn_mut(), &id)).await {
            Ok(()) => json!({ "success": true }),
            Err(error) => failure(error),
        },
    )
}

async fn search_runs(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let query = js_string(args.first());
    let options = args.get(1).cloned().unwrap_or(Value::Null);
    let run_id = match options.get("runId") {
        Some(Value::String(text)) if !text.is_empty() => Some(text.clone()),
        _ => None,
    };
    let limit = options
        .get("limit")
        .and_then(Value::as_f64)
        .map_or(SEARCH_LIMIT, |n| n.max(0.0) as i64);
    let dir = data_dir(&app);
    Ok(
        match db(&dir, move |s| {
            search(s.conn(), &query, run_id.as_deref(), limit)
        })
        .await
        {
            Ok(hits) => json!({ "success": true, "hits": hits }),
            Err(error) => failure(error),
        },
    )
}
