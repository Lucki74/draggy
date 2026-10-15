//! Diagnostics writer, a port of electron/logger.cjs: `app.log`, `debug.log` and `events.jsonl`.
//! Timers are lazy: a timed level or limited window fires on the next call or `tick`, stamped at its due time.

mod clock;
mod config;
mod format;
mod ingest;
mod lifecycle;
mod ring;
mod sanitize;
mod scrub;
mod sink;
mod stats;
mod text;
mod thresholds;

use std::collections::HashSet;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use serde_json::{Map, Value, json};

pub use clock::{Clock, SystemClock};
pub use config::{
    Config, DEFAULT_MAX_BYTES, Level, LevelState, Scopes, debug_from_env_file, debug_setting,
};
pub use lifecycle::PreviousRun;
pub use ring::Ring;
pub use sanitize::ErrorInfo;
pub use scrub::{scrub_paths, scrub_secrets};
pub use stats::Stat;
pub use thresholds::ipc_slow_ms;

use clock::iso_ms;
use config::{scope_names, scope_raised};
use format::{Head, Record, js_string, js_truthy, line, record_line};
use ingest::{MAX_BATCH, MAX_PER_SECOND, RendererEntry, validate};
use lifecycle::{
    LEVEL_FILE, SESSION_MARKER, kept_level, level_file_text, marker_text, read_json, remove_file,
    write_file,
};
use sanitize::{app_error, describe, error_json, render, sanitize};
use scrub::{MIN_KNOWN_SECRET, scrub_with};
use sink::Sink;
use stats::Stats;
use text::{cut16, js_len};

const RECENT_LINES: usize = 100;
const MAX_LEVEL_SCOPES: usize = 50;
const MAX_SCOPE_UNITS: usize = 80;
const RECENT_MESSAGE_UNITS: usize = 120;
const MAX_ONCE_KEYS: usize = 2000;
const MAX_LEVEL_MS: f64 = 24.0 * 3600.0 * 1000.0;
const MAX_TAIL_BYTES: u64 = 2 * 1024 * 1024;
const DEFAULT_TAIL_BYTES: u64 = 64 * 1024;

/// The writer. Each call takes one lock and writes its lines in order. It never fails the caller.
/// Divergences: `log.info(scope, ...parts)` takes one message and one data value here, so callers join parts and convert
/// errors first. logger.cjs's terminal mirror is not ported; the shell decides what reaches stdout and stderr.
pub struct Diagnostics {
    dir: PathBuf,
    inner: Mutex<Inner>,
}

struct Inner {
    dir: PathBuf,
    clock: Arc<dyn Clock>,
    session_id: String,
    pid: u32,
    started_unix: i64,
    previous: PreviousRun,
    seq: u64,
    startup_level: Level,
    app_level: Level,
    debug_level: Level,
    raised: Vec<String>,
    keep: bool,
    known: Vec<String>,
    recent: Ring,
    app: Sink,
    debug: Sink,
    events: Sink,
    failure_reported: bool,
    once_keys: HashSet<String>,
    timers: Vec<Pending>,
    timer_seq: u64,
    rate_start: i64,
    rate_count: u32,
    stats: Stats,
}

/// The three files a writer keeps. `read_tail` reads one of them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LogFile {
    App,
    Debug,
    Events,
}

impl LogFile {
    fn file_name(self) -> &'static str {
        match self {
            Self::App => "app.log",
            Self::Debug => "debug.log",
            Self::Events => "events.jsonl",
        }
    }
}

/// What `Diagnostics::set_level` changes. `None` leaves a field alone. `duration_ms` ends a verbose level by itself, and `keep`
/// carries the level and scopes into the next boot.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LevelChange<'a> {
    pub level: Option<&'a str>,
    pub scopes: Option<Scopes<'a>>,
    pub duration_ms: Option<f64>,
    pub keep: bool,
}

/// How a timer reports: a warning past `warn_ms`, otherwise at `level`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TimeOptions {
    pub warn_ms: Option<f64>,
    pub level: Level,
}

impl Default for TimeOptions {
    fn default() -> Self {
        Self {
            warn_ms: None,
            level: Level::Info,
        }
    }
}

/// An open timer from `Diagnostics::time`. `end` logs the duration, `fail` logs it as an error. Only the first call counts.
pub struct Timer<'a> {
    diagnostics: &'a Diagnostics,
    scope: String,
    label: String,
    data: Option<Value>,
    options: TimeOptions,
    started: f64,
    finished: bool,
}

