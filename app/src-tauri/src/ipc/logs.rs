//! Handlers for the logs channels and the diagnostics bundle channels.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::SystemTime;

use draggy_diagnostics::{LevelChange, LevelState, LogFile, Scopes};
use serde_json::{Map, Value, json};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use super::providers;
use super::{IpcError, Registry};
use crate::{AppState, theme};

#[path = "../diagnostics/bundle.rs"]
mod bundle;

/// Shown once per process: the crash flag is read and cleared the same way.
static CRASH_NOTICE_TAKEN: AtomicBool = AtomicBool::new(false);

pub fn register_all(registry: &mut Registry) {
    register!(registry, "logs:get-level" => get_level);
    register!(registry, "logs:set-level" => set_level);
    register!(registry, "logs:open" => open_folder);
    register!(registry, "logs:tail" => tail);
    register!(registry, "diagnostics:preview" => preview);
    register!(registry, "diagnostics:export" => export);
    register!(registry, "diagnostics:crash-notice" => crash_notice);
}

fn level_json(state: &LevelState) -> Value {
    json!({
        "level": state.level.name(),
        "scopes": state.scopes,
        "keep": state.keep,
        "until": state.until,
    })
}

async fn get_level(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    Ok(level_json(&app.state::<AppState>().diag.level_state()))
}

/// Unknown or missing fields leave the level as it is, as logger.cjs does; `keep` only counts when true.
async fn set_level(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let safe: Map<String, Value> = args
        .first()
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let level = safe.get("level").and_then(Value::as_str);
    let list: Vec<&str> = match safe.get("scopes") {
        Some(Value::Array(items)) => items.iter().filter_map(Value::as_str).collect(),
        _ => Vec::new(),
    };
    let scopes = match safe.get("scopes") {
        Some(Value::String(text)) => Some(Scopes::Text(text.as_str())),
        Some(Value::Array(_)) => Some(Scopes::List(&list)),
        _ => None,
    };
    let change = LevelChange {
        level,
        scopes,
        duration_ms: safe
            .get("durationMs")
            .and_then(Value::as_f64)
            .filter(|ms| ms.is_finite()),
        keep: safe.get("keep").and_then(Value::as_bool) == Some(true),
    };
    let diag = &app.state::<AppState>().diag;
    diag.set_level(change);
    Ok(level_json(&diag.level_state()))
}

/// Answers with an empty string on success, or the error text when the shell refuses.
async fn open_folder(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let dir = app
        .state::<AppState>()
        .diag
        .dir()
        .to_string_lossy()
        .into_owned();
    match app.opener().open_path(dir, None::<&str>) {
        Ok(()) => Ok(json!("")),
        Err(error) => Ok(json!(error.to_string())),
    }
}

/// Only the three fixed log files are readable; the target picks one and nothing else.
fn log_file(target: Option<&str>) -> LogFile {
    match target {
        Some("debug") => LogFile::Debug,
        Some("events") => LogFile::Events,
        _ => LogFile::App,
    }
}

/// Number's coercion as logger.cjs applies it: null is 0, a numeric string counts, anything else takes the default.
fn byte_count(value: Option<&Value>) -> Option<i64> {
    let number = match value? {
        Value::Null => 0.0,
        Value::Bool(flag) => f64::from(u8::from(*flag)),
        Value::Number(number) => number.as_f64()?,
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                0.0
            } else {
                trimmed.parse::<f64>().ok()?
            }
        }
        _ => return None,
    };
    number.is_finite().then(|| number.floor() as i64)
}

async fn tail(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let file = log_file(args.first().and_then(Value::as_str));
    let bytes = byte_count(args.get(1));
    Ok(json!(app.state::<AppState>().diag.read_tail(file, bytes)))
}

