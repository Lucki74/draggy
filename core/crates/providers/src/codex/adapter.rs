//! The pure parts of the ChatGPT account adapter: the items a seeded thread takes, the input of a turn, the effort
//! the pill asks for, the reset time of a spent window and the failure Codex names.

use std::sync::OnceLock;

use regex::Regex;
use serde_json::{Value, json};

use crate::claude::adapter::text_of;
use crate::gateway::AccountFailure;
use crate::js::{json_text, to_string, truthy};
use crate::types::{ErrorKind, ProviderError};

const LEVELS: [&str; 3] = ["low", "medium", "high"];
const DEFAULT_TURN_FAILURE: &str = "The turn failed.";

fn images_of(content: &Value) -> Vec<String> {
    content
        .as_array()
        .map(|parts| {
            parts
                .iter()
                .filter(|part| part.get("type").and_then(Value::as_str) == Some("image_url"))
                .filter_map(|part| {
                    part.get("image_url")
                        .and_then(|image| image.get("url"))
                        .filter(|url| truthy(Some(url)))
                })
                .map(to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// A string for a value that JavaScript would coerce with `String(value || "")`.
fn text_or_empty(value: Option<&Value>) -> String {
    match value {
        Some(value) if truthy(Some(value)) => to_string(value),
        _ => String::new(),
    }
}

/// A wire message as the raw Responses items the runtime's item injection takes.
pub fn to_items(message: &Value) -> Vec<Value> {
    let content = message.get("content").unwrap_or(&Value::Null);
    let text = text_of(content);
    match message.get("role").and_then(Value::as_str) {
        Some("user") => {
            let mut parts = Vec::new();
            if !text.is_empty() {
                parts.push(json!({ "type": "input_text", "text": text }));
            }
            for url in images_of(content) {
                parts.push(json!({ "type": "input_image", "image_url": url }));
            }
            if parts.is_empty() {
                Vec::new()
            } else {
                vec![json!({ "type": "message", "role": "user", "content": parts })]
            }
        }
        Some("tool") => vec![json!({
            "type": "function_call_output",
            "call_id": text_or_empty(message.get("tool_call_id")),
            "output": text,
        })],
        Some("assistant") => {
            let mut items = Vec::new();
            if !text.trim().is_empty() {
                items.push(json!({ "type": "message", "role": "assistant", "content": [{ "type": "output_text", "text": text }] }));
            }
            for call in message
                .get("tool_calls")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let function = call.get("function");
                let arguments = match function.and_then(|f| f.get("arguments")) {
                    Some(Value::String(text)) => text.clone(),
                    None | Some(Value::Null) => "{}".to_owned(),
                    Some(value) => json_text(value),
                };
                items.push(json!({
                    "type": "function_call",
                    "call_id": text_or_empty(call.get("id")),
                    "name": function.and_then(|f| f.get("name")).filter(|n| truthy(Some(n))).map(to_string).unwrap_or_default(),
                    "arguments": arguments,
                }));
            }
            items
        }
        _ => Vec::new(),
    }
}

/// The input of a turn: the message's text, then its images.
pub fn to_input(message: Option<&Value>) -> Vec<Value> {
    let Some(message) = message else {
        return Vec::new();
    };
    let content = message.get("content").unwrap_or(&Value::Null);
    let text = text_of(content);
    let mut input = Vec::new();
    if !text.is_empty() {
        input.push(json!({ "type": "text", "text": text, "text_elements": [] }));
    }
    for url in images_of(content) {
        input.push(json!({ "type": "image", "url": url }));
    }
    input
}

/// Draggy's tools as Codex's dynamic tools: only functions with a name are offered.
pub fn dynamic_tools(tools: &Value) -> Vec<Value> {
    let Some(tools) = tools.as_array() else {
        return Vec::new();
    };
    tools
        .iter()
        .filter(|tool| tool.get("type").and_then(Value::as_str) == Some("function"))
        .filter_map(|tool| {
            let function = tool.get("function")?;
            if !truthy(function.get("name")) {
                return None;
            }
            let description = function.get("description").filter(|v| truthy(Some(v))).cloned().unwrap_or(json!(""));
            let schema = function
                .get("parameters")
                .filter(|v| truthy(Some(v)))
                .cloned()
                .unwrap_or_else(|| json!({ "type": "object", "properties": {} }));
            Some(json!({ "type": "function", "name": function["name"], "description": description, "inputSchema": schema }))
        })
        .collect()
}

/// The pill's level. A reasoning model always reasons, so thinking off asks for the least, as the OpenAI adapter does.
pub fn effort_of(body: &Value) -> Value {
    let template = body
        .get("chat_template_kwargs")
        .and_then(|kwargs| kwargs.get("enable_thinking"));
    let think = body
        .get("think")
        .filter(|value| !value.is_null())
        .or(template)
        .and_then(Value::as_bool);
    match think {
        None => json!({}),
        Some(true) => {
            let level = body
                .get("thinking_level")
                .and_then(Value::as_str)
                .filter(|level| LEVELS.contains(level))
                .unwrap_or("medium");
            json!({ "effort": level, "summary": "auto" })
        }
        Some(false) => json!({ "effort": "low", "summary": "none" }),
    }
}

/// The reset time of the window that ran out, or the latest of the windows when none has. None when neither gives one.
pub fn resets_at_of(limits: Option<&Value>) -> Option<Value> {
    let windows: Vec<&Value> = ["primary", "secondary"]
        .iter()
        .filter_map(|name| limits.and_then(|l| l.get(*name)))
        .filter(|window| window.get("resetsAt").is_some_and(Value::is_number))
        .collect();
    let spent: Vec<&Value> = windows
        .iter()
        .copied()
        .filter(|window| {
            window
                .get("usedPercent")
                .and_then(Value::as_f64)
                .is_some_and(|used| used >= 100.0)
        })
        .collect();
    let pick = if spent.is_empty() { windows } else { spent };
    let latest = pick
        .iter()
        .filter_map(|window| window["resetsAt"].as_f64())
        .reduce(f64::max)?;
    Some(number_value(latest))
}

/// A JSON number that is whole reads as an integer, as the runtime's epoch seconds are.
fn number_value(value: f64) -> Value {
    if value.fract() == 0.0 && value.abs() < 9.0e15 {
        json!(value as i64)
    } else {
        json!(value)
    }
}

fn failure(kind: ErrorKind, message: &str) -> ProviderError {
    ProviderError {
        kind,
        status: Some(0),
        message: Some(message.to_owned()),
        provider_message: Some(message.to_owned()),
        retry_after: None,
    }
}

fn connection_pattern(tag: &str) -> bool {
    static CELL: OnceLock<Option<Regex>> = OnceLock::new();
    CELL.get_or_init(|| Regex::new("Connection|Disconnected|FailedAttempts").ok())
        .as_ref()
        .is_some_and(|regex| regex.is_match(tag))
}

/// The tag Codex gives an error: a string, or the first key of an object, else `other`.
fn tag_of(info: Option<&Value>) -> String {
    match info {
        Some(Value::String(tag)) => tag.clone(),
        Some(Value::Object(map)) => map
            .keys()
            .next()
            .cloned()
            .unwrap_or_else(|| "other".to_owned()),
        _ => "other".to_owned(),
    }
}

/// Codex's error tags named by kind. A spent plan keeps its reset time and is never retried.
pub fn turn_failure(error: Option<&Value>, limits: Option<&Value>) -> AccountFailure {
    let tag = tag_of(error.and_then(|e| e.get("codexErrorInfo")));
    let raw = error
        .and_then(|e| e.get("message"))
        .filter(|m| truthy(Some(m)))
        .map(to_string);
    let message = raw.unwrap_or_else(|| DEFAULT_TURN_FAILURE.to_owned());
    let kind = match tag.as_str() {
        "usageLimitExceeded" | "sessionBudgetExceeded" => {
            let mut out = AccountFailure::from(failure(ErrorKind::AccountLimitReached, &message));
            out.resets_at = resets_at_of(limits);
            return out;
        }
        "unauthorized" => ErrorKind::AccountSignedOut,
        "rateLimitExceeded" | "serverOverloaded" => ErrorKind::RateLimited,
        "cyberPolicy" | "misalignmentPolicyViolation" => ErrorKind::Refused,
        other if connection_pattern(other) => ErrorKind::Unreachable,
        _ => ErrorKind::UnknownError,
    };
    failure(kind, &message).into()
}
