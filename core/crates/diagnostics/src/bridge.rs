//! Sends `tracing` events to the log files. Spans are not kept: the core logs events with their own fields,
//! and the writer's levels and scopes decide what reaches each file.

use std::sync::Arc;

use serde_json::{Map, Value};
use tracing::field::{Field, Visit};
use tracing::level_filters::LevelFilter;
use tracing::span::{Attributes, Id, Record};
use tracing::{Event, Level, Metadata, Subscriber};

use crate::Diagnostics;

/// A `tracing` subscriber that writes each event through a `Diagnostics` writer, scoped by the event's target.
pub struct TracingBridge {
    diagnostics: Arc<Diagnostics>,
}

impl TracingBridge {
    pub fn new(diagnostics: Arc<Diagnostics>) -> Self {
        Self { diagnostics }
    }

    /// Makes this the process-wide subscriber. False when another one was installed first.
    pub fn install(self) -> bool {
        tracing::subscriber::set_global_default(self).is_ok()
    }
}

#[derive(Default)]
struct Fields {
    message: Option<String>,
    data: Map<String, Value>,
}

impl Fields {
    fn put(&mut self, field: &Field, value: Value) {
        if field.name() == "message" {
            self.message = Some(match value {
                Value::String(text) => text,
                other => other.to_string(),
            });
        } else {
            self.data.insert(field.name().to_owned(), value);
        }
    }
}

impl Visit for Fields {
    fn record_str(&mut self, field: &Field, value: &str) {
        self.put(field, Value::from(value));
    }

    fn record_bool(&mut self, field: &Field, value: bool) {
        self.put(field, Value::from(value));
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        self.put(field, Value::from(value));
    }

    fn record_u64(&mut self, field: &Field, value: u64) {
        self.put(field, Value::from(value));
    }

    fn record_f64(&mut self, field: &Field, value: f64) {
        self.put(field, Value::from(value));
    }

    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.put(field, Value::from(format!("{value:?}")));
    }
}

impl Subscriber for TracingBridge {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        *metadata.level() <= Level::DEBUG
    }

    fn max_level_hint(&self) -> Option<LevelFilter> {
        Some(LevelFilter::DEBUG)
    }

    fn new_span(&self, _span: &Attributes<'_>) -> Id {
        Id::from_u64(1)
    }

    fn record(&self, _span: &Id, _values: &Record<'_>) {}

    fn record_follows_from(&self, _span: &Id, _follows: &Id) {}

    fn event(&self, event: &Event<'_>) {
        let metadata = event.metadata();
        let mut fields = Fields::default();
        event.record(&mut fields);
        let message = fields.message.unwrap_or_default();
        let data = (!fields.data.is_empty()).then(|| Value::Object(fields.data));
        let scope = metadata.target();
        match *metadata.level() {
            Level::ERROR => self.diagnostics.error(scope, &message, data),
            Level::WARN => self.diagnostics.warn(scope, &message, data),
            Level::INFO => self.diagnostics.info(scope, &message, data),
            _ => self.diagnostics.debug(scope, &message, data),
        }
    }

    fn enter(&self, _span: &Id) {}

    fn exit(&self, _span: &Id) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Config, Level as LogLevel, LogFile, SystemClock};

    #[test]
    fn events_reach_the_debug_log_with_their_fields() {
        let dir = tempfile::tempdir().unwrap();
        let config = Config {
            app_level: LogLevel::Info,
            debug_level: LogLevel::Debug,
            scopes: Vec::new(),
            session_id: "test".into(),
            pid: 1,
            max_bytes: crate::DEFAULT_MAX_BYTES,
        };
        let diagnostics = Arc::new(Diagnostics::open(
            dir.path(),
            config,
            Arc::new(SystemClock::default()),
        ));
        let bridge = TracingBridge::new(Arc::clone(&diagnostics));

        tracing::subscriber::with_default(bridge, || {
            tracing::warn!(target: "tools.shell", reason = "too-long", chars = 9000_u64, "command refused");
        });

        let tail = diagnostics.read_tail(LogFile::Debug, None);
        assert!(tail.contains("[tools.shell] command refused"), "{tail}");
        assert!(tail.contains("\"reason\":\"too-long\""), "{tail}");
        assert!(tail.contains("\"chars\":9000"), "{tail}");
    }
}
