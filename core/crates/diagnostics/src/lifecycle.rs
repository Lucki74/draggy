//! The session marker and the level file: how a run notes that it started and ended, and what a `keep` run carries over.

use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use serde_json::{Value, json};

use crate::config::{Level, parse_scopes_value};
use crate::format::{js_json, js_string, js_truthy};

pub(crate) const SESSION_MARKER: &str = "session.json";
pub(crate) const LEVEL_FILE: &str = "level.json";

/// What the previous run left in its marker. `crashed` means it never wrote its end. The id and start time keep the
/// JSON type the marker holds, as logger.cjs passes them on.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PreviousRun {
    pub crashed: bool,
    pub session: Option<Value>,
    pub started_at: Option<Value>,
}

/// A JSON file in the log folder, or `None` when it is missing or not JSON.
pub(crate) fn read_json(path: &Path) -> Option<Value> {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
}

/// `{id, startedAt, pid, clean}` in the key order logger.cjs writes.
pub(crate) fn marker_text(id: &str, started_at: &str, pid: u32, clean: bool) -> String {
    js_json(&json!({"id": id, "startedAt": started_at, "pid": pid, "clean": clean}))
}

/// What the previous marker says. A run is crashed unless its marker has `clean: true`.
pub(crate) fn previous_run(previous: Option<&Value>) -> PreviousRun {
    let Some(previous) = previous.filter(|value| js_truthy(value)) else {
        return PreviousRun::default();
    };
    PreviousRun {
        crashed: !matches!(previous.get("clean"), Some(Value::Bool(true))),
        session: non_null(previous.get("id")),
        started_at: non_null(previous.get("startedAt")),
    }
}

/// The warning line and its data for a previous run that did not end cleanly, or `None` when it did.
pub(crate) fn crash_notice(previous: Option<&Value>) -> Option<(String, Value)> {
    let previous = previous.filter(|value| js_truthy(value))?;
    if matches!(previous.get("clean"), Some(Value::Bool(true))) {
        return None;
    }
    let id = previous
        .get("id")
        .map_or_else(|| "undefined".to_owned(), js_string);
    let started = previous
        .get("startedAt")
        .map_or_else(|| "undefined".to_owned(), js_string);
    let message = format!(
        "previous session {id} ended without session-end (crash or kill), started {started}"
    );
    let data = match previous.get("id") {
        Some(session) => json!({"previousSession": session}),
        None => json!({}),
    };
    Some((message, data))
}

/// The level a `keep` run saved, when the file says keep is true. Its scopes are merged into the raised list.
pub(crate) struct Kept {
    pub(crate) level: Option<Level>,
    pub(crate) scopes: Vec<String>,
}

pub(crate) fn kept_level(saved: &Value) -> Option<Kept> {
    if saved.get("keep") != Some(&Value::Bool(true)) {
        return None;
    }
    let level = saved
        .get("level")
        .filter(|value| js_truthy(value))
        .and_then(|value| Level::parse(&js_string(value)));
    Some(Kept {
        level,
        scopes: parse_scopes_value(saved.get("scopes")),
    })
}

/// The `level.json` body for a level that is kept: level name, scopes and `keep: true`.
pub(crate) fn level_file_text(level: Level, scopes: &[String]) -> String {
    js_json(&json!({"level": level.name(), "scopes": scopes, "keep": true}))
}

/// Writes a log-folder file. A failure is logged and dropped: the writer never fails the caller.
pub(crate) fn write_file(path: &Path, text: &str) {
    if let Err(err) = fs::write(path, text) {
        tracing::warn!(target: "diagnostics.write", %err, "log file write failed");
    }
}

/// Removes a log-folder file. A missing file is the normal case, so it is not an error.
pub(crate) fn remove_file(path: &Path) {
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(err) if err.kind() == ErrorKind::NotFound => {}
        Err(err) => tracing::warn!(target: "diagnostics.write", %err, "log file remove failed"),
    }
}

fn non_null(value: Option<&Value>) -> Option<Value> {
    value.filter(|value| !value.is_null()).cloned()
}