impl Timer<'_> {
    pub fn end(&mut self, extra: Option<Value>) {
        if self.finished {
            return;
        }
        self.finished = true;
        let elapsed = self.diagnostics.mono_ms() - self.started;
        let slow = self.options.warn_ms.is_some_and(|limit| elapsed > limit);
        let (level, label) = if slow {
            (Level::Warn, format!("{} slow", self.label))
        } else {
            (self.options.level, self.label.clone())
        };
        let data = with_duration(self.data.take(), extra, elapsed);
        self.diagnostics
            .emit(level, &self.scope, &label, Some(data), None);
    }

    pub fn fail(&mut self, error: &ErrorInfo, extra: Option<Value>) {
        if self.finished {
            return;
        }
        self.finished = true;
        let elapsed = self.diagnostics.mono_ms() - self.started;
        let data = with_duration(self.data.take(), extra, elapsed);
        let label = format!("{} failed", self.label);
        self.diagnostics
            .emit(Level::Error, &self.scope, &label, Some(data), Some(error));
    }
}

/// `{ ...data, ...extra, durMs }`: later keys win, and the duration comes last.
fn with_duration(data: Option<Value>, extra: Option<Value>, elapsed: f64) -> Value {
    let mut merged = spread(data);
    for (key, value) in spread(extra) {
        merged.insert(key, value);
    }
    merged.insert("durMs".to_owned(), json!(elapsed));
    Value::Object(merged)
}

/// What `{ ...value }` copies: an object's keys, an array's items under their indexes, a string's units under theirs.
/// Divergence: a lone surrogate unit of a string cannot be held in Rust, so it becomes U+FFFD.
fn spread(value: Option<Value>) -> Map<String, Value> {
    match value {
        Some(Value::Object(map)) => map,
        Some(Value::Array(items)) => items
            .into_iter()
            .enumerate()
            .map(|(index, item)| (index.to_string(), item))
            .collect(),
        Some(Value::String(text)) => text
            .encode_utf16()
            .enumerate()
            .map(|(index, unit)| {
                (
                    index.to_string(),
                    Value::String(String::from_utf16_lossy(&[unit])),
                )
            })
            .collect(),
        _ => Map::new(),
    }
}

/// A timer the writer still owes: a timed level's end, or a limited window's close. Ties on `due` fire in creation order.
struct Pending {
    due: f64,
    created: u64,
    kind: Kind,
}

enum Kind {
    Level,
    Window(Window),
}

/// An open `limited` window: the first call logged, and the repeats counted until the window closes.
struct Window {
    key: String,
    count: u64,
    level: Level,
    scope: String,
    message: String,
    data: Option<Value>,
    window_ms: f64,
}

/// One line about to be written: when, where, what, and the data and error it carries.
struct Entry<'a> {
    at: i64,
    level: Level,
    scope: &'a str,
    message: &'a str,
    data: Option<&'a Value>,
    error: Option<&'a ErrorInfo>,
    cid: Option<Value>,
}