/// What the bundle needs from this process. Settings come from the same store the renderer uses.
async fn sources(app: &AppHandle) -> bundle::Sources {
    let (diag, mcp) = {
        let state = app.state::<AppState>();
        (Arc::clone(&state.diag), Arc::clone(&state.mcp))
    };
    let data_dir = diag.dir().parent().unwrap_or(diag.dir()).to_path_buf();
    let db = data_dir.join("draggy.db");
    let settings = match theme::saved_settings(&db) {
        Some(text) => serde_json::from_str::<Value>(&text).unwrap_or_else(|_| {
            diag.swallow(
                "settings",
                None,
                "unreadable settings are left out of the bundle",
            );
            json!({})
        }),
        None => json!({}),
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    };
    let mut system = Map::new();
    system.insert(
        "chrome".to_owned(),
        json!(tauri::webview_version().unwrap_or_default()),
    );
    system.insert("platform".to_owned(), json!("win32"));
    system.insert("arch".to_owned(), json!(arch));
    system.insert("packaged".to_owned(), json!(!cfg!(debug_assertions)));
    system.insert("level".to_owned(), level_json(&diag.level_state()));
    let providers = {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || providers::bundle_entries(&app))
            .await
            .unwrap_or_default()
    };
    let mcp_servers = mcp
        .list()
        .await
        .iter()
        .map(|server| json!({ "id": server.id, "status": server.status, "tools": server.tools.len() }))
        .collect();
    bundle::Sources {
        log_dir: diag.dir().to_path_buf(),
        crash_dumps: crash_dumps(&data_dir.join("Crashpad")),
        home_dir: std::env::var("USERPROFILE").unwrap_or_default(),
        user_name: std::env::var("USERNAME").unwrap_or_default(),
        app_version: app.package_info().version.to_string(),
        created_at: bundle::iso_from_unix_ms(now_unix_ms()),
        system,
        settings,
        providers,
        mcp_servers,
    }
}

/// Every .dmp under the crash folder, newest first, three folders deep at most.
fn crash_dumps(root: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, depth: u32, found: &mut Vec<(SystemTime, PathBuf)>) {
        if depth > 3 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, depth + 1, found);
            } else if path.extension().is_some_and(|ext| ext == "dmp") {
                let mtime = entry
                    .metadata()
                    .and_then(|meta| meta.modified())
                    .unwrap_or(SystemTime::UNIX_EPOCH);
                found.push((mtime, path));
            }
        }
    }
    let mut found = Vec::new();
    walk(root, 0, &mut found);
    found.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    found.into_iter().map(|(_, path)| path).collect()
}

fn now_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
        .unwrap_or(0)
}

fn choices(value: Option<&Value>) -> bundle::Choices {
    let flag = |key: &str| {
        value
            .and_then(Value::as_object)
            .and_then(|map| map.get(key))
            .and_then(Value::as_bool)
            == Some(true)
    };
    bundle::Choices {
        include_debug: flag("includeDebug"),
        include_dumps: flag("includeDumps"),
    }
}

async fn preview(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let diag = app.state::<AppState>().diag.clone();
    Ok(bundle::preview(
        &sources(&app).await,
        choices(args.first()),
        Some(diag.as_ref()),
    ))
}

