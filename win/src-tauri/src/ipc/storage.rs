//! Handlers for the storage channels: chats, workspaces, key-value settings, metrics, checkpoints and
//! first-run setup. They answer in the Electron-era shapes, since the renderer is unchanged.

use std::path::PathBuf;
use std::sync::Arc;

use draggy_storage::{Chat, MetricInput, Storage, StorageError, Workspace};
use draggy_tools::files::FileOps;
use draggy_tools::fs_guard::Guard;
use serde_json::{Map, Value, json};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use super::{IpcError, Registry};
use crate::AppState;
use crate::storage::checkpoints::{RecycleBin, Store};
use crate::storage::onboarding;

const CLOSED: &str = "The chat database is not open.";
const SETTINGS_KEY: &str = "draggy_settings";
const CHECKPOINT_LIMIT: i64 = 100;

pub fn register_all(registry: &mut Registry) {
    register!(registry, "db:get" => db_get);
    register!(registry, "db:set" => db_set);
    register!(registry, "db:stats" => db_stats);
    register!(registry, "db:import" => db_import);
    register!(registry, "db:load-chats" => db_load_chats);
    register!(registry, "db:save-chat" => db_save_chat);
    register!(registry, "db:search-chats" => db_search_chats);
    register!(registry, "db:delete-chat" => db_delete_chat);
    register!(registry, "db:clear-chats" => db_clear_chats);
    register!(registry, "chats:folder" => chats_folder);
    register!(registry, "checkpoint:list" => checkpoint_list);
    register!(registry, "checkpoint:revert" => checkpoint_revert);
    register!(registry, "metrics:list" => metrics_list);
    register!(registry, "metrics:record" => metrics_record);
    register!(registry, "metrics:clear" => metrics_clear);
    register!(registry, "workspace:list" => workspace_list);
    register!(registry, "workspace:save" => workspace_save);
    register!(registry, "workspace:delete" => workspace_delete);
    register!(registry, "workspace:pick-folder" => workspace_pick_folder);
    register!(registry, "onboarding:state" => onboarding_state);
    register!(registry, "onboarding:start" => onboarding_start);
    register!(registry, "onboarding:complete" => onboarding_complete);
    register!(registry, "onboarding:reset" => onboarding_reset);
}

pub(crate) fn refused(message: &str) -> Value {
    json!({ "success": false, "error": message })
}

pub(crate) fn closed() -> Value {
    refused(CLOSED)
}

pub(crate) fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Value::String(text) => !text.is_empty(),
        _ => true,
    }
}

/// JavaScript's `String(value)` for what a renderer call can send.
pub(crate) fn js_string(value: Option<&Value>) -> String {
    match value {
        None => "undefined".to_owned(),
        Some(Value::Null) => "null".to_owned(),
        Some(Value::String(text)) => text.clone(),
        Some(Value::Bool(flag)) => flag.to_string(),
        Some(Value::Number(number)) => number.to_string(),
        Some(Value::Array(_)) => String::new(),
        Some(Value::Object(_)) => "[object Object]".to_owned(),
    }
}

pub(crate) async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, IpcError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| IpcError::Failed(error.to_string()))
}

/// Runs store work off the UI thread. A closed store answers `when_closed`; any other failure is
/// logged under `scope` and answered as `{success:false,error}`.
pub(crate) async fn with_storage<F>(
    app: &AppHandle,
    scope: &'static str,
    when_closed: Value,
    work: F,
) -> Result<Value, IpcError>
where
    F: FnOnce(&Storage) -> Result<Value, StorageError> + Send + 'static,
{
    let (storage, diag) = {
        let state = app.state::<AppState>();
        (state.storage.handle(), Arc::clone(&state.diag))
    };
    let Some(storage) = storage else {
        return Ok(when_closed);
    };
    Ok(match blocking(move || work(&storage)).await? {
        Ok(value) => value,
        Err(StorageError::Closed) => when_closed,
        Err(error) => {
            diag.error(scope, &error.to_string(), None);
            refused(&error.to_string())
        }
    })
}

async fn db_get(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let key = js_string(args.first());
    let empty = json!({ "success": true, "value": null });
    with_storage(&app, "db", empty, move |storage| {
        Ok(json!({ "success": true, "value": storage.get_value(&key)? }))
    })
    .await
}

