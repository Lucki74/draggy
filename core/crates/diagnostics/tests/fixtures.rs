//! Runs the golden fixtures in `shared/fixtures/diagnostics` through the writer. The vitest runner in
//! `src/__tests__/fixtures/diagnostics.test.ts` performs the same ops on electron/logger.cjs, so both must agree.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};

use draggy_diagnostics::{
    Clock, Config, Diagnostics, ErrorInfo, Level, LevelChange, LogFile, Scopes, Stat, TimeOptions,
    ipc_slow_ms, scrub_paths, scrub_secrets,
};
use draggy_testkit::{cases, files};
use serde_json::{Value, json};
use tempfile::TempDir;

/// Wall time moves only when an `advance` op moves it. Monotonic time moves only when a timer op sets it.
struct ScriptClock {
    unix_ms: AtomicI64,
    mono: Mutex<f64>,
}

impl ScriptClock {
    fn new(unix_ms: i64) -> Self {
        Self {
            unix_ms: AtomicI64::new(unix_ms),
            mono: Mutex::new(0.0),
        }
    }

    fn advance(&self, ms: i64) {
        self.unix_ms.fetch_add(ms, Ordering::SeqCst);
    }

    fn set_mono(&self, value: f64) {
        *self
            .mono
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = value;
    }
}

impl Clock for ScriptClock {
    fn unix_ms(&self) -> i64 {
        self.unix_ms.load(Ordering::SeqCst)
    }