/// The save dialog opens in Documents; nothing is written until the person picks a file.
async fn export(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let picks = choices(args.first());
    let sources = sources(&app).await;
    let mut dialog = app
        .dialog()
        .file()
        .add_filter("Zip", &["zip"])
        .set_file_name(bundle::default_name(&sources.created_at));
    if let Ok(documents) = app.path().document_dir() {
        dialog = dialog.set_directory(documents);
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    dialog.save_file(move |picked| {
        let _ = tx.send(picked);
    });
    let target = match rx.await {
        Ok(Some(picked)) => picked
            .into_path()
            .map_err(|error| IpcError::Failed(error.to_string()))?,
        _ => return Ok(json!({"saved": false})),
    };
    let diag = app.state::<AppState>().diag.clone();
    let saved =
        bundle::save(&sources, picks, &target, Some(diag.as_ref())).map_err(IpcError::Failed)?;
    app.state::<AppState>().diag.info(
        "files",
        "diagnostics bundle saved",
        Some(json!({"bytes": saved.bytes, "files": saved.files})),
    );
    let _ = app.opener().reveal_item_in_dir(&target);
    Ok(json!({
        "saved": true,
        "file": target.to_string_lossy(),
        "bytes": saved.bytes,
        "files": saved.files,
    }))
}

/// True once per process, and only when the previous run never wrote its clean end.
fn take_crash_notice(taken: &AtomicBool, crashed: bool) -> bool {
    crashed && !taken.swap(true, Ordering::SeqCst)
}

async fn crash_notice(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let crashed = app.state::<AppState>().diag.previous_run().crashed;
    Ok(json!({"show": take_crash_notice(&CRASH_NOTICE_TAKEN, crashed)}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use draggy_diagnostics::{Config, Diagnostics, SystemClock};
    use std::sync::Arc;

    fn open(dir: &std::path::Path) -> Diagnostics {
        let config = Config::from_env(|_| None, "test", 1, true, None);
        Diagnostics::open(dir, config, Arc::new(SystemClock::default()))
    }

    #[test]
    fn target_picks_one_of_the_three_fixed_files() {
        assert_eq!(log_file(Some("debug")), LogFile::Debug);
        assert_eq!(log_file(Some("events")), LogFile::Events);
        assert_eq!(log_file(Some("app")), LogFile::App);
        assert_eq!(log_file(Some("../secrets")), LogFile::App);
        assert_eq!(log_file(None), LogFile::App);
    }

    #[test]
    fn byte_counts_coerce_like_number() {
        assert_eq!(byte_count(None), None);
        assert_eq!(byte_count(Some(&json!(null))), Some(0));
        assert_eq!(byte_count(Some(&json!(4096.9))), Some(4096));
        assert_eq!(byte_count(Some(&json!("128"))), Some(128));
        assert_eq!(byte_count(Some(&json!(""))), Some(0));
        assert_eq!(byte_count(Some(&json!("many"))), None);
        assert_eq!(byte_count(Some(&json!({}))), None);
        assert_eq!(byte_count(Some(&json!(-5))), Some(-5));
    }

    #[test]
    fn crash_notice_shows_once_and_only_after_a_crash() {
        let flag = AtomicBool::new(false);
        assert!(take_crash_notice(&flag, true));
        assert!(!take_crash_notice(&flag, true));
        let clean = AtomicBool::new(false);
        assert!(!take_crash_notice(&clean, false));
        assert!(!take_crash_notice(&clean, false));
    }

    #[test]
    fn level_state_has_the_renderer_shape() {
        let dir = tempfile::tempdir().expect("temp dir");
        let diag = open(dir.path());
        let state = level_json(&diag.level_state());
        assert_eq!(state["level"], "INFO");
        assert_eq!(state["scopes"], json!([]));
        assert_eq!(state["keep"], false);
        assert!(state["until"].is_null());
    }

    #[test]
    fn set_level_raises_and_lowers_without_a_restart() {
        let dir = tempfile::tempdir().expect("temp dir");
        let diag = open(dir.path());
        diag.set_level(LevelChange {
            level: Some("DEBUG"),
            scopes: Some(Scopes::Text("net, engine")),
            duration_ms: None,
            keep: false,
        });
        let raised = level_json(&diag.level_state());
        assert_eq!(raised["level"], "DEBUG");
        assert_eq!(raised["scopes"], json!(["net", "engine"]));
        diag.set_level(LevelChange::default());
        assert_eq!(level_json(&diag.level_state())["level"], "DEBUG");
    }

    #[test]
    fn choices_read_only_literal_true() {
        assert_eq!(
            choices(Some(&json!({"includeDebug": true, "includeDumps": "yes"}))),
            bundle::Choices {
                include_debug: true,
                include_dumps: false
            }
        );
        assert_eq!(choices(None), bundle::Choices::default());
    }
}
