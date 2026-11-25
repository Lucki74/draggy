//! Splash channels: its state and its skip button, and the main window's first paint.

use serde_json::{Value, json};
use tauri::AppHandle;

use super::{IpcError, Registry};

pub fn register_all(registry: &mut Registry) {
    register!(registry, "splash:state" => state);
    register!(registry, "splash:skip" => skip);
    register!(registry, "splash:main-ready" => main_ready);
}

/// The channels the splash webview may call. `splash:main-ready` is the main window's.
pub fn may_call(channel: &str) -> bool {
    matches!(channel, "splash:state" | "splash:skip")
}

async fn state(_app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    Ok(json!(crate::splash::snapshot()))
}

async fn skip(_app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    crate::splash::skip();
    Ok(Value::Null)
}

async fn main_ready(_app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    crate::splash::main_ready();
    Ok(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_splash_reaches_only_its_own_channels() {
        assert!(may_call("splash:state"));
        assert!(may_call("splash:skip"));
        assert!(!may_call("splash:main-ready"));
        assert!(!may_call("updater:install"));
        assert!(!may_call("shell:open"));
    }
}