    fn mono_ms(&self) -> f64 {
        *self
            .mono
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

/// The timer's start, in the same units as the TypeScript runner's `performance.now` mock.
const MONO_START: f64 = 1000.0;

#[test]
fn fixtures_match_the_typescript_reference() {
    for file in files("diagnostics") {
        for case in cases("diagnostics", &file) {
            let name = case["name"].as_str().unwrap_or_default();
            let input = &case["input"];
            let actual = match file.as_str() {
                "scrub.json" => json!(scrub_secrets(input.as_str().unwrap_or_default())),
                "paths.json" => json!(scrub_paths(
                    input["text"].as_str().unwrap_or_default(),
                    input["home"].as_str(),
                    input["user"].as_str(),
                )),
                "hash.json" => run_hash(input.as_str().unwrap_or_default()),
                "format.json" | "ingest.json" | "levelLines.json" | "values.json" => {
                    run_format(input)
                }
                "helpers.json" => run_helpers(input),
                "levels.json" => run_levels(input),
                "ingestCaps.json" => run_caps(input),
                "session.json" => run_session(input),
                "recent.json" => run_recent(input),
                "rotation.json" => run_rotation(input),
                "thresholds.json" => {
                    let limit = ipc_slow_ms(input.as_str().unwrap_or_default());
                    // u64::MAX stands for a channel whose TypeScript limit is a prototype member: it never warns.
                    if limit == u64::MAX {
                        json!("never")
                    } else {
                        json!(limit)
                    }
                }
                other => panic!("no runner for {other}"),
            };
            assert_eq!(actual, case["expected"], "{file}: {name}");
        }
    }
}

/// A writer under a fresh folder, with the case's environment, clock, session, pid and any files already in the log folder.
struct Case {
    _dir: TempDir,
    logs: PathBuf,
    diagnostics: Diagnostics,
    clock: Arc<ScriptClock>,
}

fn open_case(input: &Value) -> Case {
    let packaged = input["packaged"].as_bool().unwrap_or(true);
    let env_local = input["envLocal"].as_str().map(str::to_owned);
    let env: BTreeMap<String, String> = input["env"]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(key, value)| Some((key.clone(), value.as_str()?.to_owned())))
        .collect();
    let pid = u32::try_from(input["pid"].as_u64().unwrap_or(4242)).unwrap_or(4242);
    let session = input["session"].as_str().unwrap_or_default();
    let mut config = Config::from_env(
        |key| env.get(key).cloned(),
        session,
        pid,
        packaged,
        env_local.as_deref(),
    );
    if let Some(max) = input["maxBytes"].as_u64() {
        config.max_bytes = max;
    }

    let dir = tempfile::tempdir().expect("temp dir");
    let logs = dir.path().join("logs");
    fs::create_dir_all(&logs).expect("log folder");
    for (name, content) in input["files"].as_object().into_iter().flatten() {
        let text = match content {
            Value::String(raw) => raw.clone(),
            other => other.to_string(),
        };
        fs::write(logs.join(name), text).expect("seed file");
    }
    if let Some(fill) = input.get("fill").filter(|spec| !spec.is_null()) {
        let bytes = usize::try_from(fill["bytes"].as_u64().unwrap_or(0)).unwrap_or(0);
        let name = fill["file"].as_str().unwrap_or_default();
        fs::write(logs.join(name), "a".repeat(bytes)).expect("fill file");
    }
    let clock = Arc::new(ScriptClock::new(input["clock"].as_i64().unwrap_or(0)));
    let diagnostics = Diagnostics::open(logs.clone(), config, clock.clone());
    Case {
        _dir: dir,
        logs,
        diagnostics,
        clock,
    }
}

/// The three files as text. A file that was never written reads as empty.
struct Logs {
    app: String,
    debug: String,
    events: String,
}

fn read_logs(logs: &Path) -> Logs {
    let read = |name: &str| fs::read_to_string(logs.join(name)).unwrap_or_default();
    Logs {
        app: read("app.log"),
        debug: read("debug.log"),
        events: read("events.jsonl"),
    }
}

/// Lines of a file, split on `\n` as the TypeScript runner splits them, with the trailing empty line dropped.
fn split_lines(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = text.split('\n').map(str::to_owned).collect();
    if lines.last().is_some_and(String::is_empty) {
        lines.pop();
    }
    lines
}

/// Lines after `before`, which every file starts with: the boot line `open` wrote, dropped as the runner does.
fn lines_after(before: &str, after: &str) -> Vec<String> {
    split_lines(after.get(before.len()..).unwrap_or_default())
}

/// The boot line is sequence 1 in every file. Its text names the Electron runtime, so no case pins it.
fn without_boot(lines: Vec<String>) -> Vec<String> {
    lines
        .into_iter()
        .filter(|line| {
            if line.starts_with('{') {
                let seq = serde_json::from_str::<Value>(line)
                    .ok()
                    .and_then(|record| record["seq"].as_u64());
                return seq != Some(1);
            }
            !line
                .split(' ')
                .nth(2)
                .is_some_and(|tag| tag.ends_with(".1"))
        })
        .collect()
}

/// A number the way the TypeScript runner writes an integer-valued one, so 1767225660123.0 compares equal to 1767225660123.
fn whole(value: f64) -> Value {
    if value.fract() == 0.0 && value.abs() < 9.0e15 {
        json!(value as i64)
    } else {
        json!(value)
    }
}

fn run_format(input: &Value) -> Value {
    let case = open_case(input);
    let before = read_logs(&case.logs);
    run_ops(&case.diagnostics, &case.clock, &input["ops"]);
    let after = read_logs(&case.logs);
    json!({
        "app": lines_after(&before.app, &after.app),
        "debug": lines_after(&before.debug, &after.debug),
        "events": lines_after(&before.events, &after.events),
    })
}

/// Format lines plus the text `read_tail` gives for the file the case names.
fn run_helpers(input: &Value) -> Value {
    let case = open_case(input);
    let before = read_logs(&case.logs);
    run_ops(&case.diagnostics, &case.clock, &input["ops"]);
    let after = read_logs(&case.logs);
    let tail = match input.get("tail").filter(|spec| !spec.is_null()) {
        Some(spec) => {
            let text = case.diagnostics.read_tail(
                log_file(spec["file"].as_str().unwrap_or_default()),
                tail_count(spec),
            );
            tail_of(&text, spec["summary"] == json!(true))
        }
        None => Value::Null,
    };
    json!({
        "app": lines_after(&before.app, &after.app),
        "debug": lines_after(&before.debug, &after.debug),
        "events": lines_after(&before.events, &after.events),
        "tail": tail,
    })
}

/// The count a fixture's `tail` names, as `readTail` receives it: absent is the default (None), and any other value is
/// read as JavaScript's `Number(value)` would be, floored, with a value that is not a finite number taking the default.
fn tail_count(spec: &Value) -> Option<i64> {
    let raw = spec.get("bytes")?;
    let number = js_number(raw)?;
    Some(number.floor() as i64)
}

/// JavaScript's `Number(value)` for the JSON a fixture uses: numbers, numeric text, booleans and null. None when NaN or infinite.
fn js_number(value: &Value) -> Option<f64> {
    let number = match value {
        Value::Null => 0.0,
        Value::Bool(flag) => f64::from(u8::from(*flag)),
        Value::Number(number) => number.as_f64()?,
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                0.0
            } else {
                trimmed.parse::<f64>().ok()?
            }
        }
        _ => return None,
    };
    number.is_finite().then_some(number)
}