/// Keys whose old and new value may appear in the log. Every other setting is named and nothing more.
const HARMLESS: [&str; 28] = [
    "theme",
    "accent",
    "fontSize",
    "language",
    "modelName",
    "codeModel",
    "imageModel",
    "embedModel",
    "effort",
    "allowMaxInChat",
    "codeEffort",
    "slowModelThinking",
    "colibriLossy",
    "webMode",
    "browserActions",
    "codeWebMode",
    "codePermissionMode",
    "voiceEngine",
    "neuralVoice",
    "cloudProvider",
    "voiceRate",
    "voiceSounds",
    "interfaceSounds",
    "searchProvider",
    "libraryEnabled",
    "showMetrics",
    "compactLimit",
    "fixedContextSize",
];

fn settings_object(raw: &str) -> Map<String, Value> {
    match serde_json::from_str::<Value>(raw) {
        Ok(Value::Object(map)) => map,
        Ok(_) => Map::new(),
        Err(error) => {
            tracing::debug!(target: "settings.log", error = %error, "swallowed: settings value is not an object, treated as empty");
            Map::new()
        }
    }
}

fn scalar(value: Option<&Value>) -> Value {
    match value {
        None | Some(Value::Null) => Value::Null,
        Some(value @ (Value::String(_) | Value::Number(_) | Value::Bool(_))) => value.clone(),
        Some(_) => json!("[set]"),
    }
}

/// `{key: {from, to}}` for harmless keys and `{key: null}` for the rest. Port of settingsLog.cjs.
fn describe_change(before: &str, after: &str) -> Map<String, Value> {
    let (old, next) = (settings_object(before), settings_object(after));
    let mut keys: Vec<&String> = old.keys().collect();
    keys.extend(next.keys().filter(|key| !old.contains_key(*key)));
    let mut changed = Map::new();
    for key in keys {
        if old.get(key) == next.get(key) {
            continue;
        }
        let entry = if HARMLESS.contains(&key.as_str()) {
            json!({ "from": scalar(old.get(key)), "to": scalar(next.get(key)) })
        } else {
            Value::Null
        };
        changed.insert(key.clone(), entry);
    }
    changed
}

/// Follows the saved theme on the live window, as `applyThemeSetting` does. Best effort: a missing
/// window or a refused colour leaves the old look.
fn apply_theme(app: &AppHandle, raw: &str) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let setting = crate::theme::theme_setting(Some(raw));
    let forced = match setting {
        crate::theme::ThemeSetting::Light => Some(tauri::Theme::Light),
        crate::theme::ThemeSetting::Dark => Some(tauri::Theme::Dark),
        crate::theme::ThemeSetting::System => None,
    };
    let _ = window.set_theme(forced);
    let system_dark = matches!(window.theme(), Ok(tauri::Theme::Dark));
    let [r, g, b] = crate::theme::background_for(setting, system_dark);
    let _ = window.set_background_color(Some(tauri::window::Color(r, g, b, 255)));
}

async fn db_set(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let key = js_string(args.first());
    let value = js_string(args.get(1));
    let is_settings = key == SETTINGS_KEY;
    let shown_key = key.clone();
    let saved = value.clone();
    let mut result = with_storage(&app, "db", closed(), move |storage| {
        // The old blob rides back in the reply so the log can say what changed; it is removed below.
        let old = if is_settings {
            storage.get_value(SETTINGS_KEY)?.unwrap_or_default()
        } else {
            String::new()
        };
        storage.set_value(&key, &saved)?;
        Ok(json!({ "success": true, "before": old }))
    })
    .await?;

    let before = result
        .as_object_mut()
        .and_then(|reply| reply.remove("before"))
        .and_then(|old| old.as_str().map(str::to_owned))
        .unwrap_or_default();
    let diag = Arc::clone(&app.state::<AppState>().diag);
    if is_settings {
        let changed = describe_change(&before, &value);
        if !changed.is_empty() {
            let harmless = changed
                .keys()
                .filter(|key| HARMLESS.contains(&key.as_str()))
                .count();
            diag.debug(
                "settings",
                "settings changed",
                Some(json!({
                    "changed": changed.len(),
                    "harmless": harmless,
                    "named": changed.len() - harmless,
                })),
            );
            diag.info(
                "settings",
                "settings saved",
                Some(json!({ "changed": changed })),
            );
        }
        apply_theme(&app, &value);
    } else if result["success"] == true {
        diag.info(
            "settings",
            "setting saved",
            Some(json!({ "key": shown_key })),
        );
    }
    Ok(result)
}

