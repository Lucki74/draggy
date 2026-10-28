//! The pure parts of the Antigravity adapter: the prompt of a turn, the event stream, the build check and the
//! failure a finished run stands for.

use std::path::{Path, PathBuf};

use serde_json::Value;

use super::failure::{google_failure, parse_google_error};
use crate::claude::adapter::{flatten, text_of};
use crate::types::{ErrorKind, ProviderError, Usage};
use crate::usage::from_totals;

pub const PRINT_TIMEOUT: &str = "5m";
/// The CLI's own timeout plus a minute, for a process that hangs past it.
pub const WATCHDOG_MS: u64 = 6 * 60_000;
pub const PROBE_MS: u64 = 15_000;
/// A command line holds at most 32767 characters on Windows; the rest is the flags and the path.
pub const MAX_PROMPT: usize = 24_000;
pub const MAX_STDERR: usize = 8_000;
pub const VERIFY_PROMPT: &str = "Reply with the single word ok.";
pub const PERMISSION_MESSAGE: &str = "The Antigravity CLI is set to run tools without asking, which Draggy does not allow. Set its permissions back to asking.";

fn failure(kind: ErrorKind, message: &str) -> ProviderError {
    ProviderError {
        kind,
        status: Some(0),
        message: Some(message.to_owned()),
        provider_message: Some(message.to_owned()),
        retry_after: None,
    }
}

/// The first `agy` on the search path, or the one `override_path` names. Only an `.exe` on Windows: nothing runs
/// through a shell.
pub fn locate_agy(
    override_path: Option<&str>,
    search_path: &str,
    is_windows: bool,
    exists: &dyn Fn(&Path) -> bool,
) -> Option<PathBuf> {
    if let Some(forced) = override_path.filter(|p| !p.is_empty()) {
        return exists(Path::new(forced)).then(|| PathBuf::from(forced));
    }
    let name = if is_windows { "agy.exe" } else { "agy" };
    let delimiter = if is_windows { ';' } else { ':' };
    search_path
        .split(delimiter)
        .filter(|dir| !dir.is_empty())
        .map(|dir| Path::new(dir).join(name))
        .find(|candidate| exists(candidate))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuildVerdict {
    pub ok: bool,
    pub version: String,
    pub reason: Option<String>,
}

/// Accepts a build only when it prints the typed event stream: older builds print plain text and cannot be parsed.
pub fn judge_build(version: &str, help: &str) -> BuildVerdict {
    if !help.contains("--output-format") || !help.contains("stream-json") {
        return BuildVerdict {
            ok: false,
            version: version.to_owned(),
            reason: Some(
                "This agy build cannot print the stream-json output Draggy reads. Update the Antigravity CLI."
                    .to_owned(),
            ),
        };
    }
    BuildVerdict {
        ok: true,
        version: version.to_owned(),
        reason: None,
    }
}

fn units(text: &str) -> usize {
    text.encode_utf16().count()
}

/// The prompt of one turn: the conversation so far as text, then the new message. Oldest turns go first when it is
/// too long. Returns the prompt and how many earlier messages were dropped.
pub fn to_prompt(messages: &[Value]) -> (String, usize) {
    let is_user = |m: &Value| m.get("role").and_then(Value::as_str) == Some("user");
    let last_user = messages.iter().rposition(is_user);
    let history = match last_user {
        Some(i) => &messages[..i],
        None => messages,
    };
    let text = last_user
        .map(|i| text_of(messages[i].get("content").unwrap_or(&Value::Null)))
        .unwrap_or_default();
    let mut kept = history;
    let mut earlier = flatten(kept);
    let mut dropped = 0;
    while units(&earlier) + units(&text) > MAX_PROMPT && !kept.is_empty() {
        kept = &kept[1..];
        dropped += 1;
        earlier = flatten(kept);
    }
    let prompt = [earlier, text]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    (prompt, dropped)
}

/// The arguments of one headless turn.
pub fn turn_args(prompt: &str, model: Option<&str>) -> Vec<String> {
    let mut args = vec![
        "-p".to_owned(),
        prompt.to_owned(),
        "--output-format".to_owned(),
        "stream-json".to_owned(),
        "--print-timeout".to_owned(),
        PRINT_TIMEOUT.to_owned(),
    ];
    if let Some(model) = model.filter(|m| !m.is_empty()) {
        args.push("--model".to_owned());
        args.push(model.to_owned());
    }
    args
}

/// The token counts a result reports.
pub fn usage_of(usage: Option<&Value>) -> Usage {
    let read = |names: [&str; 2]| {
        names
            .iter()
            .find_map(|name| usage.and_then(|u| u.get(*name)).and_then(Value::as_u64))
            .unwrap_or(0)
    };
    from_totals(
        read(["input_tokens", "prompt_tokens"]),
        read(["output_tokens", "completion_tokens"]),
    )
}

/// One thing the stream said.
#[derive(Debug, Clone, PartialEq)]
pub enum AgyEvent {
    Init {
        permission_mode: Option<String>,
        tools: usize,
    },
    /// Answer text.
    Delta(String),
    /// A tool agy ran on its own, which Draggy does not offer.
    Tool {
        name: String,
        failed: bool,
    },
    /// A line that is not an event, by its length.
    Stray(usize),
    Result(Value),
}

/// Reads the NDJSON stream one event at a time.
#[derive(Debug, Default)]
pub struct EventReader {
    buffer: String,
}

impl EventReader {
    pub fn push(&mut self, chunk: &str) -> Vec<AgyEvent> {
        self.buffer.push_str(chunk);
        let mut events = Vec::new();
        while let Some(at) = self.buffer.find('\n') {
            let line: String = self.buffer.drain(..=at).collect();
            read_line(&line, &mut events);
        }
        events
    }

    pub fn end(&mut self) -> Vec<AgyEvent> {
        let mut events = Vec::new();
        let rest = std::mem::take(&mut self.buffer);
        read_line(&rest, &mut events);
        events
    }
}

fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) | Some(Value::Bool(false)) => false,
        Some(Value::String(text)) => !text.is_empty(),
        Some(_) => true,
    }
}

