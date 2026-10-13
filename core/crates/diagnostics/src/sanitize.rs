//! What a payload may look like on disk. Chat text and file content become hashes, secret-named fields are dropped,
//! and `app.log` cuts long strings. Error details are scrubbed, and `app.log` keeps less of them than `debug.log`.

use serde_json::{Map, Value, json};

use crate::scrub::{is_secret_key, scrub_with};
use crate::text::{cut16, is_js_space, js_len, sha8};

/// Payload keys that carry chat text or file content. Every string under one is hashed, at any depth.
const SENSITIVE_KEYS: [&str; 10] = [
    "prompt",
    "content",
    "text",
    "rawChunk",
    "streamBuffer",
    "response",
    "reply",
    "input",
    "userPrompt",
    "body",
];

const MAX_DEPTH: usize = 6;
const DATA_CUT: usize = 50;
const APP_MESSAGE_CUT: usize = 200;
/// Causes kept below the top error. Three levels in all, as logger.cjs keeps.
const CAUSE_DEPTH: usize = 3;

/// `[12 chars, sha256:1a2b3c4d]`: the length and a short hash, never the text.
pub(crate) fn redact(text: &str) -> String {
    format!("[{} chars, sha256:{}]", js_len(text), sha8(text))
}

/// A string past `max` keeps its first units, then its length and hash.
pub(crate) fn cut_string(text: &str, max: usize) -> String {
    if js_len(text) <= max {
        return text.to_owned();
    }
    format!(
        "{}... [{} chars, sha256:{}]",
        cut16(text, max),
        js_len(text),
        sha8(text)
    )
}

/// The payload as it may be written. `truncate` is true for `app.log`, which also cuts long strings.
pub(crate) fn sanitize(value: &Value, truncate: bool, known: &[String]) -> Value {
    walk(value, truncate, known, 0, false)
}

fn walk(value: &Value, truncate: bool, known: &[String], depth: usize, sensitive: bool) -> Value {
    if depth > MAX_DEPTH {
        return json!("[Depth]");
    }
    match value {
        Value::String(text) if sensitive => json!(redact(text)),
        Value::String(text) => {
            let clean = scrub_with(text, known);
            json!(if truncate {
                cut_string(&clean, DATA_CUT)
            } else {
                clean
            })
        }
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| walk(item, truncate, known, depth + 1, sensitive))
                .collect(),
        ),
        Value::Object(map) => Value::Object(
            js_key_order(map)
                .into_iter()
                .map(|(key, child)| {
                    let clean = if is_secret_key(key) {
                        json!(format!("[secret:{key}]"))
                    } else {
                        let under_sensitive = sensitive || SENSITIVE_KEYS.contains(&key.as_str());
                        walk(child, truncate, known, depth + 1, under_sensitive)
                    };
                    (key.clone(), clean)
                })
                .collect::<Map<String, Value>>(),
        ),
        other => other.clone(),
    }
}

/// TS quirk: JavaScript lists array-index keys first in numeric order, then the rest in insertion order.
fn js_key_order(map: &Map<String, Value>) -> Vec<(&String, &Value)> {
    let (mut indexed, named): (Vec<_>, Vec<_>) =
        map.iter().partition(|(key, _)| array_index(key).is_some());
    indexed.sort_by_key(|(key, _)| array_index(key));
    indexed.into_iter().chain(named).collect()
}

fn array_index(key: &str) -> Option<u32> {
    let index: u32 = key.parse().ok()?;
    (index.to_string() == key && index < u32::MAX).then_some(index)
}

/// The parts of an error that explain it. The writer scrubs it before anything is written.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ErrorInfo {
    pub name: String,
    pub message: String,
    pub stack: Option<String>,
    pub code: Option<String>,
    pub errno: Option<i64>,
    pub syscall: Option<String>,
    pub status: Option<i64>,
    pub cause: Option<Box<ErrorInfo>>,
}

impl ErrorInfo {
    pub fn new(name: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            message: message.into(),
            ..Self::default()
        }
    }
}

/// TS quirk: the message stays whole in debug.log, so an echoed prompt or code in an error text reaches disk.
/// Scrubs the message and stack, and keeps the fields that explain the failure down to `CAUSE_DEPTH` levels.
pub(crate) fn describe(error: &ErrorInfo, known: &[String], depth: usize) -> ErrorInfo {
    ErrorInfo {
        name: error.name.clone(),
        message: scrub_with(&error.message, known),
        stack: error.stack.as_ref().map(|stack| scrub_with(stack, known)),
        code: error.code.clone(),
        errno: error.errno,
        syscall: error.syscall.clone(),
        status: error.status,
        cause: error
            .cause
            .as_deref()
            .filter(|_| depth + 1 < CAUSE_DEPTH)
            .map(|cause| Box::new(describe(cause, known, depth + 1))),
    }
}