async fn db_import(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let sessions = match args.into_iter().next() {
        Some(Value::Array(items)) => items,
        _ => Vec::new(),
    };
    let shut = json!({ "success": false, "error": CLOSED, "imported": 0 });
    with_storage(&app, "db", shut, move |storage| {
        Ok(json!({ "success": true, "imported": storage.import_sessions(&sessions) }))
    })
    .await
}

async fn db_stats(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let empty = json!({ "success": true, "stats": null });
    with_storage(&app, "db", empty, |storage| {
        Ok(json!({ "success": true, "stats": storage.stats()? }))
    })
    .await
}

async fn db_load_chats(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let empty = json!({ "success": true, "chats": [] });
    with_storage(&app, "db", empty, |storage| {
        Ok(json!({ "success": true, "chats": storage.load_chats()? }))
    })
    .await
}

async fn db_save_chat(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let session = args.into_iter().next().unwrap_or(Value::Null);
    let chat: Chat = match serde_json::from_value(session) {
        Ok(chat) => chat,
        Err(error) => return Ok(refused(&error.to_string())),
    };
    with_storage(&app, "db", closed(), move |storage| {
        storage.save_chat(&chat)?;
        Ok(json!({ "success": true }))
    })
    .await
}

async fn db_search_chats(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let query = js_string(args.first());
    let empty = json!({ "success": true, "results": [] });
    with_storage(&app, "db", empty, move |storage| {
        Ok(json!({ "success": true, "results": storage.search_chats(&query) }))
    })
    .await
}

async fn db_delete_chat(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = js_string(args.first());
    let dir = app.state::<AppState>().storage.chat_dir(&id);
    with_storage(&app, "db", closed(), move |storage| {
        storage.delete_chat(&id)?;
        if let Some(dir) = dir {
            // A folder that will not go costs disk space, not the deletion the user asked for.
            let _ = std::fs::remove_dir_all(dir);
        }
        Ok(json!({ "success": true }))
    })
    .await
}

async fn db_clear_chats(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let root = app.state::<AppState>().storage.chats_root();
    with_storage(&app, "db", closed(), move |storage| {
        storage.clear_chats()?;
        let _ = std::fs::remove_dir_all(root);
        Ok(json!({ "success": true }))
    })
    .await
}

async fn chats_folder(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = js_string(args.first());
    let open = args.get(1).is_some_and(truthy);
    let Some(dir) = app.state::<AppState>().storage.chat_dir(&id) else {
        return Ok(refused("That chat has no folder."));
    };
    let made = dir.clone();
    let opened = match blocking(move || std::fs::create_dir_all(made)).await? {
        Ok(()) if open => app
            .opener()
            .open_path(dir.to_string_lossy(), None::<&str>)
            .map_err(|error| error.to_string()),
        Ok(()) => Ok(()),
        Err(error) => Err(error.to_string()),
    };
    if let Err(error) = opened {
        app.state::<AppState>().diag.error("chats", &error, None);
        return Ok(refused(&error));
    }
    Ok(json!({ "success": true, "path": dir.to_string_lossy() }))
}

async fn checkpoint_list(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let workspace = args
        .first()
        .filter(|value| truthy(value))
        .map(|value| js_string(Some(value)))
        .unwrap_or_default();
    let empty = json!({ "success": true, "checkpoints": [] });
    with_storage(&app, "fs", empty, move |storage| {
        let rows = storage.list_checkpoints(&workspace, CHECKPOINT_LIMIT)?;
        Ok(json!({ "success": true, "checkpoints": rows }))
    })
    .await
}

fn checkpoint_id(value: Option<&Value>) -> Option<i64> {
    let number = value?.as_f64().filter(|n| n.fract() == 0.0)?;
    Some(number as i64)
}