/// The text a tail read gives, or with `summary` its length in UTF-16 units and its first and last ten and thirty units.
fn tail_of(text: &str, summary: bool) -> Value {
    if !summary {
        return json!(text);
    }
    let units: Vec<u16> = text.encode_utf16().collect();
    json!({
        "length": units.len(),
        "start": String::from_utf16_lossy(&units[..units.len().min(10)]),
        "end": String::from_utf16_lossy(&units[units.len().saturating_sub(30)..]),
    })
}

/// The first `count` UTF-16 units of a line, as the fixture's rotation summary cuts them.
fn units(text: &str, count: usize) -> String {
    let units: Vec<u16> = text.encode_utf16().take(count).collect();
    String::from_utf16_lossy(&units)
}

/// Recent-line dumps: the data of each `recent events before failure` record, in the order they were written.
fn run_recent(input: &Value) -> Value {
    let case = open_case(input);
    run_ops(&case.diagnostics, &case.clock, &input["ops"]);
    let events = read_logs(&case.logs).events;
    let dumps: Vec<Value> = split_lines(&events)
        .iter()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|record| record["msg"] == "recent events before failure")
        .map(|record| record["data"].clone())
        .collect();
    json!(dumps)
}

/// Rotation: every log file in the folder after the ops, with its size, line count and first and last lines cut to 60 units.
fn run_rotation(input: &Value) -> Value {
    let case = open_case(input);
    run_ops(&case.diagnostics, &case.clock, &input["ops"]);
    let mut names: Vec<String> = fs::read_dir(&case.logs)
        .expect("log folder")
        .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
        .filter(|name| name != "session.json" && name != "level.json")
        .collect();
    names.sort();
    let mut files = serde_json::Map::new();
    for name in names {
        let path = case.logs.join(&name);
        let lines = split_lines(&fs::read_to_string(&path).unwrap_or_default());
        files.insert(
            name,
            json!({
                "bytes": fs::metadata(&path).map_or(0, |meta| meta.len()),
                "lines": lines.len(),
                "first": lines.first().map(|line| units(line, 60)),
                "last": lines.last().map(|line| units(line, 60)),
            }),
        );
    }
    Value::Object(files)
}

/// Probe messages that reached each file, in op order, plus the level state after the ops.
fn run_levels(input: &Value) -> Value {
    let case = open_case(input);
    run_ops(&case.diagnostics, &case.clock, &input["ops"]);
    let logs = read_logs(&case.logs);
    let state = case.diagnostics.level_state();
    let probes: Vec<&str> = input["ops"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|op| matches!(op["op"].as_str(), Some("debug" | "info" | "warn" | "error")))
        .filter_map(|op| op["message"].as_str())
        .collect();
    json!({
        "level": state.level.name(),
        "scopes": state.scopes,
        "app": probes.iter().filter(|message| logs.app.contains(*message)).collect::<Vec<_>>(),
        "debug": probes.iter().filter(|message| logs.debug.contains(*message)).collect::<Vec<_>>(),
    })
}

/// Renderer ingestion: how many renderer lines reached events.jsonl, and the count each dropped-entries warning reported.
fn run_caps(input: &Value) -> Value {
    let case = open_case(input);
    run_ops(&case.diagnostics, &case.clock, &input["ops"]);
    let events: Vec<Value> = split_lines(&read_logs(&case.logs).events)
        .iter()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    let rendered = events
        .iter()
        .filter(|event| {
            event["scope"]
                .as_str()
                .is_some_and(|scope| scope.starts_with("renderer."))
        })
        .count();
    let dropped: Vec<Value> = events
        .iter()
        .filter(|event| event["scope"] == "logger" && event["msg"] == "renderer entries dropped")
        .map(|event| event["data"]["count"].clone())
        .collect();
    json!({ "rendered": rendered, "dropped": dropped })
}