/// `app.log` cuts the message and rebuilds the stack header from the name, so an echoed request body stays out.
pub(crate) fn app_error(info: &ErrorInfo) -> ErrorInfo {
    let frames: Vec<&str> = info
        .stack
        .as_deref()
        .unwrap_or_default()
        .split('\n')
        .filter(|line| is_frame(line))
        .collect();
    let message = cut_string(&info.message, APP_MESSAGE_CUT);
    ErrorInfo {
        stack: Some(format!("{}: {}\n{}", info.name, message, frames.join("\n"))),
        message,
        name: info.name.clone(),
        code: info.code.clone(),
        errno: info.errno,
        syscall: info.syscall.clone(),
        status: info.status,
        cause: info
            .cause
            .as_deref()
            .map(|cause| Box::new(app_error(cause))),
    }
}

/// The stack, or `name: message` without one, then the explaining fields and the causes indented under it.
pub(crate) fn render(info: &ErrorInfo) -> String {
    let mut text = info
        .stack
        .clone()
        .filter(|stack| !stack.is_empty())
        .unwrap_or_else(|| format!("{}: {}", info.name, info.message));
    let mut extras = Vec::new();
    if let Some(code) = &info.code {
        extras.push(format!("code={code}"));
    }
    if let Some(errno) = info.errno {
        extras.push(format!("errno={errno}"));
    }
    if let Some(syscall) = &info.syscall {
        extras.push(format!("syscall={syscall}"));
    }
    if let Some(status) = info.status {
        extras.push(format!("status={status}"));
    }
    if !extras.is_empty() {
        text.push_str(&format!("\n  [{}]", extras.join(" ")));
    }
    if let Some(cause) = &info.cause {
        text.push_str(&format!(
            "\n  caused by: {}",
            render(cause).replace('\n', "\n  ")
        ));
    }
    text
}

/// The JSON form in `events.jsonl`: the scrubbed error with every field it has, causes included.
pub(crate) fn error_json(info: &ErrorInfo) -> Value {
    let mut map = Map::new();
    map.insert("name".to_owned(), json!(info.name));
    map.insert("message".to_owned(), json!(info.message));
    if let Some(stack) = &info.stack {
        map.insert("stack".to_owned(), json!(stack));
    }
    if let Some(code) = &info.code {
        map.insert("code".to_owned(), json!(code));
    }
    if let Some(errno) = info.errno {
        map.insert("errno".to_owned(), json!(errno));
    }
    if let Some(syscall) = &info.syscall {
        map.insert("syscall".to_owned(), json!(syscall));
    }
    if let Some(status) = info.status {
        map.insert("status".to_owned(), json!(status));
    }
    if let Some(cause) = &info.cause {
        map.insert("cause".to_owned(), error_json(cause));
    }
    Value::Object(map)
}

/// A stack frame: indented, then `at `. The JavaScript test is `/^\s+at /`.
fn is_frame(line: &str) -> bool {
    let trimmed = line.trim_start_matches(is_js_space);
    line.len() > trimmed.len() && trimmed.starts_with("at ")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{ErrorInfo, redact, sanitize};

    #[test]
    fn hashes_sensitive_text_at_any_depth_and_drops_secret_names() {
        let payload = json!({"input": {"query": "passport scan"}, "apiKey": "sk-live", "n": 2.0});
        let clean = sanitize(&payload, false, &[]);
        assert_eq!(clean["input"]["query"], json!(redact("passport scan")));
        assert_eq!(clean["apiKey"], json!("[secret:apiKey]"));
        assert_eq!(crate::format::js_json(&clean["n"]), "2");
    }

    #[test]
    fn integer_like_keys_come_first_as_they_do_in_javascript() {
        let clean = sanitize(&json!({"b": 1, "10": 2, "2": 3}), false, &[]);
        let keys: Vec<String> = clean
            .as_object()
            .map(|map| map.keys().cloned().collect())
            .unwrap_or_default();
        assert_eq!(keys, ["2", "10", "b"]);
    }

    #[test]
    fn app_error_keeps_frames_and_drops_the_echoed_message_from_the_header() {
        let mut error = ErrorInfo::new("Error", "echo body");
        error.stack = Some("Error: echo body\n    at call (x.js:1:1)\nnot a frame".to_owned());
        let rendered = super::render(&super::app_error(&error));
        assert_eq!(rendered, "Error: echo body\n    at call (x.js:1:1)");
    }

    #[test]
    fn render_lists_the_fields_and_the_causes() {
        let mut inner = ErrorInfo::new("Error", "refused");
        inner.code = Some("ECONNREFUSED".to_owned());
        inner.errno = Some(-111);
        let mut outer = ErrorInfo::new("Error", "failed");
        outer.cause = Some(Box::new(inner));
        assert_eq!(
            super::render(&outer),
            "Error: failed\n  caused by: Error: refused\n    [code=ECONNREFUSED errno=-111]"
        );
    }
}