async fn checkpoint_revert(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let (db, diag) = {
        let state = app.state::<AppState>();
        (Arc::clone(&state.storage), Arc::clone(&state.diag))
    };
    let Some(storage) = db.handle() else {
        return Ok(closed());
    };
    let Some(id) = checkpoint_id(args.first()) else {
        return Ok(refused("That checkpoint does not exist."));
    };
    let outcome = blocking(move || {
        let data_dir = db.data_dir().to_path_buf();
        let roots = {
            let (storage, db) = (Arc::clone(&storage), Arc::clone(&db));
            move |workspace: &str| roots_for(&storage, &db, workspace)
        };
        let ops = FileOps::new(
            Guard::new([data_dir.clone()]),
            Store::new(Arc::clone(&storage), &data_dir),
            RecycleBin,
            roots,
        );
        ops.revert(id)
    })
    .await?;
    match outcome {
        Ok(done) => {
            let path = done.path.to_string_lossy().into_owned();
            let mut event = json!({ "workspaceId": done.workspace_id, "path": path });
            let mut reply =
                json!({ "success": true, "path": path, "workspaceId": done.workspace_id });
            if let Some(from) = done.from {
                let from = from.to_string_lossy().into_owned();
                event["from"] = json!(from);
                reply["from"] = json!(from);
            }
            super::emit(&app, "file-changed", event);
            Ok(reply)
        }
        Err(error) => {
            diag.error("fs", &error.to_string(), None);
            Ok(refused(&error.to_string()))
        }
    }
}

/// The first folder of a workspace, for terminals and commands. None when the store is closed or there is none.
pub(crate) async fn workspace_root(app: &AppHandle, workspace: &str) -> Option<PathBuf> {
    let db = Arc::clone(&app.state::<AppState>().storage);
    let storage = db.handle()?;
    let workspace = workspace.to_owned();
    blocking(move || roots_for(&storage, &db, &workspace).into_iter().next())
        .await
        .ok()
        .flatten()
}

/// The folders a workspace may reach: `chat:<id>` is that chat's folder, made on first need.
fn roots_for(storage: &Storage, db: &crate::storage::Db, workspace: &str) -> Vec<PathBuf> {
    if let Some(chat) = workspace.strip_prefix("chat:") {
        let Some(dir) = db.chat_dir(chat) else {
            return Vec::new();
        };
        return match std::fs::create_dir_all(&dir) {
            Ok(()) => vec![dir],
            Err(_) => Vec::new(),
        };
    }
    match storage.get_workspace(workspace) {
        Ok(Some(found)) => found
            .root_path
            .filter(|root| !root.is_empty())
            .map(PathBuf::from)
            .into_iter()
            .collect(),
        _ => Vec::new(),
    }
}

async fn metrics_list(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let since = match args.first() {
        Some(Value::Number(number)) => number.as_f64().unwrap_or(0.0),
        Some(Value::String(text)) => text.trim().parse::<f64>().unwrap_or(0.0),
        Some(Value::Bool(true)) => 1.0,
        _ => 0.0,
    };
    let since = if since.is_finite() { since } else { 0.0 };
    let empty = json!({ "success": true, "rows": [] });
    with_storage(&app, "metrics", empty, move |storage| {
        Ok(json!({ "success": true, "rows": storage.list_metrics(since)? }))
    })
    .await
}

async fn metrics_record(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let row = args.into_iter().next().unwrap_or(Value::Null);
    let Ok(row) = serde_json::from_value::<MetricInput>(row) else {
        return Ok(json!({ "success": false }));
    };
    with_storage(&app, "metrics", closed(), move |storage| {
        match storage.record_metric(&row) {
            Ok(()) => Ok(json!({ "success": true })),
            Err(StorageError::MetricModelMissing) => Ok(json!({ "success": false })),
            Err(error) => Err(error),
        }
    })
    .await
}

async fn metrics_clear(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    with_storage(&app, "metrics", closed(), |storage| {
        Ok(json!({ "success": true, "removed": storage.clear_metrics()? }))
    })
    .await
}

async fn workspace_list(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let empty = json!({ "success": true, "workspaces": [] });
    with_storage(&app, "workspace", empty, |storage| {
        Ok(json!({ "success": true, "workspaces": storage.list_workspaces()? }))
    })
    .await
}

async fn workspace_save(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let workspace: Workspace =
        match serde_json::from_value(args.into_iter().next().unwrap_or(Value::Null)) {
            Ok(workspace) => workspace,
            Err(error) => return Ok(refused(&error.to_string())),
        };
    with_storage(&app, "workspace", closed(), move |storage| {
        Ok(json!({ "success": true, "workspace": storage.save_workspace(&workspace)? }))
    })
    .await
}

async fn workspace_delete(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let id = js_string(args.first());
    super::files::close_workspace_watcher(&id);
    with_storage(&app, "workspace", closed(), move |storage| {
        Ok(json!({ "success": true, "deleted": storage.delete_workspace(&id)? }))
    })
    .await
}

