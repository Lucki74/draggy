//! Handlers for the research channels. The saved runs live in library.db beside the library index.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use super::library::research::{apply_retention, get_run, list_runs, remove_run, save_run, search};
use super::library::{data_dir, db};
use super::storage::js_string;
use super::{IpcError, Registry};
use crate::AppState;

const LIST_LIMIT: i64 = 100;
const SEARCH_LIMIT: i64 = 20;
/// Tracing target for the research library. Logs carry counts and outcomes, never run text or queries.
const SCOPE: &str = "research.library";

/// Drops runs past the research keep setting, once at launch. Failures are logged and the app goes on.
pub(crate) fn prune_at_start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let dir = data_dir(&app);
        let keep = research_keep(&dir);
        let now = i64::try_from(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |elapsed| elapsed.as_millis()),
        )
        .unwrap_or(0);
        let outcome = db(&dir, move |s| apply_retention(s.conn_mut(), &keep, now)).await;
        let state = app.state::<AppState>();
        match outcome {
            Ok(0) => {}
            Ok(count) => state.diag.info(
                "research",
                "old runs removed",
                Some(json!({ "count": count })),
            ),
            Err(error) => state.diag.warn(
                "research",
                &format!("could not prune old runs: {error}"),
                None,
            ),
        }
    });
}

/// The `researchKeep` setting, or "forever" when the settings are missing or unreadable.
fn research_keep(dir: &Path) -> String {
    let settings = crate::theme::saved_settings(&dir.join("draggy.db"))
        .and_then(|text| serde_json::from_str::<Value>(&text).ok());
    match settings
        .as_ref()
        .and_then(|value| value.get("researchKeep"))
    {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Number(number)) => number.to_string(),
        _ => "forever".to_owned(),
    }
}

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
        Ok(Some(run)) => json!({ "success": true, "run": run }),
        Ok(None) => {
            tracing::debug!(target: SCOPE, "run not found");
            json!({ "success": true, "run": null })
        }
        Err(error) => failure(error),
    })
}

async fn save(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let run = args.into_iter().next().unwrap_or(Value::Null);
    let dir = data_dir(&app);
    Ok(
        match db(&dir, move |s| save_run(s.conn_mut(), &run)).await {
            Ok(()) => {
                tracing::info!(target: SCOPE, "run saved");
                json!({ "success": true })
            }
            Err(error) => {
                tracing::warn!(target: SCOPE, "run save failed");
                failure(error)
            }
        },
    )
}

async fn remove(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = js_string(args.first());
    let dir = data_dir(&app);
    Ok(
        match db(&dir, move |s| remove_run(s.conn_mut(), &id)).await {
            Ok(()) => {
                tracing::info!(target: SCOPE, "run removed");
                json!({ "success": true })
            }
            Err(error) => {
                tracing::warn!(target: SCOPE, "run removal failed");
                failure(error)
            }
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
    let run_id_scoped = run_id.is_some();
    let dir = data_dir(&app);
    Ok(
        match db(&dir, move |s| {
            search(s.conn(), &query, run_id.as_deref(), limit)
        })
        .await
        {
            Ok(hits) => {
                tracing::debug!(target: SCOPE, hits = hits.len(), scoped = run_id_scoped, "search");
                json!({ "success": true, "hits": hits })
            }
            Err(error) => failure(error),
        },
    )
}
