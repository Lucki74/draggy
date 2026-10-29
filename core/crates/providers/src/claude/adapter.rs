//! The pure parts of the Claude account adapter: turning the neutral request into the runtime's content, reading
//! its failures and its model list. The session that drives a turn is kept by the caller.

use std::sync::OnceLock;

use regex::Regex;
use serde_json::{Map, Value, json};

use crate::gateway::AccountFailure;
use crate::js::{json_text, to_string, truthy};
use crate::types::{ErrorKind, ProviderError, Usage};
use crate::usage::from_anthropic;

const LEVELS: [&str; 3] = ["low", "medium", "high"];
const DEFAULT_TURN_FAILURE: &str = "The turn failed.";

/// The speaker each earlier message is introduced by; other roles are left out of the flattened history.
fn speaker(role: &str) -> Option<&'static str> {
    match role {
        "user" => Some("User"),
        "assistant" => Some("Assistant"),
        "tool" => Some("Tool result"),
        _ => None,
    }
}

/// A message's text: a string as it is, or the text parts joined.
pub fn text_of(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter(|part| part.get("type").and_then(Value::as_str) == Some("text"))
            .map(join_text)
            .collect(),
        _ => String::new(),
    }
}

/// One part's text as `Array.prototype.join` writes it: a missing or null text is empty.
fn join_text(part: &Value) -> String {
    match part.get("text") {
        None | Some(Value::Null) => String::new(),
        Some(value) => to_string(value),
    }
}

/// A `data:image/…;base64,…` URL split into its type and its data, as the reference's pattern reads it.
pub fn data_url(url: &str) -> Option<(String, String)> {
    static CELL: OnceLock<Option<Regex>> = OnceLock::new();
    let regex = CELL
        .get_or_init(|| Regex::new(r"(?s)^data:(image/[\w.+-]+);base64,(.+)$").ok())
        .as_ref()?;
    let caps = regex.captures(url)?;
    Some((caps[1].to_owned(), caps[2].to_owned()))
}