/// Lifecycle: the previous run's marker, the state after the ops, the marker and level file as written, and every line, boot line left out.
fn run_session(input: &Value) -> Value {
    let case = open_case(input);
    run_ops(&case.diagnostics, &case.clock, &input["ops"]);
    let previous = case.diagnostics.previous_run();
    let state = case.diagnostics.level_state();
    let text_or_null =
        |name: &str| fs::read_to_string(case.logs.join(name)).map_or(Value::Null, Value::String);
    let logs = read_logs(&case.logs);
    json!({
        "previous": {
            "crashed": previous.crashed,
            "session": previous.session.unwrap_or(Value::Null),
            "startedAt": previous.started_at.unwrap_or(Value::Null),
        },
        "state": {
            "level": state.level.name(),
            "scopes": state.scopes,
            "keep": state.keep,
            "until": state.until.map(whole),
        },
        "marker": text_or_null("session.json"),
        "level": text_or_null("level.json"),
        "app": without_boot(split_lines(&logs.app)),
        "debug": without_boot(split_lines(&logs.debug)),
        "events": without_boot(split_lines(&logs.events)),
    })
}

/// The writer's stored form of `text` under a `prompt` key, read back from events.jsonl.
fn run_hash(text: &str) -> Value {
    let case = open_case(&json!({}));
    case.diagnostics
        .info("hash", "hashed", Some(json!({ "prompt": text })));
    let events = read_logs(&case.logs).events;
    let last = events.lines().last().unwrap_or("{}");
    let record: Value = serde_json::from_str(last).unwrap_or(Value::Null);
    record["data"]["prompt"].clone()
}

fn log_file(name: &str) -> LogFile {
    match name {
        "debug" => LogFile::Debug,
        "events" => LogFile::Events,
        _ => LogFile::App,
    }
}

fn level_of(value: &Value) -> Option<Level> {
    value.as_str().and_then(Level::parse)
}