fn read_line(line: &str, events: &mut Vec<AgyEvent>) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }
    let Ok(event) = serde_json::from_str::<Value>(trimmed) else {
        events.push(AgyEvent::Stray(units(trimmed)));
        return;
    };
    let text = |name: &str| event.get(name).and_then(Value::as_str);
    match text("event") {
        Some("init") => events.push(AgyEvent::Init {
            permission_mode: text("permission_mode").map(str::to_owned),
            tools: event
                .get("tools")
                .and_then(Value::as_array)
                .map_or(0, Vec::len),
        }),
        Some("step_update") => {
            let step = text("step_type");
            let delta = text("text_delta").filter(|d| !d.is_empty());
            if let (Some(delta), Some("agent_response")) = (delta, step) {
                events.push(AgyEvent::Delta(delta.to_owned()));
            } else if step == Some("tool") && text("state") == Some("DONE") {
                let info = event.get("tool_info");
                let name = text("tool_name")
                    .filter(|n| !n.is_empty())
                    .or_else(|| info.and_then(|i| i.get("name")).and_then(Value::as_str))
                    .unwrap_or("");
                events.push(AgyEvent::Tool {
                    name: name.to_owned(),
                    failed: truthy(info.and_then(|i| i.get("error"))),
                });
            }
        }
        Some("result") => events.push(AgyEvent::Result(event)),
        _ => {}
    }
}

/// True when `init` reports a permission mode other than asking: the turn is then killed and refused.
pub fn permission_refused(permission_mode: Option<&str>) -> bool {
    permission_mode.is_some_and(|mode| !mode.is_empty() && mode != "request-review")
}

/// The failure a finished `result` event stands for, or `None` when it succeeded.
pub fn result_failure(result: &Value) -> Option<ProviderError> {
    let status = result.get("status").and_then(Value::as_str).unwrap_or("");
    if status == "SUCCESS" {
        return None;
    }
    if status == "CANCELED" || status == "INTERRUPTED" {
        return Some(failure(
            ErrorKind::UnknownError,
            &format!("The Antigravity CLI ended the run ({status})."),
        ));
    }
    let text = match result.get("error") {
        Some(Value::String(text)) => text.clone(),
        Some(other) if !other.is_null() => other.to_string(),
        _ => serde_json::json!({
            "message": format!(
                "The run ended as {}.",
                if status.is_empty() { "unknown" } else { status }
            )
        })
        .to_string(),
    };
    Some(google_failure(&text))
}

/// The failure of a process that ended with no `result` event: the stderr reason is all there is.
pub fn exit_failure(stderr: &str, code: Option<i32>) -> ProviderError {
    let code_text = code.map_or_else(|| "none".to_owned(), |c| c.to_string());
    let generic = format!("The Antigravity CLI exited with code {code_text}.");
    if stderr.is_empty() && parse_google_error(stderr).status == 0 {
        return failure(ErrorKind::UnknownError, &generic);
    }
    google_failure(stderr)
}

