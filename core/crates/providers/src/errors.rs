//! Naming a provider's failure: its kind from the status and the provider's own words, and whether to try again.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use regex::Regex;
use serde_json::Value;
use tracing::debug;

use crate::http::TransportError;
use crate::js::{self, json_text, slice_units, to_string, truthy};
use crate::types::{ErrorKind, ProviderError};

const MAX_MESSAGE: usize = 500;
const NETWORK_FALLBACK: &str = "network error";

/// The failure of an answer whose body is text. A body that parses as JSON is read as that JSON.
pub fn from_response_text(
    status: u16,
    body: &str,
    headers: &BTreeMap<String, String>,
    now_ms: u64,
) -> ProviderError {
    match serde_json::from_str::<Value>(body) {
        Ok(value) => from_response_value(status, &value, headers, now_ms),
        Err(_) => build(status, &slice_units(body, MAX_MESSAGE), "", headers, now_ms),
    }
}

/// The failure of an answer whose body is already JSON.
pub fn from_response_value(
    status: u16,
    body: &Value,
    headers: &BTreeMap<String, String>,
    now_ms: u64,
) -> ProviderError {
    let provider_message = message_of(body);
    build(status, &provider_message, &code_of(body), headers, now_ms)
}

fn build(
    status: u16,
    provider_message: &str,
    raw_code: &str,
    headers: &BTreeMap<String, String>,
    now_ms: u64,
) -> ProviderError {
    let kind = classify(status, &format!("{raw_code} {provider_message}"));
    debug!(target: "providers.errors", status, kind = ?kind, "provider error mapped");
    let message = if provider_message.is_empty() {
        format!("HTTP {status}")
    } else {
        provider_message.to_owned()
    };
    let retry_after = headers
        .get("retry-after")
        .and_then(|value| retry_after_seconds(value, now_ms));
    ProviderError {
        kind,
        status: Some(status),
        message: Some(message),
        provider_message: Some(provider_message.to_owned()),
        retry_after,
    }
}

/// A request that never got an answer: refused, unreachable or cut off.
pub fn from_network(error: &TransportError) -> ProviderError {
    let text = error
        .cause_message
        .as_deref()
        .filter(|text| !text.is_empty())
        .or(Some(error.message.as_str()).filter(|text| !text.is_empty()))
        .unwrap_or(NETWORK_FALLBACK);
    let provider_message = slice_units(text, MAX_MESSAGE);
    debug!(target: "providers.errors", status = 0, kind = "provider-unreachable", "provider error mapped");
    ProviderError {
        kind: ErrorKind::Unreachable,
        status: Some(0),
        message: Some(provider_message.clone()),
        provider_message: Some(provider_message),
        retry_after: None,
    }
}

/// Worth trying again when overloaded or rate limited, never when the quota is spent.
pub fn is_retryable(failure: &ProviderError) -> bool {
    if failure.kind == ErrorKind::NoCredit {
        return false;
    }
    matches!(failure.status, Some(429 | 529) | Some(500..=599))
}

/// Seconds from a Retry-After value, as a number of seconds or an HTTP date measured from `now_ms`.
pub fn retry_after_seconds(value: &str, now_ms: u64) -> Option<f64> {
    if value.is_empty() {
        return None;
    }
    let seconds = js::number(Some(&Value::String(value.to_owned())));
    if seconds.is_finite() {
        return Some(seconds.max(0.0));
    }
    let at = parse_http_date(value)?;
    let delta = (at as f64 - now_ms as f64) / 1000.0;
    Some((delta + 0.5).floor().max(0.0))
}

/// Reads the IMF-fixdate form of an HTTP date, in milliseconds since the epoch.
fn parse_http_date(text: &str) -> Option<i64> {
    let mut parts = text.split_whitespace();
    let _weekday = parts.next()?;
    let day: i64 = parts.next()?.parse().ok()?;
    let month = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]
    .iter()
    .position(|name| Some(*name) == parts.clone().next())?;
    parts.next()?;
    let year: i64 = parts.next()?.parse().ok()?;
    let clock: Vec<i64> = parts
        .next()?
        .split(':')
        .map(str::parse)
        .collect::<Result<_, _>>()
        .ok()?;
    if clock.len() != 3 || parts.next()? != "GMT" {
        return None;
    }
    let days = days_from_civil(year, month as i64 + 1, day);
    Some(((days * 24 + clock[0]) * 60 + clock[1]) * 60_000 + clock[2] * 1000)
}

