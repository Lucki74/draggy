//! The pure parts of the Google account adapter: the prompt of a turn, the failure the CLI names, and the usage of
//! a result.

use std::sync::OnceLock;

use regex::Regex;
use serde_json::Value;

use crate::claude::adapter::{data_url, flatten, text_of};
use crate::gateway::AccountFailure;
use crate::js::{to_string, truthy};
use crate::types::{ErrorKind, ProviderError, Usage};

const DEFAULT_TURN_FAILURE: &str = "The turn failed.";

/// The prompt of one turn: anything the session has not seen as text, then the input with its images.
pub fn to_prompt(history: &[Value], input: Option<&Value>) -> Vec<Value> {
    let mut prompt = Vec::new();
    let earlier = flatten(history);
    if !earlier.is_empty() {
        prompt.push(serde_json::json!({ "type": "text", "text": earlier }));
    }
    let raw = input
        .and_then(|message| message.get("content"))
        .unwrap_or(&Value::Null);
    let text = text_of(raw);
    if !text.is_empty() {
        prompt.push(serde_json::json!({ "type": "text", "text": text }));
    }
    for part in raw.as_array().into_iter().flatten() {
        if part.get("type").and_then(Value::as_str) != Some("image_url") {
            continue;
        }
        let url = part
            .get("image_url")
            .and_then(|image| image.get("url"))
            .and_then(Value::as_str)
            .unwrap_or("");
        if let Some((mime_type, data)) = data_url(url) {
            prompt
                .push(serde_json::json!({ "type": "image", "mimeType": mime_type, "data": data }));
        }
    }
    prompt
}

/// The token counts a result's metadata reports.
pub fn usage_of(meta: Option<&Value>) -> Usage {
    let count = meta
        .and_then(|m| m.get("quota"))
        .and_then(|q| q.get("token_count"));
    let read = |name: &str| {
        count
            .and_then(|c| c.get(name))
            .and_then(Value::as_u64)
            .unwrap_or(0)
    };
    Usage {
        prompt_tokens: read("input_tokens"),
        output_tokens: read("output_tokens"),
    }
}

fn pattern(cell: &'static OnceLock<Option<Regex>>, source: &'static str, text: &str) -> bool {
    cell.get_or_init(|| Regex::new(source).ok())
        .as_ref()
        .is_some_and(|regex| regex.is_match(text))
}

/// The message a failure carries: the error's message and its data, joined.
fn message_of(error: Option<&Value>) -> String {
    let data = error.and_then(|e| e.get("data"));
    let detail = match data {
        Some(Value::String(text)) => Some(text.clone()),
        Some(object) => object
            .get("details")
            .filter(|v| truthy(Some(v)))
            .map(to_string),
        None => None,
    };
    let message = error
        .and_then(|e| e.get("message"))
        .filter(|v| truthy(Some(v)))
        .map(to_string);
    let joined: Vec<String> = [message, detail]
        .into_iter()
        .flatten()
        .filter(|part| !part.is_empty())
        .collect();
    let text = joined.join(" ");
    let trimmed = text.trim();
    if trimmed.is_empty() {
        DEFAULT_TURN_FAILURE.to_owned()
    } else {
        trimmed.to_owned()
    }
}

/// The CLI's own words matched for the kind; a quota is a limit, a sign-in problem a sign-out.
pub fn turn_failure(error: Option<&Value>) -> AccountFailure {
    static LIMIT: OnceLock<Option<Regex>> = OnceLock::new();
    static SIGNED_OUT: OnceLock<Option<Regex>> = OnceLock::new();
    static OVERLOADED: OnceLock<Option<Regex>> = OnceLock::new();
    let message = message_of(error);
    let kind = if pattern(
        &LIMIT,
        r"(?i)quota|RESOURCE_EXHAUSTED|usage limit|limit reached|\b429\b",
        &message,
    ) {
        ErrorKind::AccountLimitReached
    } else if pattern(
        &SIGNED_OUT,
        r"(?i)auth|sign ?in|log ?in|credential|UNAUTHENTICATED|\b401\b",
        &message,
    ) {
        ErrorKind::AccountSignedOut
    } else if pattern(&OVERLOADED, r"(?i)overloaded|UNAVAILABLE|\b503\b", &message) {
        ErrorKind::RateLimited
    } else {
        ErrorKind::UnknownError
    };
    AccountFailure::from(ProviderError {
        kind,
        status: Some(0),
        message: Some(message.clone()),
        provider_message: Some(message),
        retry_after: None,
    })
}