async fn workspace_pick_folder(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let picker = app.clone();
    let chosen = blocking(move || {
        let mut dialog = picker.dialog().file().set_title("Choose a project folder");
        if let Some(window) = picker.get_webview_window("main") {
            dialog = dialog.set_parent(&window);
        }
        dialog.blocking_pick_folder()
    })
    .await?;
    match chosen.map(|path| path.into_path()) {
        Some(Ok(path)) => Ok(json!({ "success": true, "path": path.to_string_lossy() })),
        Some(Err(error)) => {
            app.state::<AppState>()
                .diag
                .error("workspace", &error.to_string(), None);
            Ok(refused(&error.to_string()))
        }
        None => Ok(json!({ "success": false, "cancelled": true })),
    }
}

async fn onboarding_state(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let (storage, show) = {
        let state = app.state::<AppState>();
        (state.storage.handle(), state.storage.show_setup())
    };
    blocking(move || onboarding::state(storage.as_deref(), show)).await
}

/// Runs a setup call on the store. A failure is logged and answered as `{success:false,error}`.
async fn setup_call<F>(app: &AppHandle, work: F) -> Result<Value, IpcError>
where
    F: FnOnce(&Storage, &draggy_diagnostics::Diagnostics) -> Result<Value, String> + Send + 'static,
{
    let (storage, diag) = {
        let state = app.state::<AppState>();
        (state.storage.handle(), Arc::clone(&state.diag))
    };
    let Some(storage) = storage else {
        return Ok(closed());
    };
    let reply = Arc::clone(&diag);
    Ok(match blocking(move || work(&storage, &diag)).await? {
        Ok(value) => value,
        Err(error) => {
            reply.error("onboarding", &error, None);
            refused(&error)
        }
    })
}

async fn onboarding_start(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    setup_call(&app, |storage, _| onboarding::start(storage)).await
}

async fn onboarding_complete(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let path = js_string(args.first());
    let reply = setup_call(&app, move |storage, _| onboarding::complete(storage, &path)).await?;
    if reply["success"] == true {
        app.state::<AppState>().storage.set_show_setup(false);
        // The launch check waited for setup, as in the reference; the start is once per process.
        super::updater::start(&app);
        crate::browser::adblock::start(&app);
    }
    Ok(reply)
}

async fn onboarding_reset(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let reply = setup_call(&app, |storage, diag| {
        onboarding::reset(storage, diag)?;
        Ok(json!({ "success": true }))
    })
    .await?;
    if reply["success"] == true {
        app.state::<AppState>().storage.set_show_setup(true);
        // TODO: show the main window and reload it at index.html?onboarding=true.
    }
    Ok(reply)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_string_follows_javascript() {
        assert_eq!(js_string(None), "undefined");
        assert_eq!(js_string(Some(&Value::Null)), "null");
        assert_eq!(js_string(Some(&json!(7))), "7");
        assert_eq!(js_string(Some(&json!("k"))), "k");
    }

    #[test]
    fn a_settings_save_names_harmless_keys_and_hides_the_rest() {
        let changed = describe_change(
            r#"{"theme":"dark","prompt":"secret","same":1}"#,
            r#"{"theme":"light","prompt":"other","same":1,"effort":"high"}"#,
        );
        assert_eq!(changed["theme"], json!({ "from": "dark", "to": "light" }));
        assert_eq!(changed["prompt"], Value::Null);
        assert_eq!(changed["effort"], json!({ "from": null, "to": "high" }));
        assert!(!changed.contains_key("same"));
        assert!(describe_change("{}", "not json").is_empty());
    }

    #[test]
    fn checkpoint_ids_must_be_whole_numbers() {
        assert_eq!(checkpoint_id(Some(&json!(4))), Some(4));
        assert_eq!(checkpoint_id(Some(&json!(4.5))), None);
        assert_eq!(checkpoint_id(Some(&json!("4"))), None);
        assert_eq!(checkpoint_id(None), None);
    }

    #[test]
    fn a_chat_workspace_resolves_to_its_folder() {
        let dir = tempfile::tempdir().expect("tempdir");
        let diag = crate::storage::test_diag(dir.path());
        let db = crate::storage::Db::open(dir.path(), &diag);
        let storage = db.handle().expect("open");
        let roots = roots_for(&storage, &db, "chat:abc");
        assert_eq!(roots, vec![dir.path().join("chats").join("abc")]);
        assert!(roots[0].is_dir());
        assert!(roots_for(&storage, &db, "chat:../x").is_empty());
        assert!(roots_for(&storage, &db, "default").is_empty());
    }
}
