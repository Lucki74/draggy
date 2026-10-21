//! Names a Google account failure by kind from the status, reason and message Google gave.

use std::sync::OnceLock;

use regex::Regex;
use serde_json::Value;

use crate::types::{ErrorKind, ProviderError};

const MAX_MESSAGE: usize = 300;

/// What Google's error body, or text that holds one, says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GoogleError {
    pub status: u16,
    pub reason: String,
    pub message: String,
}

fn pattern(cell: &'static OnceLock<Regex>, source: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(source).expect("pattern is valid"))
}

fn truncate(text: &str, length: usize) -> String {
    text.chars().take(length).collect()
}

/// Pulls `{ status, reason, message }` out of a JSON error body, or out of text that holds one.
pub fn parse_google_error(source: &str) -> GoogleError {
    static CODE: OnceLock<Regex> = OnceLock::new();
    let parsed = source.find('{').and_then(|start| {
        let end = source.rfind('}')?;
        if end < start {
            return None;
        }
        serde_json::from_str::<Value>(&source[start..=end]).ok()
    });
    let error = parsed.as_ref().map(|value| match value.get("error") {
        Some(inner) if !inner.is_null() && inner != &Value::Bool(false) => inner,
        _ => value,
    });
    let detail_reason = error
        .and_then(|e| e.get("details"))
        .and_then(Value::as_array)
        .and_then(|details| {
            details
                .iter()
                .filter_map(|d| d.get("reason").and_then(Value::as_str))
                .find(|reason| !reason.is_empty())
        });
    let code = error
        .and_then(|e| e.get("code"))
        .and_then(|c| c.as_u64().or_else(|| c.as_str().and_then(|s| s.trim().parse().ok())))
        .filter(|c| *c > 0 && *c <= u64::from(u16::MAX));
    let from_text = pattern(&CODE, r"\b(40[0-9]|429|50[0-9])\b")
        .captures(source)
        .and_then(|c| c[1].parse::<u16>().ok());
    let status = code.map(|c| c as u16).or(from_text).unwrap_or(0);
    let reason = detail_reason
        .map(str::to_owned)
        .or_else(|| error.and_then(|e| e.get("status")).and_then(Value::as_str).map(str::to_owned))
        .unwrap_or_default();
    let message = match error {
        Some(e) => e
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned(),
        None => source.to_owned(),
    };
    GoogleError {
        status,
        reason: truncate(&reason, 64),
        message: truncate(&message.split_whitespace().collect::<Vec<_>>().join(" "), MAX_MESSAGE),
    }
}

fn failure(kind: ErrorKind, status: u16, message: &str) -> ProviderError {
    ProviderError {
        kind,
        status: Some(status),
        message: Some(message.to_owned()),
        provider_message: Some(message.to_owned()),
        retry_after: None,
    }
}

/// The failure for one Google answer. A 403 or the retirement wording is its own kind, since it is an account matter.
pub fn google_failure(input: &str) -> ProviderError {
    static RETIRED: OnceLock<Regex> = OnceLock::new();
    static SIGNED_OUT: OnceLock<Regex> = OnceLock::new();
    static LIMIT: OnceLock<Regex> = OnceLock::new();
    static BUSY: OnceLock<Regex> = OnceLock::new();
    static DENIED: OnceLock<Regex> = OnceLock::new();
    let GoogleError {
        status,
        reason,
        message,
    } = parse_google_error(input);
    let text = format!("{reason} {message}");
    let shown = if !message.is_empty() {
        message.clone()
    } else if !reason.is_empty() {
        reason.clone()
    } else {
        format!("HTTP {status}")
    };
    let retired = pattern(
        &RETIRED,
        r"(?i)no longer (supported|available|served)|stop(ped)? serving|has been (retired|discontinued)|migrate to antigravity",
    );
    if status == 403 || pattern(&DENIED, r"(?i)PERMISSION_DENIED").is_match(&reason) || retired.is_match(&text) {
        return failure(
            ErrorKind::AccountAccessDenied,
            if status == 0 { 403 } else { status },
            &shown,
        );
    }
    if status == 401
        || pattern(&SIGNED_OUT, r"(?i)UNAUTHENTICATED|sign ?in|log ?in|credential").is_match(&text)
    {
        return failure(ErrorKind::AccountSignedOut, status, &shown);
    }
    if status == 429
        || pattern(&LIMIT, r"(?i)RESOURCE_EXHAUSTED|quota|usage limit|limit reached").is_match(&text)
    {
        return failure(ErrorKind::AccountLimitReached, status, &shown);
    }
    if status == 503 || pattern(&BUSY, r"(?i)overloaded|UNAVAILABLE").is_match(&text) {
        return failure(ErrorKind::RateLimited, status, &shown);
    }
    failure(ErrorKind::UnknownError, status, &shown)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_403_is_an_account_matter() {
        let f = google_failure(r#"{"error":{"code":403,"message":"Forbidden","status":"PERMISSION_DENIED"}}"#);
        assert_eq!(f.kind, ErrorKind::AccountAccessDenied);
        assert_eq!(f.status, Some(403));
        assert_eq!(f.message.as_deref(), Some("Forbidden"));
    }

    #[test]
    fn the_retirement_wording_is_access_denied_without_a_status() {
        let f = google_failure("Gemini CLI is no longer supported for this plan");
        assert_eq!(f.kind, ErrorKind::AccountAccessDenied);
        assert_eq!(f.status, Some(403));
    }

    #[test]
    fn kinds_follow_the_status_and_the_wording() {
        assert_eq!(google_failure("HTTP 401 please sign in").kind, ErrorKind::AccountSignedOut);
        assert_eq!(google_failure(r#"{"error":{"code":429,"message":"quota"}}"#).kind, ErrorKind::AccountLimitReached);
        assert_eq!(google_failure("503 model overloaded").kind, ErrorKind::RateLimited);
        assert_eq!(google_failure("something odd").kind, ErrorKind::UnknownError);
    }

    #[test]
    fn details_name_the_reason_and_the_message_is_trimmed() {
        let e = parse_google_error(
            r#"prefix {"error":{"code":"429","message":"  a   b\n c ","details":[{"x":1},{"reason":"RATE"}]}}"#,
        );
        assert_eq!(e.status, 429);
        assert_eq!(e.reason, "RATE");
        assert_eq!(e.message, "a b c");
    }
}
