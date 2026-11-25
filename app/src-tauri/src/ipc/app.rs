//! The handlers ported so far: app info, renderer log lines and the quit handshake.

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use super::{IpcError, Registry};
use crate::AppState;

pub fn register_all(registry: &mut Registry) {
    register!(registry, "app:version" => app_version);
    register!(registry, "logs:write" => logs_write);
    register!(registry, "logs:batch" => logs_write);
    register!(registry, "app:saves-flushed" => saves_flushed);
}

/// Same fields as the Electron answer; the `electron` and `node` ones are empty until the UI drops them.
async fn app_version(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    };
    Ok(json!({
        "version": app.package_info().version.to_string(),
        "electron": "",
        "node": "",
        "chrome": tauri::webview_version().unwrap_or_default(),
        "platform": "win32",
        "arch": arch,
        "packaged": !cfg!(debug_assertions),
    }))
}

/// One entry or a batch; the writer clamps, scrubs and rate-limits them.
async fn logs_write(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    if let Some(entries) = args.first() {
        app.state::<AppState>().diag.ingest_renderer(entries);
    }
    Ok(Value::Null)
}

async fn saves_flushed(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    app.state::<AppState>().quit.note_flushed();
    Ok(Value::Null)
}