/// Days from 1970-01-01 to a proleptic Gregorian date.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The provider's own message, cut to the limit. A string is read as JSON when it parses.
fn message_of(body: &Value) -> String {
    if !truthy(Some(body)) {
        return String::new();
    }
    if let Value::String(text) = body {
        return match serde_json::from_str::<Value>(text) {
            Ok(parsed) => message_of(&parsed),
            Err(_) => slice_units(text, MAX_MESSAGE),
        };
    }
    let error = error_of(body);
    if let Value::String(text) = error {
        return slice_units(text, MAX_MESSAGE);
    }
    let message = ["message", "msg", "detail"]
        .iter()
        .filter_map(|key| error.get(*key))
        .find(|value| truthy(Some(value)))
        .map(to_string)
        .unwrap_or_else(|| json_text(error));
    slice_units(&message, MAX_MESSAGE)
}

/// The provider's code, else its type, else its status, as text. Empty when none is named.
fn code_of(body: &Value) -> String {
    let error = error_of(body);
    ["code", "type", "status"]
        .iter()
        .filter_map(|key| error.get(*key))
        .find(|value| truthy(Some(value)))
        .map(to_string)
        .unwrap_or_default()
}

/// `body.error ?? body`.
fn error_of(body: &Value) -> &Value {
    match body.get("error") {
        None | Some(Value::Null) => body,
        Some(error) => error,
    }
}

fn classify(status: u16, text: &str) -> ErrorKind {
    let t = text.to_lowercase();
    if status == 402 || quota_pattern(&t) {
        return ErrorKind::NoCredit;
    }
    if region_pattern(&t) {
        return ErrorKind::RegionUnavailable;
    }
    if context_pattern(&t) {
        return ErrorKind::ContextTooLong;
    }
    if refusal_pattern(&t) {
        return ErrorKind::Refused;
    }
    if matches!(status, 401 | 403) || key_pattern(&t) {
        return ErrorKind::InvalidKey;
    }
    if status == 404 || model_pattern(&t) {
        return ErrorKind::ModelNotFound;
    }
    if status == 429 || rate_pattern(&t) {
        return ErrorKind::RateLimited;
    }
    ErrorKind::UnknownError
}

/// Whether a compiled-once pattern matches; a pattern that fails to build matches nothing.
fn matches(cell: &'static OnceLock<Option<Regex>>, source: &'static str, text: &str) -> bool {
    cell.get_or_init(|| Regex::new(source).ok())
        .as_ref()
        .is_some_and(|re| re.is_match(text))
}

fn quota_pattern(text: &str) -> bool {
    static CELL: OnceLock<Option<Regex>> = OnceLock::new();
    matches(
        &CELL,
        "insufficient_quota|credit|billing|balance|payment|quota exceeded|exceeded your current quota",
        text,
    )
}

fn region_pattern(text: &str) -> bool {
    static CELL: OnceLock<Option<Regex>> = OnceLock::new();
    matches(
        &CELL,
        "country|region|territor|location is not supported|unsupported_country",
        text,
    )
}

fn context_pattern(text: &str) -> bool {
    static CELL: OnceLock<Option<Regex>> = OnceLock::new();
    matches(
        &CELL,
        "context.?length|context window|maximum context|too many tokens|prompt is too long|reduce the length",
        text,
    )
}

fn refusal_pattern(text: &str) -> bool {
    static CELL: OnceLock<Option<Regex>> = OnceLock::new();
    matches(
        &CELL,
        "content.?filter|content policy|safety|flagged|moderation",
        text,
    )
}

fn key_pattern(text: &str) -> bool {
    static CELL: OnceLock<Option<Regex>> = OnceLock::new();
    matches(
        &CELL,
        "invalid.?api.?key|incorrect api key|unauthorized|authentication",
        text,
    )
}

fn model_pattern(text: &str) -> bool {
    static CELL: OnceLock<Option<Regex>> = OnceLock::new();
    matches(
        &CELL,
        r"model(?-u:\b).{0,80}(?-u:\b)not.?found|does not exist|no such model|unknown model",
        text,
    )
}

fn rate_pattern(text: &str) -> bool {
    static CELL: OnceLock<Option<Regex>> = OnceLock::new();
    matches(&CELL, "rate.?limit", text)
}
