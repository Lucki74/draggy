//! What one IPC call writes to the log: channel, duration, argument count and size, correlation id.
//! Port of electron/ipcLog.cjs. Argument values never reach the log.

use draggy_diagnostics::{Diagnostics, ErrorInfo, ipc_slow_ms};
use serde_json::{Map, Value, json};

/// The log's own channels and the per-frame ones would log about themselves or flood the file.
const SILENT: [&str; 6] = [
    "logs:write",
    "logs:batch",
    "logs:tail",
    "logs:open",
    "browser-pane:bounds",
    "browser-pane:visible",
];

pub fn is_silent(channel: &str) -> bool {
    SILENT.contains(&channel)
}

/// Bytes an argument list would take on the wire, without keeping the values.
pub fn arg_bytes(args: &[Value]) -> usize {
    args.iter()
        .map(|arg| match arg {
            Value::Null => 0,
            Value::String(text) => text.len(),
            other => serde_json::to_string(other).map_or(0, |json| json.len()),
        })
        .sum()
}

/// An image job's request id is its correlation id: the same string tags the engine's lines.
pub fn correlation_id(args: &[Value]) -> Option<String> {
    let first = args.first()?.as_object()?;
    let id = ["cid", "correlationId", "requestId"]
        .iter()
        .filter_map(|key| first.get(*key))
        .find(|value| !value.is_null())?;
    id.as_str().map(|text| text.chars().take(64).collect())
}

/// `fs:read` logs under `ipc.fs`, `browser-click` under `ipc.browser`.
pub fn scope_for(channel: &str) -> String {
    let head = channel.split([':', '-', '.']).next().unwrap_or("");
    let name: String = head.chars().filter(char::is_ascii_alphanumeric).collect();
    format!("ipc.{}", if name.is_empty() { "misc" } else { &name })
}

/// Size and id of a call's arguments, taken before the handler consumes them.
pub struct ArgStats {
    argc: usize,
    bytes: usize,
    cid: Option<String>,
}

impl ArgStats {
    pub fn of(args: &[Value]) -> Self {
        Self {
            argc: args.len(),
            bytes: arg_bytes(args),
            cid: correlation_id(args),
        }
    }
}

/// Logs the end of a call. `error` is the failure message, if any.
pub fn finish(
    diag: &Diagnostics,
    channel: &str,
    dur_ms: u64,
    stats: &ArgStats,
    error: Option<&str>,
) {
    diag.note_slow(channel, dur_ms as f64);
    let mut data = Map::new();
    data.insert("channel".into(), json!(channel));
    data.insert("durMs".into(), json!(dur_ms));
    data.insert("argc".into(), json!(stats.argc));
    data.insert("bytes".into(), json!(stats.bytes));
    if let Some(cid) = &stats.cid {
        data.insert("cid".into(), json!(cid));
    }
    let scope = scope_for(channel);
    if let Some(message) = error {
        let info = ErrorInfo::new("Error", message);
        diag.fail(
            &scope,
            &format!("{channel} failed"),
            &info,
            Some(Value::Object(data)),
        );
        return;
    }
    let limit = ipc_slow_ms(channel);
    if dur_ms > limit {
        data.insert("limitMs".into(), json!(limit));
        diag.warn(
            &scope,
            &format!("{channel} slow"),
            Some(Value::Object(data)),
        );
    } else {
        diag.debug(&scope, channel, Some(Value::Object(data)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use draggy_diagnostics::{Config, SystemClock};
    use std::sync::Arc;

    fn open(dir: &std::path::Path) -> Diagnostics {
        let config = Config::from_env(|_| None, "test", 1, true, None);
        Diagnostics::open(dir, config, Arc::new(SystemClock::default()))
    }

    fn events(dir: &std::path::Path) -> Vec<Value> {
        std::fs::read_to_string(dir.join("events.jsonl"))
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    #[test]
    fn logs_channel_duration_count_and_size_never_the_values() {
        let dir = tempfile::tempdir().unwrap();
        let diag = open(dir.path());
        let args = [json!({"cid": "turn-7"}), json!("secret file name")];
        finish(&diag, "fs:read", 3, &ArgStats::of(&args), None);

        let line = events(dir.path())
            .into_iter()
            .find(|e| e["msg"] == "fs:read")
            .unwrap();
        assert_eq!(line["level"], "DEBUG");
        assert_eq!(line["scope"], "ipc.fs");
        assert_eq!(line["cid"], "turn-7");
        assert_eq!(line["data"]["channel"], "fs:read");
        assert_eq!(line["data"]["argc"], 2);
        assert!(line["data"]["bytes"].as_u64().unwrap() > 10);
        assert!(!line.to_string().contains("secret file name"));
    }

    #[test]
    fn takes_an_image_jobs_request_id_as_its_correlation_id() {
        let args = [json!({"requestId": "img-42", "prompt": "a private prompt"})];
        assert_eq!(correlation_id(&args).as_deref(), Some("img-42"));
        assert_eq!(correlation_id(&[json!("x")]), None);
        assert_eq!(correlation_id(&[json!({"cid": 5})]), None);
    }

    #[test]
    fn logs_a_failed_call_at_error() {
        let dir = tempfile::tempdir().unwrap();
        let diag = open(dir.path());
        finish(&diag, "a:async", 1, &ArgStats::of(&[]), Some("later"));
        let failed: Vec<_> = events(dir.path())
            .into_iter()
            .filter(|e| e["level"] == "ERROR")
            .collect();
        assert_eq!(failed.len(), 1);
        assert_eq!(failed[0]["msg"], "a:async failed");
    }

    #[test]
    fn warns_past_the_limit_with_a_higher_bar_for_long_channels() {
        assert_eq!(ipc_slow_ms("fs:read"), 2000);
        assert!(ipc_slow_ms("gguf:start") > 2000);
        let dir = tempfile::tempdir().unwrap();
        let diag = open(dir.path());
        finish(&diag, "slow:one", 2100, &ArgStats::of(&[]), None);
        let line = events(dir.path())
            .into_iter()
            .find(|e| e["msg"] == "slow:one slow")
            .unwrap();
        assert_eq!(line["level"], "WARN");
        assert_eq!(line["data"]["limitMs"], 2000);
    }

    #[test]
    fn does_not_log_the_logs_own_channels() {
        for channel in ["logs:write", "logs:batch", "logs:tail", "logs:open"] {
            assert!(is_silent(channel));
        }
        assert!(is_silent("browser-pane:bounds"));
        assert!(!is_silent("fs:read"));
    }

    #[test]
    fn measures_strings_and_objects() {
        let args = [json!("abc"), json!({"a": 1}), Value::Null];
        assert_eq!(arg_bytes(&args), 3 + 7);
    }

    #[test]
    fn scopes_by_the_first_word() {
        assert_eq!(scope_for("fs:read"), "ipc.fs");
        assert_eq!(scope_for("browser-click"), "ipc.browser");
        assert_eq!(scope_for(":x"), "ipc.misc");
    }
}
