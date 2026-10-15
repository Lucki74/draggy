//! Where the client's log lines go. Production sends them to tracing; tests record them and compare.

use serde_json::Value;

/// How serious a line is. Matches the levels the reference logger uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Debug,
    Info,
    Warn,
    Error,
}

impl Level {
    /// The lowercase name a fixture records.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Debug => "debug",
            Self::Info => "info",
            Self::Warn => "warn",
            Self::Error => "error",
        }
    }
}

/// Receives one line: a level, the scope it belongs to, a short lowercase message and a data object.
pub trait Log: Send + Sync {
    fn line(&self, level: Level, scope: &str, message: &str, data: Value);
}

/// The production sink. The scope travels as a field, since a tracing target has to be a constant.
#[derive(Debug, Clone, Copy, Default)]
pub struct TracingLog;

impl Log for TracingLog {
    fn line(&self, level: Level, scope: &str, message: &str, data: Value) {
        match level {
            Level::Debug => tracing::debug!(target: "mcp", scope, data = %data, "{}", message),
            Level::Info => tracing::info!(target: "mcp", scope, data = %data, "{}", message),
            Level::Warn => tracing::warn!(target: "mcp", scope, data = %data, "{}", message),
            Level::Error => tracing::error!(target: "mcp", scope, data = %data, "{}", message),
        }
    }
}