/// `agy models` lists the model slugs; the first word of each line is the slug.
pub fn parse_models(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if !line.chars().next()?.is_ascii_alphanumeric() {
                return None;
            }
            let end = line
                .find(|c: char| !(c.is_ascii_alphanumeric() || "_.:/-".contains(c)))
                .unwrap_or(line.len());
            Some(line[..end].to_owned())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn read_all(chunks: &[&str]) -> Vec<AgyEvent> {
        let mut reader = EventReader::default();
        let mut events: Vec<AgyEvent> = chunks.iter().flat_map(|c| reader.push(c)).collect();
        events.extend(reader.end());
        events
    }

    #[test]
    fn the_reader_joins_split_lines_and_counts_stray_ones() {
        let events = read_all(&[
            "{\"event\":\"init\",\"permission_mode\":\"request-review\",\"tools\":[{}]}\nnot js",
            "on\n{\"event\":\"step_update\",\"step_type\":\"agent_response\",\"text_delta\":\"hi\"}\n",
            "{\"event\":\"step_update\",\"step_type\":\"tool\",\"state\":\"DONE\",\"tool_info\":{\"name\":\"view_file\",\"error\":\"x\"}}\n{\"event\":\"result\",\"status\":\"SUCCESS\"}",
        ]);
        assert_eq!(
            events,
            vec![
                AgyEvent::Init {
                    permission_mode: Some("request-review".into()),
                    tools: 1
                },
                AgyEvent::Stray(8),
                AgyEvent::Delta("hi".into()),
                AgyEvent::Tool {
                    name: "view_file".into(),
                    failed: true
                },
                AgyEvent::Result(json!({"event":"result","status":"SUCCESS"})),
            ]
        );
    }

    #[test]
    fn a_permission_mode_other_than_asking_is_refused() {
        assert!(permission_refused(Some("auto")));
        assert!(!permission_refused(Some("request-review")));
        assert!(!permission_refused(None));
    }

    #[test]
    fn results_name_their_failure() {
        assert!(result_failure(&json!({"status":"SUCCESS"})).is_none());
        let canceled = result_failure(&json!({"status":"CANCELED"})).unwrap();
        assert_eq!(canceled.kind, ErrorKind::UnknownError);
        let denied =
            result_failure(&json!({"status":"FAILED","error":{"code":403,"message":"no"}}))
                .unwrap();
        assert_eq!(denied.kind, ErrorKind::AccountAccessDenied);
        let bare = result_failure(&json!({"status":"FAILED"})).unwrap();
        assert_eq!(bare.message.as_deref(), Some("The run ended as FAILED."));
    }

    #[test]
    fn an_exit_without_a_result_reads_stderr() {
        assert_eq!(
            exit_failure("401 please sign in", Some(1)).kind,
            ErrorKind::AccountSignedOut
        );
        assert_eq!(
            exit_failure("", Some(2)).message.as_deref(),
            Some("The Antigravity CLI exited with code 2.")
        );
    }

    #[test]
    fn the_build_check_needs_the_event_stream() {
        assert!(judge_build("1.0", "--output-format stream-json").ok);
        assert!(!judge_build("0.1", "usage: agy").ok);
    }

    #[test]
    fn the_prompt_drops_the_oldest_turns_first() {
        let long = "x".repeat(MAX_PROMPT - 10);
        let messages = vec![
            json!({"role":"user","content":long}),
            json!({"role":"assistant","content":"old"}),
            json!({"role":"user","content":"question"}),
        ];
        let (prompt, dropped) = to_prompt(&messages);
        assert_eq!(dropped, 1);
        assert!(prompt.ends_with("question") && prompt.contains("old"));
        let (prompt, dropped) = to_prompt(&[json!({"role":"user","content":"hi"})]);
        assert_eq!((prompt.as_str(), dropped), ("hi", 0));
    }

    #[test]
    fn the_command_line_and_the_models_follow_the_cli() {
        assert_eq!(
            turn_args("hi", Some("m1")),
            [
                "-p",
                "hi",
                "--output-format",
                "stream-json",
                "--print-timeout",
                "5m",
                "--model",
                "m1"
            ]
        );
        assert_eq!(turn_args("hi", None).len(), 6);
        assert_eq!(
            parse_models("gemini-3 (default)\n\n  claude-4.5:x  note\n# no"),
            ["gemini-3", "claude-4.5:x"]
        );
        assert_eq!(
            usage_of(Some(&json!({"prompt_tokens":3,"completion_tokens":4}))),
            from_totals(3, 4)
        );
    }

    #[test]
    fn agy_is_found_on_the_search_path_or_by_override() {
        let exists = |p: &Path| p == Path::new("/b/agy");
        assert_eq!(
            locate_agy(None, "/a::/b", false, &exists),
            Some(PathBuf::from("/b/agy"))
        );
        assert_eq!(
            locate_agy(Some("/b/agy"), "", false, &exists),
            Some(PathBuf::from("/b/agy"))
        );
        assert_eq!(locate_agy(Some("/c/agy"), "/b", false, &exists), None);
    }
}