/// An image part as the runtime takes it: a base64 block, or nothing for any other part.
fn image_block(part: &Value) -> Option<Value> {
    if part.get("type").and_then(Value::as_str) != Some("image_url") {
        return None;
    }
    let url = part
        .get("image_url")
        .and_then(|image| image.get("url"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let (media_type, data) = data_url(url)?;
    Some(
        json!({ "type": "image", "source": { "type": "base64", "media_type": media_type, "data": data } }),
    )
}

/// The arguments of a call as text: a string as it is, otherwise its JSON, with nothing becoming `{}`.
fn arguments_text(arguments: Option<&Value>) -> String {
    match arguments {
        Some(Value::String(text)) => text.clone(),
        None | Some(Value::Null) => "{}".to_owned(),
        Some(value) => json_text(value),
    }
}

/// A name as a template literal writes it, where a missing name reads as `undefined`.
fn name_text(name: Option<&Value>) -> String {
    match name {
        None => "undefined".to_owned(),
        Some(value) => to_string(value),
    }
}

/// Earlier messages as one text block, since stdin takes no structured history.
pub fn flatten(history: &[Value]) -> String {
    let mut turns = Vec::new();
    for message in history {
        let role = message.get("role").and_then(Value::as_str).unwrap_or("");
        let Some(speaker) = speaker(role) else {
            continue;
        };
        let calls: Vec<String> = message
            .get("tool_calls")
            .and_then(Value::as_array)
            .map(|calls| {
                calls
                    .iter()
                    .map(|call| {
                        let function = call.get("function");
                        format!(
                            "[called {} with {}]",
                            name_text(function.and_then(|f| f.get("name"))),
                            arguments_text(function.and_then(|f| f.get("arguments"))),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();
        let mut parts = vec![text_of(message.get("content").unwrap_or(&Value::Null))];
        parts.extend(calls);
        let body = parts
            .into_iter()
            .filter(|part| !part.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        if !body.is_empty() {
            turns.push(format!("{speaker}: {body}"));
        }
    }
    if turns.is_empty() {
        return String::new();
    }
    format!(
        "<conversation_so_far>\n{}\n</conversation_so_far>",
        turns.join("\n\n")
    )
}

/// The one user message a turn sends: anything the session has not seen, then the input with its images.
pub fn to_content(history: &[Value], input: Option<&Value>) -> Vec<Value> {
    let mut content = Vec::new();
    let earlier = flatten(history);
    if !earlier.is_empty() {
        content.push(json!({ "type": "text", "text": earlier }));
    }
    let raw = input
        .and_then(|message| message.get("content"))
        .unwrap_or(&Value::Null);
    let text = text_of(raw);
    if !text.is_empty() {
        content.push(json!({ "type": "text", "text": text }));
    }
    if let Some(parts) = raw.as_array() {
        content.extend(parts.iter().filter_map(image_block));
    }
    content
}

/// Draggy's tools as the runtime's own tool list: only functions with a name are offered.
pub fn mcp_tools(tools: &Value) -> Vec<Value> {
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
            let description = function.get("description").filter(|value| truthy(Some(value))).cloned().unwrap_or(json!(""));
            let schema = function
                .get("parameters")
                .filter(|value| truthy(Some(value)))
                .cloned()
                .unwrap_or_else(|| json!({ "type": "object", "properties": {} }));
            Some(json!({ "name": function["name"], "description": description, "inputSchema": schema }))
        })
        .collect()
}

/// The effort the pill maps to. Thinking off is the runtime's own switch, not a low effort.
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
        Some(false) => json!({ "thinking": false }),
        Some(true) => {
            let level = body
                .get("thinking_level")
                .and_then(Value::as_str)
                .filter(|level| LEVELS.contains(level))
                .unwrap_or("medium");
            json!({ "thinking": true, "effort": level })
        }
        None => json!({ "thinking": true }),
    }
}

/// The token counts a result reports. Cache reads and writes count toward the prompt.
pub fn usage_of(usage: Option<&Value>) -> Usage {
    from_anthropic(usage)
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

fn limit_pattern(text: &str) -> bool {
    static CELL: OnceLock<Option<Regex>> = OnceLock::new();
    matches_pattern(
        &CELL,
        r"(?i)usage limit|limit reached|hit your limit|rate.?limit",
        text,
    )
}

fn signed_out_pattern(text: &str) -> bool {
    static CELL: OnceLock<Option<Regex>> = OnceLock::new();
    matches_pattern(
        &CELL,
        r"(?i)/login|log ?in again|logged out|authenticat|oauth token|invalid api key|401",
        text,
    )
}

fn overloaded_pattern(text: &str) -> bool {
    static CELL: OnceLock<Option<Regex>> = OnceLock::new();
    matches_pattern(&CELL, r"(?i)overloaded|529", text)
}

fn epoch_pattern(text: &str) -> Option<u64> {
    static CELL: OnceLock<Option<Regex>> = OnceLock::new();
    let regex = CELL
        .get_or_init(|| Regex::new(r"\|(\d{10})\b").ok())
        .as_ref()?;
    regex.captures(text)?[1].parse().ok()
}

/// A pattern that fails to compile matches nothing, so the failure falls through to the unknown kind.
fn matches_pattern(
    cell: &'static OnceLock<Option<Regex>>,
    source: &'static str,
    text: &str,
) -> bool {
    cell.get_or_init(|| Regex::new(source).ok())
        .as_ref()
        .is_some_and(|regex| regex.is_match(text))
}

/// The runtime's failure words named by kind. A limit keeps the reset time, from the text or from the runtime's
/// earlier rate-limit notice. Unverified without a plan at its limit, so the runtime's own words are the test.
pub fn turn_failure(text: &str, limit: Option<&Value>) -> AccountFailure {
    let trimmed = text.trim();
    let message = if trimmed.is_empty() {
        DEFAULT_TURN_FAILURE
    } else {
        trimmed
    };
    if limit_pattern(message) {
        let mut out = AccountFailure::from(failure(ErrorKind::AccountLimitReached, message));
        out.resets_at = epoch_pattern(message)
            .map(|epoch| json!(epoch))
            .or_else(|| limit.and_then(|l| l.get("resetsAt")).cloned());
        return out;
    }
    if signed_out_pattern(message) {
        return failure(ErrorKind::AccountSignedOut, message).into();
    }
    if overloaded_pattern(message) {
        return failure(ErrorKind::RateLimited, message).into();
    }
    failure(ErrorKind::UnknownError, message).into()
}

/// The runtime's model list as Draggy shows it. `default` only repeats another entry, and the version comes from the
/// runtime's own description ("Opus 5.5 · …"), so a new pin renames the models without a change here.
pub fn listed_models(listed: &[Value]) -> Vec<Value> {
    listed
        .iter()
        .filter(|model| model.get("value").and_then(Value::as_str) != Some("default"))
        .map(|model| {
            let description = model
                .get("description")
                .filter(|value| truthy(Some(value)))
                .map(to_string)
                .unwrap_or_default();
            let head = description
                .split(" · ")
                .next()
                .unwrap_or("")
                .trim()
                .to_owned();
            let name = if !head.is_empty() {
                head
            } else {
                model
                    .get("displayName")
                    .filter(|value| truthy(Some(value)))
                    .map(to_string)
                    .unwrap_or_else(|| to_string(&model["value"]))
            };
            let mut out = Map::new();
            out.insert("id".to_owned(), model["value"].clone());
            out.insert("name".to_owned(), json!(name));
            if let Some(resolved) = model
                .get("resolvedModel")
                .filter(|value| truthy(Some(value)))
            {
                out.insert("resolved".to_owned(), resolved.clone());
            }
            out.insert("inputModalities".to_owned(), json!(["text", "image"]));
            Value::Object(out)
        })
        .collect()
}