impl Diagnostics {
    /// Opens the three files under `dir`, reading the previous marker and restoring a kept level, then writes the boot line.
    /// Divergence: the Electron boot line also names app and runtime versions, which the core does not have.
    pub fn open(dir: impl Into<PathBuf>, config: Config, clock: Arc<dyn Clock>) -> Self {
        let dir = dir.into();
        let Config {
            app_level,
            debug_level,
            scopes,
            session_id,
            pid,
            max_bytes,
        } = config;
        if let Err(err) = fs::create_dir_all(&dir) {
            tracing::warn!(target: "diagnostics.write", %err, "log folder failed");
        }
        let now = clock.unix_ms();
        let previous_marker = read_json(&dir.join(SESSION_MARKER));
        let mut inner = Inner {
            dir: dir.clone(),
            clock,
            session_id: session_id.clone(),
            pid,
            started_unix: now,
            previous: lifecycle::previous_run(previous_marker.as_ref()),
            seq: 0,
            startup_level: app_level,
            app_level,
            debug_level,
            raised: scopes,
            keep: false,
            known: Vec::new(),
            recent: Ring::new(RECENT_LINES),
            app: Sink::new(dir.join("app.log"), max_bytes),
            debug: Sink::new(dir.join("debug.log"), max_bytes),
            events: Sink::new(dir.join("events.jsonl"), max_bytes),
            failure_reported: false,
            once_keys: HashSet::new(),
            timers: Vec::new(),
            timer_seq: 0,
            rate_start: 0,
            rate_count: 0,
            stats: Stats::default(),
        };
        inner.write_marker(false);

        // A verbose level that was kept survives the restart; any other level file is stale and goes.
        let level_path = dir.join(LEVEL_FILE);
        if let Some(saved) = read_json(&level_path) {
            if let Some(kept) = kept_level(&saved) {
                if let Some(level) = kept.level {
                    inner.app_level = level;
                }
                inner.raised = union(&inner.raised, &kept.scopes);
                inner.keep = true;
            } else if js_truthy(&saved) {
                remove_file(&level_path);
            }
        }

        inner.log(
            Level::Info,
            "boot",
            "session started",
            Some(json!({ "session": session_id, "pid": pid })),
            None,
        );
        if let Some((message, data)) = lifecycle::crash_notice(previous_marker.as_ref()) {
            inner.log(Level::Warn, "boot", &message, Some(data), None);
        }
        Self {
            dir,
            inner: Mutex::new(inner),
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn session_id(&self) -> String {
        self.lock().session_id.clone()
    }

    /// What the previous run left behind: whether it crashed, and its session id and start time.
    pub fn previous_run(&self) -> PreviousRun {
        self.lock().previous.clone()
    }

    pub fn debug(&self, scope: &str, message: &str, data: Option<Value>) {
        self.emit(Level::Debug, scope, message, data, None);
    }

    pub fn info(&self, scope: &str, message: &str, data: Option<Value>) {
        self.emit(Level::Info, scope, message, data, None);
    }

    pub fn warn(&self, scope: &str, message: &str, data: Option<Value>) {
        self.emit(Level::Warn, scope, message, data, None);
    }

    pub fn error(&self, scope: &str, message: &str, data: Option<Value>) {
        self.emit(Level::Error, scope, message, data, None);
    }

    /// A failure with its error. The error's message is cut in `app.log` and kept whole in `debug.log`.
    pub fn fail(&self, scope: &str, message: &str, error: &ErrorInfo, data: Option<Value>) {
        self.emit(Level::Error, scope, message, data, Some(error));
    }

    /// An uncaught error, as logger.cjs logs it, then the recent lines. The Rust shell calls this where Electron has its process hooks.
    pub fn crash(&self, origin: &str, error: &ErrorInfo) {
        self.fail(origin, "", error, None);
        self.dump_recent(origin);
    }

    /// An error dropped on purpose. Logged at DEBUG, so it costs nothing until someone raises the scope.
    pub fn swallow(&self, scope: &str, error: Option<&ErrorInfo>, why: &str) {
        let mut data = Map::new();
        if let Some(error) = error {
            data.insert("error".to_owned(), json!(error.message));
            if let Some(code) = &error.code {
                data.insert("code".to_owned(), json!(code));
            }
        }
        self.emit(
            Level::Debug,
            scope,
            &format!("swallowed: {why}"),
            Some(Value::Object(data)),
            None,
        );
    }

    /// `swallow`, then the fallback: for an error that is dropped on the way to a default value.
    pub fn swallowed<T>(
        &self,
        scope: &str,
        error: Option<&ErrorInfo>,
        why: &str,
        fallback: T,
    ) -> T {
        self.swallow(scope, error, why);
        fallback
    }

    /// A stream chunk, recorded by its byte length alone. The chunk's text never reaches the writer.
    /// Divergence: logger.cjs has no such helper; it logs a chunk through `debug` with a hashed `rawChunk`. This keeps the length only.
    pub fn stream_chunk(&self, scope: &str, message: &str, cid: Option<&str>, chunk: &[u8]) {
        let mut data = json!({ "bytes": chunk.len() });
        if let (Some(cid), Some(map)) = (cid, data.as_object_mut()) {
            map.insert("cid".to_owned(), json!(cid));
        }
        self.emit(Level::Debug, scope, message, Some(data), None);
    }

    /// Starts a timer. Finish it with `end` or `fail`.
    pub fn time(
        &self,
        scope: &str,
        label: &str,
        data: Option<Value>,
        options: TimeOptions,
    ) -> Timer<'_> {
        Timer {
            diagnostics: self,
            scope: scope.to_owned(),
            label: label.to_owned(),
            data,
            options,
            started: self.mono_ms(),
            finished: false,
        }
    }

    /// Logs once per key for the session. Returns whether this call logged. The key set resets past 2000 keys.
    /// logger.cjs defaults `level` to WARN; callers pass it.
    pub fn once(
        &self,
        key: &str,
        scope: &str,
        message: &str,
        data: Option<Value>,
        level: Level,
    ) -> bool {
        let mut inner = self.lock();
        inner.settle();
        if inner.once_keys.contains(key) {
            return false;
        }
        if inner.once_keys.len() >= MAX_ONCE_KEYS {
            inner.once_keys.clear();
        }
        inner.once_keys.insert(key.to_owned());
        inner.log(level, scope, message, data, None);
        true
    }

    /// The first call logs. Calls with the same key inside `window_ms` are counted, and one summary line follows when the window closes.
    /// Returns whether this call logged. logger.cjs defaults `window_ms` to 10000; callers pass it.
    pub fn limited(
        &self,
        key: &str,
        level: Level,
        scope: &str,
        message: &str,
        data: Option<Value>,
        window_ms: f64,
    ) -> bool {
        let mut inner = self.lock();
        inner.settle();
        if let Some(open) = inner
            .timers
            .iter_mut()
            .find_map(|pending| match &mut pending.kind {
                Kind::Window(window) if window.key == key => Some(window),
                _ => None,
            })
        {
            open.count += 1;
            return false;
        }
        inner.log(level, scope, message, data.clone(), None);
        let due = inner.clock.unix_ms() as f64 + window_ms;
        inner.push_timer(
            due,
            Kind::Window(Window {
                key: key.to_owned(),
                count: 0,
                level,
                scope: scope.to_owned(),
                message: message.to_owned(),
                data,
                window_ms,
            }),
        );
        true
    }

    /// Renderer log entries as `logs:write` and `logs:batch` deliver them: one object or an array. Each entry is filed under `renderer.`,
    /// clamped, and counted against the batch and per-second caps. Dropped entries are reported once per batch.
    pub fn ingest_renderer(&self, input: &Value) {
        let mut inner = self.lock();
        inner.settle();
        let (entries, overflow): (Vec<&Value>, usize) = match input {
            Value::Array(items) => (
                items.iter().take(MAX_BATCH).collect(),
                items.len().saturating_sub(MAX_BATCH),
            ),
            other => (vec![other], 0),
        };
        let now = inner.clock.unix_ms();
        if now - inner.rate_start >= 1000 {
            inner.rate_start = now;
            inner.rate_count = 0;
        }
        let mut dropped = 0;
        for raw in entries {
            if inner.rate_count >= MAX_PER_SECOND {
                dropped += 1;
                continue;
            }
            let Some(entry) = validate(raw) else {
                dropped += 1;
                continue;
            };
            inner.rate_count += 1;
            if entry.message == "turn summary" {
                inner.stats.add_turns(1.0);
            }
            inner.log_entry(entry);
        }
        if dropped + overflow > 0 {
            inner.log(
                Level::Warn,
                "logger",
                "renderer entries dropped",
                Some(json!({ "count": dropped + overflow })),
                None,
            );
        }
    }

    /// Writes the last lines this writer produced, newest last. Logged under `logger`, so the dump does not feed itself.
    pub fn dump_recent(&self, reason: &str) {
        let mut inner = self.lock();
        inner.settle();
        let count = inner.recent.len();
        let recent = inner.recent.tail(count);
        inner.log(
            Level::Warn,
            "logger",
            "recent events before failure",
            Some(json!({ "reason": reason, "count": count, "recent": recent })),
            None,
        );
    }

    /// Changes the app level and the raised scopes without a restart. An unknown level returns to the startup level.
    /// Divergence: logger.cjs reads the environment again on each call; this keeps the startup reading.
    pub fn set_level(&self, change: LevelChange<'_>) {
        let mut inner = self.lock();
        inner.settle();
        let at = inner.clock.unix_ms();
        inner.apply_level(change, at);
    }

    pub fn level_state(&self) -> LevelState {
        let mut inner = self.lock();
        inner.settle();
        inner.level_state()
    }

    /// A value the keystore holds. Every later line has it replaced, whatever it looks like. Values under six units are skipped.
    pub fn register_secret(&self, value: &str) {
        if js_len(value) < MIN_KNOWN_SECRET {
            return;
        }
        let mut inner = self.lock();
        if !inner.known.iter().any(|known| known == value) {
            inner.known.push(value.to_owned());
        }
    }

    /// Records an IPC call's duration for the session summary. The longest per channel is kept.
    pub fn note_slow(&self, channel: &str, dur_ms: f64) {
        self.lock().stats.note_slow(channel, dur_ms);
    }

    /// Adds to a session counter: turns and engine crashes add up, peak memory keeps the largest value.
    /// logger.cjs defaults `value` to 1; callers pass it.
    pub fn note_stat(&self, stat: Stat, value: f64) {
        self.lock().stats.note_stat(stat, value);
    }

    /// Writes the session summary and the closing line, then marks the run clean or dirty, so the next boot can tell.
    /// logger.cjs defaults `clean` to true; callers pass it.
    pub fn end_session(&self, clean: bool) {
        let mut inner = self.lock();
        inner.settle();
        let summary = inner.stats.summary();
        inner.log(
            Level::Info,
            "lifecycle",
            "session summary",
            Some(summary),
            None,
        );
        let now = inner.clock.unix_ms();
        let uptime = ((now - inner.started_unix) as f64 / 1000.0 + 0.5).floor() as i64;
        let word = if clean { "clean" } else { "dirty" };
        inner.log(
            Level::Info,
            "session-end",
            &format!("uptime {uptime} s {word}"),
            None,
            None,
        );
        inner.write_marker(clean);
    }

    /// The last `bytes` of one log file, read from disk. `None` reads the default 64 KiB, as logger.cjs defaults the argument.
    /// The count is floored and clamped to 0 through 2 MiB; a missing file reads as empty.
    pub fn read_tail(&self, file: LogFile, bytes: Option<i64>) -> String {
        let wanted = bytes.map_or(DEFAULT_TAIL_BYTES, |count| {
            u64::try_from(count).unwrap_or(0).min(MAX_TAIL_BYTES)
        });
        let Ok(mut handle) = fs::File::open(self.dir.join(file.file_name())) else {
            return String::new();
        };
        let Ok(size) = handle.metadata().map(|meta| meta.len()) else {
            return String::new();
        };
        if handle
            .seek(SeekFrom::Start(size.saturating_sub(wanted)))
            .is_err()
        {
            return String::new();
        }
        let mut buffer = Vec::new();
        if handle.read_to_end(&mut buffer).is_err() {
            return String::new();
        }
        String::from_utf8_lossy(&buffer).into_owned()
    }

    /// Fires every timer that is due. The shell calls this on a timer, so a timed level ends on time even with no log activity.
    pub fn tick(&self) {
        self.lock().settle();
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn mono_ms(&self) -> f64 {
        self.lock().clock.mono_ms()
    }

    fn emit(
        &self,
        level: Level,
        scope: &str,
        message: &str,
        data: Option<Value>,
        error: Option<&ErrorInfo>,
    ) {
        let mut inner = self.lock();
        inner.settle();
        inner.log(level, scope, message, data, error);
    }
}

/// The keys of `first`, then the keys of `second` that are not already there. Repeats collapse, as a JavaScript `Set` does.
fn union(first: &[String], second: &[String]) -> Vec<String> {
    let mut merged: Vec<String> = Vec::new();
    for scope in first.iter().chain(second) {
        if !merged.contains(scope) {
            merged.push(scope.clone());
        }
    }
    merged
}

impl Inner {
    /// Writes one line stamped now, with the correlation id taken from its data.
    /// Divergence: an empty scope files under `app`; logger.cjs's `logWith` reads the caller's file and line instead.
    fn log(
        &mut self,
        level: Level,
        scope: &str,
        message: &str,
        data: Option<Value>,
        error: Option<&ErrorInfo>,
    ) {
        let at = self.clock.unix_ms();
        let cid = correlation(None, data.as_ref());
        self.record(Entry {
            at,
            level,
            scope,
            message,
            data: data.as_ref(),
            error,
            cid,
        });
    }

    fn log_entry(&mut self, entry: RendererEntry) {
        let at = self.clock.unix_ms();
        let cid = correlation(entry.cid.as_deref(), entry.data.as_ref());
        self.record(Entry {
            at,
            level: entry.level,
            scope: &entry.context,
            message: &entry.message,
            data: entry.data.as_ref(),
            error: entry.error.as_ref(),
            cid,
        });
    }

    /// The one write path. Builds the pieces once and fans them out: debug.log and events.jsonl in full, app.log cut.
    fn record(&mut self, entry: Entry<'_>) {
        let Entry {
            at,
            level,
            scope,
            message,
            data,
            error,
            cid,
        } = entry;
        let context = if scope.is_empty() { "app" } else { scope };
        let to_full = level >= self.debug_level;
        let to_app = level >= self.app_level
            || (level == Level::Debug && scope_raised(&self.raised, context));
        if !to_full && !to_app {
            return;
        }

        self.seq += 1;
        let seq = self.seq;
        let session = if self.session_id.is_empty() {
            "-"
        } else {
            self.session_id.as_str()
        };
        let tag = format!("{session}.{seq}");
        let stamp = iso_ms(at);
        let msg = scrub_with(message, &self.known);
        if level == Level::Error {
            self.stats.count_error(context);
        }
        let cid_text = cid.as_ref().map(js_string);
        if scope != "logger" {
            self.recent.push(recent_line(
                &stamp,
                level,
                context,
                cid_text.as_deref(),
                &msg,
            ));
        }
        let duration = data.and_then(duration_of);
        let described = error.map(|error| describe(error, &self.known, 0));
        let error_full = described.as_ref().map(render);
        let error_app = described.as_ref().map(|error| render(&app_error(error)));
        let error_json_value = described.as_ref().map(error_json);

        let head = Head {
            stamp: &stamp,
            level,
            tag: &tag,
            cid: cid_text.as_deref(),
            context,
            message: &msg,
        };
        if to_full {
            let full = data.map(|data| sanitize(data, false, &self.known));
            let text = line(&head, full.as_ref(), error_full.as_deref());
            self.write(LogFile::Debug, &text);
            let text = record_line(Record {
                stamp: &stamp,
                seq,
                level,
                session: &self.session_id,
                pid: self.pid,
                scope: context,
                msg: &msg,
                cid,
                dur_ms: duration,
                data: full,
                err: error_json_value,
            });
            self.write(LogFile::Events, &text);
        }
        if to_app {
            let cut = data.map(|data| sanitize(data, true, &self.known));
            let text = line(&head, cut.as_ref(), error_app.as_deref());
            self.write(LogFile::App, &text);
        }
    }

    fn write(&mut self, target: LogFile, text: &str) {
        let result = match target {
            LogFile::App => self.app.write(text),
            LogFile::Debug => self.debug.write(text),
            LogFile::Events => self.events.write(text),
        };
        if let Err(err) = result
            && !self.failure_reported
        {
            // Reported once: logging must never break the app, and a second report adds nothing.
            self.failure_reported = true;
            tracing::warn!(target: "diagnostics.write", %err, "log write failed");
        }
    }

    fn write_marker(&self, clean: bool) {
        let text = marker_text(
            &self.session_id,
            &iso_ms(self.started_unix),
            self.pid,
            clean,
        );
        write_file(&self.dir.join(SESSION_MARKER), &text);
    }

    fn push_timer(&mut self, due: f64, kind: Kind) {
        self.timer_seq += 1;
        self.timers.push(Pending {
            due,
            created: self.timer_seq,
            kind,
        });
    }

    fn level_until(&self) -> Option<f64> {
        self.timers
            .iter()
            .find(|pending| matches!(pending.kind, Kind::Level))
            .map(|pending| pending.due)
    }

    fn level_state(&self) -> LevelState {
        LevelState {
            level: self.app_level,
            scopes: self.raised.clone(),
            keep: self.keep,
            until: self.level_until(),
        }
    }

    /// Changes the level, keeps or drops the level file, and logs `level changed` at `at`.
    fn apply_level(&mut self, change: LevelChange<'_>, at: i64) {
        if let Some(name) = change.level {
            self.app_level = Level::parse(name).unwrap_or(self.startup_level);
        }
        if let Some(scopes) = change.scopes {
            self.raised = scope_names(scopes)
                .into_iter()
                .take(MAX_LEVEL_SCOPES)
                .map(|scope| cut16(&scope, MAX_SCOPE_UNITS))
                .collect();
        }
        self.keep = change.keep;
        self.timers
            .retain(|pending| !matches!(pending.kind, Kind::Level));
        let verbose = self.app_level == Level::Debug || !self.raised.is_empty();
        if let Some(ms) = change.duration_ms.filter(|ms| verbose && *ms > 0.0) {
            self.push_timer(at as f64 + ms.min(MAX_LEVEL_MS), Kind::Level);
        }
        let path = self.dir.join(LEVEL_FILE);
        if self.keep && verbose {
            write_file(&path, &level_file_text(self.app_level, &self.raised));
        } else {
            remove_file(&path);
        }
        let state = self.level_state();
        let data = json!({
            "level": state.level.name(),
            "scopes": state.scopes,
            "keep": state.keep,
            "until": state.until,
        });
        self.record(Entry {
            at,
            level: Level::Info,
            scope: "logger",
            message: "level changed",
            data: Some(&data),
            error: None,
            cid: None,
        });
    }

    /// Fires every timer due at the current time, in due order. Each one is stamped with its due time, as its JavaScript timer would be.
    fn settle(&mut self) {
        let now = self.clock.unix_ms() as f64;
        while let Some(index) = self.next_due(now) {
            let pending = self.timers.swap_remove(index);
            match pending.kind {
                Kind::Level => self.end_timed_level(pending.due),
                Kind::Window(window) => self.close_window(&window, pending.due),
            }
        }
    }

    fn next_due(&self, now: f64) -> Option<usize> {
        self.timers
            .iter()
            .enumerate()
            .filter(|(_, pending)| pending.due <= now)
            .min_by(|(_, a), (_, b)| a.due.total_cmp(&b.due).then(a.created.cmp(&b.created)))
            .map(|(index, _)| index)
    }

    /// A timed level is up: back to INFO with no scopes and no keep, then the closing line.
    fn end_timed_level(&mut self, due: f64) {
        let at = due as i64;
        self.apply_level(
            LevelChange {
                level: Some("INFO"),
                scopes: Some(Scopes::Text("")),
                duration_ms: None,
                keep: false,
            },
            at,
        );
        self.record(Entry {
            at,
            level: Level::Info,
            scope: "logger",
            message: "verbose logging ended",
            data: None,
            error: None,
            cid: None,
        });
    }

    /// A window closed with repeats: one summary line with their count. A window with none writes nothing.
    fn close_window(&mut self, window: &Window, due: f64) {
        if window.count == 0 {
            return;
        }
        let seconds = ((window.window_ms / 1000.0) + 0.5).floor() as i64;
        let message = format!(
            "{} repeated {} times in {seconds} s",
            window.message, window.count
        );
        let cid = correlation(None, window.data.as_ref());
        self.record(Entry {
            at: due as i64,
            level: window.level,
            scope: &window.scope,
            message: &message,
            data: window.data.as_ref(),
            error: None,
            cid,
        });
    }
}

/// The correlation id a line carries: an explicit id, else the first non-null `cid` or `correlationId` in the data.
/// Only a truthy id counts, so a zero or empty `cid` leaves the line as a system line.
fn correlation(explicit: Option<&str>, data: Option<&Value>) -> Option<Value> {
    if let Some(id) = explicit {
        return Some(Value::String(id.to_owned()));
    }
    let picked = ["cid", "correlationId"]
        .iter()
        .find_map(|key| data?.get(*key).filter(|found| !found.is_null()))?;
    js_truthy(picked).then(|| picked.clone())
}

/// The duration a payload reports, rounded to a tenth. `durMs` wins over `durationMs`, as `??` chains do.
fn duration_of(data: &Value) -> Option<f64> {
    let raw = ["durMs", "durationMs"]
        .iter()
        .find_map(|key| data.get(*key).filter(|found| !found.is_null()))?;
    raw.as_f64()
        .filter(|value| value.is_finite())
        .map(|value| (value * 10.0 + 0.5).floor() / 10.0)
}

/// `HH:MM:SS.mmm LEVEL scope [cid] message`, with the message cut at 120 units.
fn recent_line(stamp: &str, level: Level, context: &str, cid: Option<&str>, msg: &str) -> String {
    let clock = stamp.get(11..23).unwrap_or_default();
    let cid = cid.map(|id| format!(" [{id}]")).unwrap_or_default();
    let short = if js_len(msg) > RECENT_MESSAGE_UNITS {
        format!("{}...", cut16(msg, RECENT_MESSAGE_UNITS))
    } else {
        msg.to_owned()
    };
    format!("{clock} {} {context}{cid} {short}", level.name())
}

#[cfg(test)]
mod tests {
    use super::{LevelChange, Scopes, duration_of, recent_line};
    use crate::config::Level;
    use serde_json::{Value, json};

    #[test]
    fn duration_rounds_to_a_tenth_and_prefers_dur_ms() {
        assert_eq!(duration_of(&json!({"durMs": 412.34})), Some(412.3));
        assert_eq!(duration_of(&json!({"durationMs": 7})), Some(7.0));
        assert_eq!(duration_of(&json!({"durMs": "9", "durationMs": 7})), None);
    }

    #[test]
    fn recent_lines_cut_long_messages() {
        let long = "m".repeat(130);
        let line = recent_line(
            "2026-01-01T10:20:30.456Z",
            Level::Info,
            "engine",
            Some("t1"),
            &long,
        );
        assert_eq!(
            line,
            format!("10:20:30.456 INFO engine [t1] {}...", "m".repeat(120))
        );
    }

    struct FixedClock;

    impl crate::clock::Clock for FixedClock {
        fn unix_ms(&self) -> i64 {
            1_767_225_600_123
        }

        fn mono_ms(&self) -> f64 {
            0.0
        }
    }

    #[test]
    fn dump_recent_lists_the_last_lines_and_leaves_itself_out() {
        let dir = tempfile::tempdir().expect("temp dir");
        let config = crate::config::Config::from_env(|_| None, "a1b2c3d4", 4242, true, None);
        let diagnostics =
            super::Diagnostics::open(dir.path(), config, std::sync::Arc::new(FixedClock));
        diagnostics.info("engine", "step one", Some(json!({"cid": "t1"})));
        diagnostics.warn("mcp", "step two", None);
        diagnostics.dump_recent("uncaughtException");

        let events =
            std::fs::read_to_string(dir.path().join("events.jsonl")).expect("events.jsonl");
        let dump: serde_json::Value =
            serde_json::from_str(events.lines().last().expect("a dump line")).expect("JSON");
        assert_eq!(dump["msg"], "recent events before failure");
        assert_eq!(dump["data"]["count"], 3);
        let recent = dump["data"]["recent"].as_array().expect("recent array");
        assert!(
            recent[0]
                .as_str()
                .unwrap_or_default()
                .ends_with("INFO boot session started")
        );
        assert!(
            recent[1]
                .as_str()
                .unwrap_or_default()
                .ends_with("INFO engine [t1] step one")
        );
        assert!(
            recent[2]
                .as_str()
                .unwrap_or_default()
                .ends_with("WARN mcp step two")
        );
    }

    #[test]
    fn a_stream_chunk_is_recorded_by_length_and_its_text_never_reaches_disk() {
        let dir = tempfile::tempdir().expect("temp dir");
        let config = crate::config::Config::from_env(|_| None, "a1b2c3d4", 4242, true, None);
        let diagnostics =
            super::Diagnostics::open(dir.path(), config, std::sync::Arc::new(FixedClock));
        diagnostics.stream_chunk("llama", "chunk", Some("t1"), "secret chunk text".as_bytes());
        let debug = std::fs::read_to_string(dir.path().join("debug.log")).expect("debug.log");
        assert!(!debug.contains("secret chunk"));
        assert!(
            debug.ends_with(" DEBUG a1b2c3d4.2 [t1] [llama] chunk {\"bytes\":17,\"cid\":\"t1\"}\n"),
            "{debug}"
        );
    }

    #[test]
    fn set_level_changes_the_app_level_and_an_unknown_name_returns_to_startup() {
        let dir = tempfile::tempdir().expect("temp dir");
        let config = crate::config::Config::from_env(
            |key| (key == "APP_LOG_LEVEL").then(|| "WARN".to_owned()),
            "s",
            1,
            true,
            None,
        );
        let diagnostics =
            super::Diagnostics::open(dir.path(), config, std::sync::Arc::new(FixedClock));
        diagnostics.set_level(LevelChange {
            level: Some("DEBUG"),
            scopes: Some(Scopes::Text("alpha")),
            ..LevelChange::default()
        });
        assert_eq!(diagnostics.level_state().level, Level::Debug);
        diagnostics.set_level(LevelChange {
            level: Some("nope"),
            ..LevelChange::default()
        });
        let state = diagnostics.level_state();
        assert_eq!(
            (state.level, state.scopes),
            (Level::Warn, vec!["alpha".to_owned()])
        );
    }

    #[test]
    fn a_crash_logs_the_error_and_the_recent_lines() {
        let dir = tempfile::tempdir().expect("temp dir");
        let config = crate::config::Config::from_env(|_| None, "s", 1, true, None);
        let diagnostics =
            super::Diagnostics::open(dir.path(), config, std::sync::Arc::new(FixedClock));
        diagnostics.info("engine", "before", None);
        diagnostics.crash(
            "uncaughtException",
            &crate::ErrorInfo::new("TypeError", "boom"),
        );
        let app = std::fs::read_to_string(dir.path().join("app.log")).expect("app.log");
        assert!(
            app.contains("ERROR s.3 [system] [uncaughtException] \nTypeError: boom"),
            "{app}"
        );
        let events =
            std::fs::read_to_string(dir.path().join("events.jsonl")).expect("events.jsonl");
        let dump: Value = serde_json::from_str(events.lines().last().expect("dump")).expect("JSON");
        assert_eq!(dump["data"]["reason"], "uncaughtException");
    }

    #[test]
    fn a_timer_warns_past_its_limit_and_reports_once() {
        struct Stepping(std::sync::Mutex<f64>);
        impl crate::clock::Clock for Stepping {
            fn unix_ms(&self) -> i64 {
                1_767_225_600_123
            }

            fn mono_ms(&self) -> f64 {
                let mut now = self
                    .0
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                *now += 12.0;
                *now
            }
        }
        let dir = tempfile::tempdir().expect("temp dir");
        let config = crate::config::Config::from_env(|_| None, "s", 1, true, None);
        let diagnostics = super::Diagnostics::open(
            dir.path(),
            config,
            std::sync::Arc::new(Stepping(std::sync::Mutex::new(0.0))),
        );
        let options = super::TimeOptions {
            warn_ms: Some(5.0),
            ..super::TimeOptions::default()
        };
        let mut timer = diagnostics.time("engine.llama", "warm", None, options);
        timer.end(None);
        timer.end(None);
        let events =
            std::fs::read_to_string(dir.path().join("events.jsonl")).expect("events.jsonl");
        let timed: Vec<Value> = events
            .lines()
            .skip(1)
            .map(|line| serde_json::from_str(line).expect("JSON"))
            .collect();
        assert_eq!(timed.len(), 1, "a second end is ignored");
        assert_eq!(timed[0]["level"], "WARN");
        assert_eq!(timed[0]["msg"], "warm slow");
    }
}
