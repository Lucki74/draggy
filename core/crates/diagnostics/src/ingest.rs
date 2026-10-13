//! Renderer log entries: the shape check and clamps `ingestRendererEntries` applies before an entry is logged.

use serde_json::Value;

use crate::config::Level;
use crate::format::{js_string, js_truthy};
use crate::sanitize::ErrorInfo;
use crate::text::cut16;

/// A batch takes at most this many entries; the rest are counted as dropped.
pub(crate) const MAX_BATCH: usize = 200;
/// Valid entries the renderer may send in one second. The window is the writer's clock, not the renderer's.
pub(crate) const MAX_PER_SECOND: u32 = 1000;
const MAX_MESSAGE_UNITS: usize = 2000;
const MAX_CONTEXT_UNITS: usize = 80;
const MAX_ID_UNITS: usize = 64;
const MAX_STACK_UNITS: usize = 8000;

/// One renderer entry after validation. Its context already carries the `renderer.` prefix.
pub(crate) struct RendererEntry {
    pub(crate) level: Level,
    pub(crate) context: String,
    pub(crate) message: String,
    pub(crate) cid: Option<String>,
    pub(crate) data: Option<Value>,
    pub(crate) error: Option<ErrorInfo>,
}

/// A string field cut to `max` units. Anything that is not a string is empty, as `clampString` gives.
fn clamp(value: Option<&Value>, max: usize) -> String {
    match value {
        Some(Value::String(text)) => cut16(text, max),
        _ => String::new(),
    }
}

/// The entry, or `None` when the value is not a plain object. Every field is clamped or defaulted, never rejected.
pub(crate) fn validate(raw: &Value) -> Option<RendererEntry> {
    let Value::Object(map) = raw else {
        return None;
    };
    let level_text = match map.get("level") {
        Some(value) if js_truthy(value) => js_string(value),
        _ => "INFO".to_owned(),
    };
    let level = Level::parse(&level_text).unwrap_or(Level::Info);

    let context = clamp(map.get("context"), MAX_CONTEXT_UNITS);
    let context = context
        .strip_prefix("renderer")
        .map_or(context.as_str(), |rest| {
            rest.strip_prefix('.').unwrap_or(rest)
        });
    let context = if context.is_empty() { "app" } else { context };

    let message = match map.get("message") {
        Some(Value::String(text)) => text.clone(),
        None | Some(Value::Null) => String::new(),
        Some(other) => js_string(other),
    };
    let cid = clamp(map.get("correlationId"), MAX_ID_UNITS);

    Some(RendererEntry {
        level,
        context: format!("renderer.{context}"),
        message: cut16(&message, MAX_MESSAGE_UNITS),
        cid: (!cid.is_empty()).then_some(cid),
        data: map.get("data").or_else(|| map.get("payload")).cloned(),
        error: error_of(map.get("error")),
    })
}

/// An error object becomes a named error with its stack; a string becomes a plain `Error`. Other values carry no error.
/// Divergence: logger.cjs gives a string error the frames of the logger itself; Rust keeps no stack for it.
fn error_of(value: Option<&Value>) -> Option<ErrorInfo> {
    match value {
        Some(inner @ (Value::Object(_) | Value::Array(_))) => {
            let message = clamp(inner.get("message"), MAX_MESSAGE_UNITS);
            let name = match clamp(inner.get("name"), MAX_CONTEXT_UNITS) {
                name if name.is_empty() => "Error".to_owned(),
                name => name,
            };
            let stack = clamp(inner.get("stack"), MAX_STACK_UNITS);
            let stack = if stack.is_empty() {
                format!("{name}: {message}")
            } else {
                stack
            };
            Some(ErrorInfo {
                name,
                message,
                stack: Some(stack),
                ..ErrorInfo::default()
            })
        }
        Some(Value::String(text)) => Some(ErrorInfo::new("Error", cut16(text, MAX_MESSAGE_UNITS))),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::validate;

    #[test]
    fn a_context_with_the_prefix_is_not_doubled_and_an_empty_one_is_app() {
        assert_eq!(
            validate(&json!({"context": "renderer.editor"}))
                .map(|e| e.context)
                .as_deref(),
            Some("renderer.editor")
        );
        assert_eq!(
            validate(&json!({"context": "renderer"}))
                .map(|e| e.context)
                .as_deref(),
            Some("renderer.app")
        );
        assert_eq!(
            validate(&json!({"context": 3}))
                .map(|e| e.context)
                .as_deref(),
            Some("renderer.app")
        );
    }

    #[test]
    fn a_non_object_is_rejected() {
        assert!(validate(&json!("hello")).is_none());
        assert!(validate(&json!([{"message": "x"}])).is_none());
    }
}
