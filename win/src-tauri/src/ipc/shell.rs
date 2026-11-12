//! Handlers for the app shell channels: quit, boot hand-off, native toast, disk space, connectivity and
//! opening a created file.

use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::ptr::null_mut;
use std::sync::{Arc, OnceLock};

use draggy_web::connectivity::Connectivity;
use draggy_web::http::ReqwestClient;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;
use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

use super::{IpcError, Registry};
use crate::{AppState, ipc, paths};

/// Toast limits: the title and body are cut before they reach the OS.
const TITLE_LIMIT: usize = 120;
const BODY_LIMIT: usize = 240;

/// The probe is kept across calls so only changes in connectivity are logged.
static CONNECTIVITY: OnceLock<Option<Mutex<Connectivity<ReqwestClient>>>> = OnceLock::new();

pub fn register_all(registry: &mut Registry) {
    register!(registry, "quit-app" => quit_app);
    register!(registry, "boot-finished" => boot_finished);
    register!(registry, "notify:done" => notify_done);
    register!(registry, "check-disk-space" => check_disk_space);
    register!(registry, "check-internet" => check_internet);
    register!(registry, "open-file" => open_file);
}

/// Same handshake as a window close: the window saves first, then the app exits.
async fn quit_app(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let state = app.state::<AppState>();
    if state.quit.begin() {
        let quit = Arc::clone(&state.quit);
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            quit.flush(&handle).await;
            handle.exit(0);
        });
    }
    Ok(Value::Null)
}

/// The splash's hand-off. The Tauri app has no splash, so the model and the open request go straight
/// to the main window. Empty model and other opens are dropped.
async fn boot_finished(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    if app.get_webview_window("main").is_none() {
        return Ok(Value::Null);
    }
    let model = args
        .first()
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty());
    let open_providers = args.get(1).and_then(Value::as_str) == Some("providers");
    if let Some(model) = model {
        ipc::emit(&app, "boot-model", json!(model));
    }
    if open_providers {
        ipc::emit(&app, "boot-open", json!("providers"));
    }
    Ok(Value::Null)
}

/// A toast only for an answer that finished while the window was in the background.
async fn notify_done(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let focused = app
        .get_webview_window("main")
        .and_then(|window| window.is_focused().ok())
        .unwrap_or(false);
    if focused {
        return Ok(json!({ "shown": false }));
    }
    let title = truncate(&text_arg(args.first()), TITLE_LIMIT);
    let body = truncate(&text_arg(args.get(1)), BODY_LIMIT);
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| IpcError::Failed(error.to_string()))?;
    Ok(json!({ "shown": true }))
}

/// Free bytes for the caller on the data folder's drive. Zero when unknown, which never refuses a download.
async fn check_disk_space(_app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let free = data_folder().map(|dir| free_bytes(&dir)).unwrap_or(0);
    Ok(json!(free))
}

/// Asks Hugging Face whether the network is up. Failing to build the client counts as offline.
async fn check_internet(_app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let probe = CONNECTIVITY.get_or_init(|| {
        ReqwestClient::new()
            .ok()
            .map(|client| Mutex::new(Connectivity::new(client)))
    });
    let online = match probe {
        Some(probe) => probe.lock().await.check().await,
        None => false,
    };
    Ok(Value::Bool(online))
}

/// Opens only files under the created-files folder. A refusal is returned as text.
async fn open_file(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let raw = text_arg(args.first());
    let Some(resolved) =
        data_folder().and_then(|data| super::files::created_file_path(&data, &raw))
    else {
        return Ok(Value::String(refusal()));
    };
    match app
        .opener()
        .open_path(resolved.to_string_lossy(), None::<&str>)
    {
        Ok(()) => Ok(Value::String(String::new())),
        Err(error) => Ok(Value::String(error.to_string())),
    }
}

fn refusal() -> String {
    "Refused to open a file outside the Draggy output folder".to_owned()
}

fn data_folder() -> Option<PathBuf> {
    paths::data_dir(std::env::var_os("APPDATA")).ok()
}

/// The renderer's `String(value || "")`: falsy becomes empty, anything else is its text.
fn text_arg(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) | Some(Value::Bool(false)) => String::new(),
        Some(Value::String(text)) => text.clone(),
        Some(other) => other.to_string(),
    }
}

fn truncate(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

/// Bytes the caller may use on the volume holding `path`. Zero when the call fails.
fn free_bytes(path: &Path) -> u64 {
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut free: u64 = 0;
    // SAFETY: `wide` is NUL-terminated and alive for the call; the two optional out pointers are null.
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, null_mut(), null_mut()) };
    if ok == 0 { 0 } else { free }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_arg_matches_the_renderer_coercion() {
        assert_eq!(text_arg(None), "");
        assert_eq!(text_arg(Some(&Value::Null)), "");
        assert_eq!(text_arg(Some(&json!(false))), "");
        assert_eq!(text_arg(Some(&json!("done"))), "done");
        assert_eq!(text_arg(Some(&json!(12))), "12");
    }

    #[test]
    fn toast_text_is_cut_to_the_electron_limits() {
        let long = "x".repeat(300);
        assert_eq!(truncate(&long, TITLE_LIMIT).chars().count(), 120);
        assert_eq!(truncate(&long, BODY_LIMIT).chars().count(), 240);
        assert_eq!(truncate("short", BODY_LIMIT), "short");
    }

    #[test]
    fn free_space_reports_the_temp_volume() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(free_bytes(tmp.path()) > 0);
    }
}
