//! One dispatcher behind two Tauri commands. The renderer's channel names stay the Electron ones; a
//! channel is served by a handler in the registry, or answers "not implemented" until it is ported.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Instant;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::AppState;

/// Adds a handler to a registry. This is the only way to register one, so the guard test sees all.
macro_rules! register {
    ($registry:expr, $channel:literal => $handler:path) => {
        $registry.insert(
            $channel,
            Box::new(|app, args| Box::pin($handler(app, args))),
        )
    };
}

mod app;
mod call_log;
mod logs;
pub mod pending;
mod shell;
mod storage;

pub use call_log::{arg_bytes, correlation_id, is_silent, scope_for};

#[derive(Debug)]
pub enum IpcError {
    NotImplemented(String),
    Failed(String),
}

impl std::fmt::Display for IpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotImplemented(channel) => write!(f, "not implemented: {channel}"),
            Self::Failed(message) => f.write_str(message),
        }
    }
}

pub type HandlerFuture = Pin<Box<dyn Future<Output = Result<Value, IpcError>> + Send>>;
pub type Handler = Box<dyn Fn(AppHandle, Vec<Value>) -> HandlerFuture + Send + Sync>;

/// Renderer-chosen names must not grow the warn-once set without bound.
const MAX_WARNED: usize = 256;

pub struct Registry {
    handlers: HashMap<&'static str, Handler>,
    warned: Mutex<HashSet<String>>,
}

impl Registry {
    /// The registry with every ported handler. Built once at startup.
    pub fn build() -> Self {
        let mut registry = Self {
            handlers: HashMap::new(),
            warned: Mutex::new(HashSet::new()),
        };
        app::register_all(&mut registry);
        logs::register_all(&mut registry);
        shell::register_all(&mut registry);
        storage::register_all(&mut registry);
        registry
    }

    /// Call through `register!`. A duplicate channel is a programming error.
    pub(crate) fn insert(&mut self, channel: &'static str, handler: Handler) {
        let previous = self.handlers.insert(channel, handler);
        assert!(previous.is_none(), "channel registered twice: {channel}");
    }

    pub fn channels(&self) -> Vec<&'static str> {
        let mut names: Vec<_> = self.handlers.keys().copied().collect();
        names.sort_unstable();
        names
    }

    /// True the first time a channel is seen.
    fn first_miss(&self, channel: &str) -> bool {
        let mut warned = self.warned.lock().unwrap_or_else(PoisonError::into_inner);
        warned.len() < MAX_WARNED && warned.insert(channel.to_owned())
    }

    async fn dispatch(
        &self,
        app: AppHandle,
        diag: &draggy_diagnostics::Diagnostics,
        channel: &str,
        args: Vec<Value>,
    ) -> Result<Value, IpcError> {
        let Some(handler) = self.handlers.get(channel) else {
            if self.first_miss(channel) {
                let shown: String = channel.chars().take(64).collect();
                diag.warn(
                    "ipc",
                    "channel not ported yet",
                    Some(serde_json::json!({ "channel": shown })),
                );
            }
            return Err(IpcError::NotImplemented(channel.to_owned()));
        };
        if is_silent(channel) {
            return handler(app, args).await;
        }
        let stats = call_log::ArgStats::of(&args);
        let started = Instant::now();
        let result = handler(app, args).await;
        let dur_ms = started.elapsed().as_millis() as u64;
        let message = result.as_ref().err().map(ToString::to_string);
        call_log::finish(diag, channel, dur_ms, &stats, message.as_deref());
        result
    }
}

async fn run(app: AppHandle, channel: String, args: Vec<Value>) -> Result<Value, String> {
    let (registry, diag): (Arc<Registry>, Arc<_>) = {
        let state = app.state::<AppState>();
        (Arc::clone(&state.registry), Arc::clone(&state.diag))
    };
    registry
        .dispatch(app, &diag, &channel, args)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn ipc_invoke(
    app: AppHandle,
    channel: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    run(app, channel, args).await
}

/// Fire and forget from the renderer; a failure is logged there and in the file.
#[tauri::command]
pub async fn ipc_send(app: AppHandle, channel: String, args: Vec<Value>) -> Result<(), String> {
    run(app, channel, args).await.map(|_| ())
}

/// Pushes an event to the window, as `webContents.send` did. A closed window is not an error.
pub fn emit(app: &AppHandle, channel: &str, value: Value) -> bool {
    match app.emit(channel, value) {
        Ok(()) => true,
        Err(error) => {
            if let Some(state) = app.try_state::<AppState>() {
                state.diag.debug(
                    "ipc.send",
                    &format!("{channel} failed"),
                    Some(serde_json::json!({ "channel": channel, "error": error.to_string() })),
                );
            }
            false
        }
    }
}