fn run_ops(diagnostics: &Diagnostics, clock: &ScriptClock, ops: &Value) {
    for op in ops.as_array().into_iter().flatten() {
        let scope = op["scope"].as_str().unwrap_or_default();
        let message = op["message"].as_str().unwrap_or_default();
        let data = op.get("data").cloned();
        match op["op"].as_str().unwrap_or_default() {
            "debug" => diagnostics.debug(scope, message, data),
            "info" => diagnostics.info(scope, message, data),
            "warn" => diagnostics.warn(scope, message, data),
            "error" => diagnostics.error(scope, message, data),
            "fail" => diagnostics.fail(scope, message, &error_info(&op["error"]), data),
            "swallow" => {
                let error = op.get("error").map(error_info);
                diagnostics.swallow(
                    scope,
                    error.as_ref(),
                    op["why"].as_str().unwrap_or_default(),
                );
            }
            "swallowed" => {
                let error = op.get("error").map(error_info);
                diagnostics.swallowed(
                    scope,
                    error.as_ref(),
                    op["why"].as_str().unwrap_or_default(),
                    (),
                );
            }
            "time" => {
                clock.set_mono(MONO_START);
                let options = TimeOptions {
                    warn_ms: op["warnMs"].as_f64(),
                    ..TimeOptions::default()
                };
                let mut timer = diagnostics.time(
                    scope,
                    op["label"].as_str().unwrap_or_default(),
                    data,
                    options,
                );
                clock.set_mono(MONO_START + op["elapsedMs"].as_f64().unwrap_or(0.0));
                let end_data = op.get("endData").cloned();
                if op["end"].as_str() == Some("fail") {
                    timer.fail(&error_info(&op["error"]), end_data);
                } else {
                    timer.end(end_data);
                }
            }
            "once" => {
                diagnostics.once(
                    op["key"].as_str().unwrap_or_default(),
                    scope,
                    message,
                    data,
                    level_of(&op["level"]).unwrap_or(Level::Warn),
                );
            }
            "limited" => {
                diagnostics.limited(
                    op["key"].as_str().unwrap_or_default(),
                    level_of(&op["level"]).unwrap_or(Level::Info),
                    scope,
                    message,
                    data,
                    op["windowMs"].as_f64().unwrap_or(10_000.0),
                );
            }
            "ingest" => {
                // A null `entries` falls back to `entry`, as `op.entries ?? op.entry` does.
                let batch = match op.get("repeat") {
                    Some(count) => {
                        let times = count.as_f64().map_or(0, |n| n.max(0.0) as usize);
                        Value::Array(vec![op["entry"].clone(); times])
                    }
                    None => match op.get("entries").filter(|entries| !entries.is_null()) {
                        Some(entries) => entries.clone(),
                        None => op["entry"].clone(),
                    },
                };
                diagnostics.ingest_renderer(&batch);
            }
            "advance" => {
                clock.advance(op["ms"].as_i64().unwrap_or(0));
                diagnostics.tick();
            }
            "register" => diagnostics.register_secret(op["value"].as_str().unwrap_or_default()),
            "setLevel" => {
                let items: Vec<String> = op["scopes"]
                    .as_array()
                    .map(|items| items.iter().map(js_text).collect())
                    .unwrap_or_default();
                let refs: Vec<&str> = items.iter().map(String::as_str).collect();
                let text = op
                    .get("scopes")
                    .filter(|value| !value.is_array())
                    .map(scope_text)
                    .unwrap_or_default();
                let scopes = match op.get("scopes") {
                    None => None,
                    Some(Value::Array(_)) => Some(Scopes::List(&refs)),
                    Some(_) => Some(Scopes::Text(&text)),
                };
                diagnostics.set_level(LevelChange {
                    level: op["level"].as_str(),
                    scopes,
                    duration_ms: op["durationMs"].as_f64(),
                    keep: op["keep"].as_bool().unwrap_or(false),
                });
            }
            "noteSlow" => {
                // A duration that is not a number is ignored, as the TypeScript does.
                if let Some(ms) = op["durMs"].as_f64() {
                    diagnostics.note_slow(op["channel"].as_str().unwrap_or_default(), ms);
                }
            }
            "noteStat" => {
                // A missing value counts as 1, a null one as 0, and a kind the writer does not know is ignored.
                let value = match op.get("value") {
                    None => Some(1.0),
                    Some(Value::Null) => Some(0.0),
                    Some(other) => other.as_f64(),
                };
                let stat = match op["kind"].as_str() {
                    Some("turn") => Some(Stat::Turn),
                    Some("engineCrash") => Some(Stat::EngineCrash),
                    Some("peakMB") => Some(Stat::PeakMb),
                    _ => None,
                };
                if let (Some(stat), Some(value)) = (stat, value) {
                    diagnostics.note_stat(stat, value);
                }
            }
            "endSession" => diagnostics.end_session(op["clean"].as_bool().unwrap_or(true)),
            "dumpRecent" => diagnostics.dump_recent(op["reason"].as_str().unwrap_or_default()),
            other => panic!("unknown op {other}"),
        }
    }
}

/// A list item as JavaScript's `String(item)` gives it. Whole numbers only: no fixture gives a fraction here.
fn js_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Null => "null".to_owned(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => number.to_string(),
        _ => "[object Object]".to_owned(),
    }
}

/// A non-array `scopes` value as `parseScopes` reads it: falsy values are empty, anything else is its text.
fn scope_text(value: &Value) -> String {
    match value {
        Value::Null | Value::Bool(false) => String::new(),
        other => js_text(other),
    }
}

/// An error as the fixture spells it. The name defaults to `Error`; a missing stack stays missing.
fn error_info(spec: &Value) -> ErrorInfo {
    ErrorInfo {
        name: spec["name"].as_str().unwrap_or("Error").to_owned(),
        message: spec["message"].as_str().unwrap_or_default().to_owned(),
        stack: spec["stack"].as_str().map(str::to_owned),
        code: spec["code"].as_str().map(str::to_owned),
        errno: spec["errno"].as_i64(),
        syscall: spec["syscall"].as_str().map(str::to_owned),
        status: spec["status"].as_i64(),
        cause: spec
            .get("cause")
            .filter(|cause| !cause.is_null())
            .map(|cause| Box::new(error_info(cause))),
    }
}
