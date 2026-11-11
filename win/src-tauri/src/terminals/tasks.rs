//! Background tasks: commands that keep running while the model works on something else. The win-side port of
//! `win/electron/tasks.cjs`. A task runs on a pseudo-terminal when the computer has one, else on plain pipes; a
//! foreground command can be taken over with `adopt`. Output is kept in memory (the end of it) and written to a
//! log file, so the model can read it later with `task_output`. The pure text rules live in `draggy_tools`.

use std::collections::{BTreeMap, HashMap};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use draggy_tools::spawn::CancelToken;
use draggy_tools::task_text::{clean_output, clip_with_pointer, grep_lines, tail_lines};
use regex::RegexBuilder;
use serde_json::{Value, json};
use tokio::sync::watch;

use super::pipe::{self, Pipe, PipeExit, PipeLaunch};
use super::pty::{Host, Launch, OpenError};
use super::sandbox::{self, Spawn};
use super::shells::{self, Env};

/// Written into a sandboxed task's output while its folder is granted for the first time.
pub const GRANT_NOTICE: &str = "Setting up the sandbox for this folder. The first time can take a few minutes on a big project.\n";

pub const MAX_RUNNING_PER_CHAT: usize = 5;
/// Output kept in memory per task, in characters. Older output stays in the log file.
const RING_CHARS: usize = 1_000_000;
const LOG_CAP_CHARS: usize = 50_000_000;
const SNAPSHOT_CHARS: usize = 100_000;
const INBOX_TAIL_LINES: f64 = 20.0;
pub const MAX_WAIT_SECONDS: f64 = 120.0;
const MAX_COMMAND_CHARS: usize = 8_000;
const WRITE_FAILED: &str = "Nothing could be sent: ";

/// The manager for the app's background tasks. Set once at startup; see `ipc::terminals`.
pub static TASKS: OnceLock<Manager> = OnceLock::new();

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Running,
    Exited,
    Failed,
    Stopped,
}

impl Status {
    fn as_str(self) -> &'static str {
        match self {
            Status::Running => "running",
            Status::Exited => "exited",
            Status::Failed => "failed",
            Status::Stopped => "stopped",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    Pty,
    Pipe,
    Adopted,
}

impl Mode {
    fn as_str(self) -> &'static str {
        match self {
            Mode::Pty => "pty",
            Mode::Pipe => "pipe",
            Mode::Adopted => "adopted",
        }
    }
}

/// How a task is stopped and typed into.
#[derive(Clone)]
enum Handle {
    None,
    Pty(String),
    Pipe(Pipe),
    Adopted(Arc<dyn Fn() + Send + Sync>),
}

/// How a task ended, as reported by its process or by the caller of `adopt`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Exit {
    pub code: Option<i64>,
    pub signal: Option<String>,
    pub error: Option<String>,
}

/// Options for `output`. Unset fields keep the defaults.
#[derive(Clone, Debug, Default)]
pub struct OutputOptions {
    pub since: Option<f64>,
    pub tail: Option<f64>,
    pub grep: Option<String>,
    pub max_chars: Option<f64>,
}

/// What to start, and where.
pub struct StartOptions<'a> {
    pub chat_id: &'a str,
    pub cwd: &'a Path,
    pub command: &'a str,
    pub shell: Option<&'a str>,
    pub default_shell: Option<&'a str>,
    pub cols: u16,
    pub rows: u16,
    /// Runs the task inside the sandbox launcher, on pipes.
    pub sandbox: Option<&'a sandbox::Options>,
}

/// A task that was started, and the notice about its shell when one was swapped.
pub struct Started {
    pub task: Value,
    pub notice: Option<String>,
}

struct Task {
    uid: String,
    id: String,
    chat_id: String,
    seq: u64,
    command: String,
    shell: String,
    mode: Mode,
    handle: Handle,
    status: Status,
    exit_code: Option<i64>,
    signal: Option<String>,
    error: Option<String>,
    stop_requested: bool,
    started_at: u64,
    ended_at: Option<u64>,
    ring: String,
    ring_chars: usize,
    /// Characters dropped from the front of the ring, so `total` offsets stay valid.
    base: usize,
    total: usize,
    log_path: Option<PathBuf>,
    logged: usize,
    cursor: usize,
}

impl Task {
    fn push(&mut self, piece: &str) {
        let count = piece.chars().count();
        self.ring.push_str(piece);
        self.ring_chars += count;
        self.total += count;
        if self.ring_chars > RING_CHARS {
            let drop = self.ring_chars - RING_CHARS;
            let cut = self
                .ring
                .char_indices()
                .nth(drop)
                .map_or(self.ring.len(), |(index, _)| index);
            self.ring.drain(..cut);
            self.ring_chars -= drop;
            self.base += drop;
        }
        if let Some(path) = self.log_path.clone()
            && self.logged < LOG_CAP_CHARS
        {
            let written = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .and_then(|mut file| file.write_all(piece.as_bytes()));
            match written {
                Ok(()) => self.logged += count,
                // The in-memory output still works; the log is dropped for this task.
                Err(_) => self.log_path = None,
            }
        }
    }

    /// The part of the output from `from` (a character offset) on, and a note when the start is gone.
    fn raw_from(&self, from: usize) -> (String, &'static str) {
        if from >= self.base {
            return (self.ring.chars().skip(from - self.base).collect(), "");
        }
        if let Some(path) = &self.log_path
            && let Ok(all) = fs::read_to_string(path)
        {
            return (all.chars().skip(from).collect(), "");
        }
        (
            self.ring.clone(),
            "[earlier output is no longer available]\n",
        )
    }

    fn summary(&self) -> Value {
        let cleaned = clean_output(&self.ring);
        let last_line = cleaned
            .trim_end()
            .split('\n')
            .next_back()
            .unwrap_or_default();
        json!({
            "uid": self.uid,
            "id": self.id,
            "chatId": self.chat_id,
            "command": self.command,
            "shell": self.shell,
            "mode": self.mode.as_str(),
            "status": self.status.as_str(),
            "exitCode": self.exit_code,
            "signal": self.signal,
            "startedAt": self.started_at,
            "endedAt": self.ended_at,
            "canInput": self.status == Status::Running && self.mode == Mode::Pty,
            "lastLine": last_line,
            "error": self.error,
        })
    }
}

#[derive(Default)]
struct State {
    tasks: HashMap<String, Task>,
    counters: HashMap<String, u64>,
    inboxes: HashMap<String, Vec<Value>>,
    seq: u64,
    log_ready: bool,
}

struct Inner {
    host: Host,
    log_dir: Option<PathBuf>,
    on_event: Box<dyn Fn(Value) + Send + Sync>,
    state: Mutex<State>,
    changed: watch::Sender<u64>,
}

/// Background tasks for the app. Cheap to clone; every clone shares the same tasks.
#[derive(Clone)]
pub struct Manager {
    inner: Arc<Inner>,
}

/// A foreground command taken over by `adopt`. Feed it output with `push` and report its end with `exit`.
pub struct Adopted {
    manager: Manager,
    pub uid: String,
    pub task: Value,
}

impl Adopted {
    pub fn push(&self, chunk: &str) {
        self.manager.append(&self.uid, chunk);
    }

    pub fn exit(&self, exit: Exit) {
        self.manager.finish(&self.uid, exit);
    }
}

/// The result of `wait`: why it returned, and the task as it is then.
pub struct Waited {
    pub reason: &'static str,
    pub task: Value,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

fn unknown(id: &str) -> String {
    format!("There is no task {id} in this chat. Use task_list to see them.")
}

fn sanitize(uid: &str) -> String {
    uid.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// The arguments for a pseudo-terminal. A verbatim command (cmd's quoted line) cannot pass through a
/// terminal as written, so its wrapping quotes come off and the terminal quotes it again.
fn pty_args(invocation: &shells::Invocation) -> Vec<String> {
    if !invocation.verbatim {
        return invocation.args.clone();
    }
    invocation
        .args
        .iter()
        .map(|arg| {
            arg.strip_prefix('"')
                .and_then(|inner| inner.strip_suffix('"'))
                .unwrap_or(arg)
                .to_owned()
        })
        .collect()
}

/// `Some(finite)` when the value is a finite number, else `None`.
fn finite(value: Option<f64>) -> Option<f64> {
    value.filter(|number| number.is_finite())
}

impl Manager {
    /// Tasks write their logs under `log_dir` (removed by `stop_all`). `on_event` gets every event as JSON.
    pub fn new(log_dir: Option<PathBuf>, on_event: impl Fn(Value) + Send + Sync + 'static) -> Self {
        let (changed, _) = watch::channel(0u64);
        Self {
            inner: Arc::new(Inner {
                host: Host::uncapped(),
                log_dir,
                on_event: Box::new(on_event),
                state: Mutex::new(State::default()),
                changed,
            }),
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.inner
            .state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    fn emit(&self, event: Value) {
        (self.inner.on_event)(event);
    }

    fn notify(&self) {
        self.inner
            .changed
            .send_modify(|version| *version = version.wrapping_add(1));
    }

    fn cap_error(state: &State, chat_id: &str) -> String {
        let listed: Vec<String> = Self::running_of(state, chat_id)
            .iter()
            .map(|task| format!("{} ({})", task.id, task.command))
            .collect();
        format!(
            "This chat already has {MAX_RUNNING_PER_CHAT} background tasks running: {}. Stop one with task_stop first.",
            listed.join(", ")
        )
    }

    fn running_of<'a>(state: &'a State, chat_id: &str) -> Vec<&'a Task> {
        let mut live: Vec<&Task> = state
            .tasks
            .values()
            .filter(|task| task.chat_id == chat_id && task.status == Status::Running)
            .collect();
        live.sort_by_key(|task| task.seq);
        live
    }

    /// Mints the id and registers the task, with its log file. Fails when the chat is at its cap.
    fn register(
        &self,
        chat_id: &str,
        command: &str,
        shell: &str,
        mode: Mode,
    ) -> Result<String, String> {
        let mut guard = self.lock();
        let state = &mut *guard;
        if Self::running_of(state, chat_id).len() >= MAX_RUNNING_PER_CHAT {
            return Err(Self::cap_error(state, chat_id));
        }
        let counter = state.counters.entry(chat_id.to_owned()).or_insert(0);
        *counter += 1;
        let id = format!("t{counter}");
        let uid = format!("{chat_id}/{id}");
        let log_path = self.prepare_log(state, &uid);
        state.seq += 1;
        let task = Task {
            uid: uid.clone(),
            id,
            chat_id: chat_id.to_owned(),
            seq: state.seq,
            command: command.to_owned(),
            shell: shell.to_owned(),
            mode,
            handle: Handle::None,
            status: Status::Running,
            exit_code: None,
            signal: None,
            error: None,
            stop_requested: false,
            started_at: now_ms(),
            ended_at: None,
            ring: String::new(),
            ring_chars: 0,
            base: 0,
            total: 0,
            log_path,
            logged: 0,
            cursor: 0,
        };
        state.tasks.insert(uid.clone(), task);
        Ok(uid)
    }

    fn prepare_log(&self, state: &mut State, uid: &str) -> Option<PathBuf> {
        let dir = self.inner.log_dir.as_ref()?;
        if !state.log_ready {
            state.log_ready = fs::create_dir_all(dir).is_ok();
        }
        if !state.log_ready {
            return None;
        }
        let path = dir.join(format!("{}.log", sanitize(uid)));
        // A log that cannot be created still names the path; appends then fail and drop it.
        let _ = File::create(&path);
        Some(path)
    }

    fn set_handle(&self, uid: &str, handle: Handle) {
        let mut state = self.lock();
        if let Some(task) = state.tasks.get_mut(uid)
            && task.status == Status::Running
        {
            task.handle = handle;
        }
    }

    fn append(&self, uid: &str, chunk: &str) {
        if chunk.is_empty() {
            return;
        }
        let chat_id = {
            let mut state = self.lock();
            let Some(task) = state.tasks.get_mut(uid) else {
                return;
            };
            task.push(chunk);
            task.chat_id.clone()
        };
        self.emit(json!({ "type": "output", "chatId": chat_id, "uid": uid, "chunk": chunk }));
        self.notify();
    }

    fn finish(&self, uid: &str, exit: Exit) {
        let event = {
            let mut guard = self.lock();
            let state = &mut *guard;
            let Some(task) = state.tasks.get_mut(uid) else {
                return;
            };
            if task.status != Status::Running {
                return;
            }
            task.exit_code = exit.code;
            task.signal = exit.signal.clone();
            task.ended_at = Some(now_ms());
            task.error = exit.error.clone();
            task.status = if task.stop_requested {
                Status::Stopped
            } else if exit.error.is_none() && exit.code == Some(0) {
                Status::Exited
            } else {
                Status::Failed
            };
            task.handle = Handle::None;
            if !task.stop_requested {
                let tail = tail_lines(clean_output(&task.ring).trim_end(), INBOX_TAIL_LINES);
                let item = json!({
                    "uid": task.uid,
                    "id": task.id,
                    "command": task.command,
                    "status": task.status.as_str(),
                    "exitCode": exit.code,
                    "durationMs": task.ended_at.unwrap_or_default().saturating_sub(task.started_at),
                    "tail": tail,
                });
                state
                    .inboxes
                    .entry(task.chat_id.clone())
                    .or_default()
                    .push(item);
            }
            json!({
                "type": "ended",
                "chatId": task.chat_id,
                "task": task.summary(),
                "wake": !task.stop_requested,
            })
        };
        self.emit(event);
        self.notify();
    }

    /// Starts a command in the background. Errors are ones the model can act on.
    pub fn start(&self, options: &StartOptions<'_>) -> Result<Started, String> {
        let line = options.command;
        if line.trim().is_empty() {
            return Err("No command was given.".into());
        }
        if line.chars().count() > MAX_COMMAND_CHARS {
            return Err("That command is too long to run.".into());
        }
        if !options.cwd.exists() {
            return Err("The project folder is not available.".into());
        }
        {
            let state = self.lock();
            if Self::running_of(&state, options.chat_id).len() >= MAX_RUNNING_PER_CHAT {
                return Err(Self::cap_error(&state, options.chat_id));
            }
        }

        let invocation = shells::invocation(
            &Env::system(),
            line,
            options.shell,
            options.default_shell,
            options.sandbox.is_some(),
        )?;
        if let Some(boxed) = options.sandbox {
            let env = shells::build_env(&invocation.env);
            let spawn = Spawn {
                file: &invocation.file,
                args: &invocation.args,
                verbatim: invocation.verbatim,
                cwd: options.cwd,
                env: &env,
            };
            let launch = sandbox::wrap(&spawn, boxed)?;
            let uid = self.register(options.chat_id, line, &invocation.shell, Mode::Pipe)?;
            self.start_sandboxed(&uid, launch);
            return Ok(self.started(options.chat_id, &uid, invocation.notice));
        }
        let uid = self.register(options.chat_id, line, &invocation.shell, Mode::Pty)?;

        let mut pty_extra = invocation.env.clone();
        pty_extra.push(("TERM".into(), "xterm-256color".into()));
        let pty_env: BTreeMap<String, String> = shells::build_env(&pty_extra);
        let pty_args = pty_args(&invocation);
        let launch = Launch {
            file: &invocation.file,
            args: &pty_args,
            cwd: options.cwd,
            env: &pty_env,
            cols: options.cols,
            rows: options.rows,
            scrub_secrets: false,
        };
        let weak = Arc::downgrade(&self.inner);
        let (data_uid, exit_uid) = (uid.clone(), uid.clone());
        let opened = self.inner.host.open(
            &launch,
            move |_: &str, data: &str| {
                if let Some(inner) = weak.upgrade() {
                    Manager { inner }.append(&data_uid, data);
                }
            },
            {
                let weak = Arc::downgrade(&self.inner);
                move |_: &str, code: i64| {
                    if let Some(inner) = weak.upgrade() {
                        Manager { inner }.finish(
                            &exit_uid,
                            Exit {
                                code: Some(code),
                                ..Exit::default()
                            },
                        );
                    }
                }
            },
        );

        let spawn_failed = match opened {
            Ok(opened) => {
                self.set_handle(&uid, Handle::Pty(opened.id));
                false
            }
            Err(OpenError::Unavailable) => {
                if let Some(task) = self.lock().tasks.get_mut(&uid) {
                    task.mode = Mode::Pipe;
                }
                self.start_piped(&uid, &invocation, options.cwd);
                false
            }
            Err(OpenError::Failed(error)) => {
                self.finish(
                    &uid,
                    Exit {
                        error: Some(error),
                        ..Exit::default()
                    },
                );
                true
            }
        };

        let task = self.summary_of(&uid);
        if !spawn_failed {
            self.emit(json!({ "type": "started", "chatId": options.chat_id, "task": task }));
        }
        Ok(Started {
            task,
            notice: invocation.notice,
        })
    }

    fn start_piped(&self, uid: &str, invocation: &shells::Invocation, cwd: &Path) {
        let env = shells::build_env(&invocation.env);
        let plain = sandbox::Launch::direct(&Spawn {
            file: &invocation.file,
            args: &invocation.args,
            verbatim: invocation.verbatim,
            cwd,
            env: &env,
        });
        self.begin_piped(uid, &plain);
    }

    /// Starts a launch on pipes. A sandboxed one waits for its folder grant first.
    fn start_sandboxed(&self, uid: &str, launch: sandbox::Launch) {
        if !sandbox::needs_grant(&launch) {
            self.begin_piped(uid, &launch);
            return;
        }
        self.append(uid, GRANT_NOTICE);
        let manager = self.clone();
        let uid = uid.to_owned();
        tauri::async_runtime::spawn(async move {
            match sandbox::ready(&launch).await {
                Ok(()) => {
                    let stopped = manager
                        .lock()
                        .tasks
                        .get(&uid)
                        .is_some_and(|task| task.stop_requested);
                    if stopped {
                        manager.finish(&uid, Exit::default());
                    } else {
                        manager.begin_piped(&uid, &launch);
                    }
                }
                Err(error) => manager.finish(
                    &uid,
                    Exit {
                        error: Some(format!(
                            "The sandbox could not get access to the folder: {error}"
                        )),
                        ..Exit::default()
                    },
                ),
            }
        });
    }

    fn started(&self, chat_id: &str, uid: &str, notice: Option<String>) -> Started {
        let task = self.summary_of(uid);
        self.emit(json!({ "type": "started", "chatId": chat_id, "task": task }));
        Started { task, notice }
    }

    fn begin_piped(&self, uid: &str, plain: &sandbox::Launch) {
        let launch = PipeLaunch {
            file: &plain.file,
            args: &plain.args,
            verbatim: plain.verbatim,
            cwd: &plain.cwd,
            env: &plain.env,
        };
        let chunk_weak = Arc::downgrade(&self.inner);
        let chunk_uid = uid.to_owned();
        let exit_weak = Arc::downgrade(&self.inner);
        let exit_uid = uid.to_owned();
        let spawned = pipe::spawn(
            &launch,
            move |chunk: &str| {
                if let Some(inner) = chunk_weak.upgrade() {
                    Manager { inner }.append(&chunk_uid, chunk);
                }
            },
            move |exit: PipeExit| {
                if let Some(inner) = exit_weak.upgrade() {
                    Manager { inner }.finish(
                        &exit_uid,
                        Exit {
                            code: exit.code,
                            signal: None,
                            error: exit.error,
                        },
                    );
                }
            },
        );
        match spawned {
            Ok(pipe) => self.set_handle(uid, Handle::Pipe(pipe)),
            Err(error) => self.finish(
                uid,
                Exit {
                    error: Some(error.to_string()),
                    ..Exit::default()
                },
            ),
        }
    }

    /// Takes over a foreground command that is already running. `output` is what it printed so far, and
    /// `kill` stops it. Nothing can be typed into it.
    pub fn adopt(
        &self,
        chat_id: &str,
        command: &str,
        shell: &str,
        output: &str,
        kill: impl Fn() + Send + Sync + 'static,
    ) -> Result<Adopted, String> {
        let uid = self.register(chat_id, command, shell, Mode::Adopted)?;
        self.set_handle(&uid, Handle::Adopted(Arc::new(kill)));
        self.append(&uid, output);
        let task = self.summary_of(&uid);
        self.emit(json!({ "type": "started", "chatId": chat_id, "task": task }));
        Ok(Adopted {
            manager: self.clone(),
            uid,
            task,
        })
    }

    fn summary_of(&self, uid: &str) -> Value {
        self.lock()
            .tasks
            .get(uid)
            .map_or(Value::Null, Task::summary)
    }

    /// The task a chat's id (`t2`) or full uid names.
    fn find(state: &State, chat_id: &str, key: &str) -> Option<String> {
        let key = key.trim();
        if state.tasks.contains_key(key) {
            return Some(key.to_owned());
        }
        let uid = format!("{chat_id}/{key}");
        state.tasks.contains_key(&uid).then_some(uid)
    }

    pub fn list(&self, chat_id: &str) -> Vec<Value> {
        let state = self.lock();
        let mut tasks: Vec<&Task> = state
            .tasks
            .values()
            .filter(|task| task.chat_id == chat_id)
            .collect();
        tasks.sort_by_key(|task| task.seq);
        tasks.into_iter().map(Task::summary).collect()
    }

    /// What the model asked to read: new output by default, or an explicit offset, the last lines, or the
    /// lines matching a pattern.
    pub fn output(
        &self,
        chat_id: &str,
        id: &str,
        options: &OutputOptions,
    ) -> Result<Value, String> {
        let mut state = self.lock();
        let uid = Self::find(&state, chat_id, id).ok_or_else(|| unknown(id))?;
        let since = finite(options.since);
        let default_read = options.grep.is_none() && options.tail.is_none() && since.is_none();
        let task = state.tasks.get_mut(&uid).ok_or_else(|| unknown(id))?;
        let total = task.total;

        let (body, note) = if let Some(pattern) = &options.grep {
            let (raw, note) = task.raw_from(0);
            let found = grep_lines(&clean_output(&raw), pattern, 200)?;
            let body = if found.text.is_empty() {
                "(no matching lines)".to_owned()
            } else {
                found.text
            };
            (body, note)
        } else if let Some(tail) = options.tail.filter(|tail| *tail != 0.0) {
            let (raw, note) = task.raw_from(0);
            let count = if tail.is_finite() { tail } else { 50.0 };
            (tail_lines(clean_output(&raw).trim_end(), count), note)
        } else {
            let from = since.unwrap_or(task.cursor as f64).floor().max(0.0) as usize;
            let (raw, note) = task.raw_from(from.min(total));
            if default_read {
                task.cursor = total;
            }
            (clean_output(&raw), note)
        };
        drop(state);
        self.output_reply(&uid, id, body, note, total, options)
    }

    fn output_reply(
        &self,
        uid: &str,
        id: &str,
        body: String,
        note: &str,
        total: usize,
        options: &OutputOptions,
    ) -> Result<Value, String> {
        let max = options
            .max_chars
            .filter(|max| max.is_finite() && *max > 0.0);
        let (text, truncated) = match max {
            Some(max) if body.chars().count() as f64 > max => {
                let keep = max as usize;
                let skip = body.chars().count() - keep;
                (body.chars().skip(skip).collect::<String>(), true)
            }
            _ => {
                let clipped = clip_with_pointer(&body, Some(id));
                (clipped.text, clipped.truncated)
            }
        };
        Ok(json!({
            "task": self.summary_of(uid),
            "output": format!("{note}{text}"),
            "truncated": truncated,
            "next": total,
        }))
    }

    /// Waits for a task to end, for a pattern to appear in its new output, or for the time to pass.
    pub async fn wait(
        &self,
        chat_id: &str,
        id: &str,
        seconds: f64,
        until: Option<&str>,
        abort: &CancelToken,
    ) -> Result<Waited, String> {
        let (uid, start_total) = {
            let state = self.lock();
            let uid = Self::find(&state, chat_id, id).ok_or_else(|| unknown(id))?;
            let total = state.tasks[&uid].total;
            (uid, total)
        };
        let pattern = match until.filter(|pattern| !pattern.is_empty()) {
            Some(pattern) => Some(
                RegexBuilder::new(pattern)
                    .case_insensitive(true)
                    .build()
                    .map_err(|_| "That pattern is not a valid regular expression.".to_owned())?,
            ),
            None => None,
        };
        let seconds = if seconds.is_finite() && seconds != 0.0 {
            seconds
        } else {
            30.0
        };
        let limit = Duration::from_secs_f64(seconds.clamp(1.0, MAX_WAIT_SECONDS));
        if abort.is_cancelled() {
            return Ok(self.waited("aborted", &uid));
        }

        // Subscribe before checking, so an update between the check and the wait is not missed.
        let mut changed = self.inner.changed.subscribe();
        let deadline = tokio::time::Instant::now() + limit;
        loop {
            if let Some(reason) = self.check_wait(&uid, start_total, pattern.as_ref()) {
                return Ok(self.waited(reason, &uid));
            }
            tokio::select! {
                _ = changed.changed() => {}
                () = tokio::time::sleep_until(deadline) => return Ok(self.waited("timeout", &uid)),
                () = abort.cancelled() => return Ok(self.waited("aborted", &uid)),
            }
        }
    }

    fn check_wait(
        &self,
        uid: &str,
        start_total: usize,
        pattern: Option<&regex::Regex>,
    ) -> Option<&'static str> {
        let state = self.lock();
        let task = state.tasks.get(uid)?;
        if task.status != Status::Running {
            return Some("ended");
        }
        let pattern = pattern?;
        let (raw, _) = task.raw_from(start_total.max(task.base));
        pattern.is_match(&clean_output(&raw)).then_some("matched")
    }

    fn waited(&self, reason: &'static str, uid: &str) -> Waited {
        Waited {
            reason,
            task: self.summary_of(uid),
        }
    }

    /// Ends a running task. The exit comes later, as an `ended` event.
    pub fn stop(&self, chat_id: &str, id: &str) -> Result<Value, String> {
        let (summary, handle) = {
            let mut state = self.lock();
            let uid = Self::find(&state, chat_id, id).ok_or_else(|| unknown(id))?;
            let task = state.tasks.get_mut(&uid).ok_or_else(|| unknown(id))?;
            if task.status != Status::Running {
                return Ok(json!({ "task": task.summary(), "alreadyEnded": true }));
            }
            task.stop_requested = true;
            (task.summary(), task.handle.clone())
        };
        self.kill(&handle);
        Ok(json!({ "task": summary }))
    }

    fn kill(&self, handle: &Handle) {
        match handle {
            Handle::None => {}
            Handle::Pty(id) => {
                self.inner.host.kill(id);
            }
            Handle::Pipe(pipe) => pipe.kill(),
            Handle::Adopted(kill) => kill(),
        }
    }

    /// Types into a task. The model's text and the user's keystrokes both come through here.
    pub fn write(&self, chat_id: &str, id: &str, data: &str) -> Result<Value, String> {
        let (summary, pty_id) = {
            let state = self.lock();
            let uid = Self::find(&state, chat_id, id).ok_or_else(|| unknown(id))?;
            let task = &state.tasks[&uid];
            if task.status != Status::Running {
                return Err(format!("Task {} has already ended.", task.id));
            }
            let Handle::Pty(pty_id) = &task.handle else {
                return Err(format!(
                    "Task {} cannot take input: it was not started on a terminal.",
                    task.id
                ));
            };
            (task.summary(), pty_id.clone())
        };
        if !self.inner.host.write(&pty_id, data) {
            return Err(format!("{WRITE_FAILED}the terminal is not open"));
        }
        Ok(json!({ "task": summary }))
    }

    pub fn resize(&self, uid: &str, cols: u16, rows: u16) -> bool {
        let pty_id = {
            let state = self.lock();
            match state.tasks.get(uid).map(|task| &task.handle) {
                Some(Handle::Pty(id)) => id.clone(),
                _ => return false,
            }
        };
        self.inner.host.resize(&pty_id, cols.max(2), rows.max(2))
    }

    /// The recent output as the terminal printed it, for a pane attaching to a running task.
    pub fn snapshot(&self, uid: &str) -> Option<Value> {
        let state = self.lock();
        let task = state.tasks.get(uid)?;
        let data: String = {
            let skip = task.ring_chars.saturating_sub(SNAPSHOT_CHARS);
            task.ring.chars().skip(skip).collect()
        };
        Some(json!({ "task": task.summary(), "data": data }))
    }

    /// What ended since the model last looked, each reported once.
    pub fn take_inbox(&self, chat_id: &str) -> Vec<Value> {
        self.lock().inboxes.remove(chat_id).unwrap_or_default()
    }

    pub fn has_running(&self, chat_id: &str) -> bool {
        !Self::running_of(&self.lock(), chat_id).is_empty()
    }

    /// Ends every task and removes their logs, for a quit.
    pub fn stop_all(&self) {
        let handles: Vec<Handle> = {
            let mut state = self.lock();
            state
                .tasks
                .values_mut()
                .filter(|task| task.status == Status::Running)
                .map(|task| {
                    task.stop_requested = true;
                    task.handle.clone()
                })
                .collect()
        };
        for handle in &handles {
            self.kill(handle);
        }
        if let Some(dir) = &self.inner.log_dir {
            let _ = fs::remove_dir_all(dir);
        }
    }

    /// Forgets the finished tasks of a chat that was deleted.
    pub fn forget(&self, chat_id: &str) {
        let mut state = self.lock();
        let doomed: Vec<String> = state
            .tasks
            .values()
            .filter(|task| task.chat_id == chat_id && task.status != Status::Running)
            .map(|task| task.uid.clone())
            .collect();
        for uid in doomed {
            if let Some(task) = state.tasks.remove(&uid)
                && let Some(path) = task.log_path
            {
                let _ = fs::remove_file(path);
            }
        }
        state.inboxes.remove(chat_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn logs(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!("draggy-tasks-{tag}-{}", now_ms()))
    }

    fn manager(tag: &str) -> (Manager, mpsc::Receiver<Value>) {
        let (tx, rx) = mpsc::channel();
        let manager = Manager::new(Some(logs(tag)), move |event| {
            let _ = tx.send(event);
        });
        (manager, rx)
    }

    fn start(manager: &Manager, chat: &str, command: &str) -> Result<Started, String> {
        manager.start(&StartOptions {
            chat_id: chat,
            cwd: &std::env::temp_dir(),
            command,
            shell: Some("cmd"),
            default_shell: None,
            cols: 120,
            sandbox: None,
            rows: 30,
        })
    }

    fn wait_status(manager: &Manager, chat: &str, id: &str) -> Value {
        for _ in 0..600 {
            let task = manager
                .output(chat, id, &OutputOptions::default())
                .expect("output")["task"]
                .clone();
            if task["status"] != "running" {
                return task;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        panic!("task did not end");
    }

    #[test]
    fn rejects_empty_and_oversized_commands() {
        let (manager, _rx) = manager("reject");
        assert_eq!(
            start(&manager, "c", "   ").err().as_deref(),
            Some("No command was given.")
        );
        let long = "x".repeat(MAX_COMMAND_CHARS + 1);
        assert_eq!(
            start(&manager, "c", &long).err().as_deref(),
            Some("That command is too long to run.")
        );
    }

    #[test]
    fn a_missing_folder_is_reported() {
        let (manager, _rx) = manager("folder");
        let missing = std::env::temp_dir().join("draggy-tasks-no-such-folder-xyz");
        let error = manager
            .start(&StartOptions {
                chat_id: "c",
                cwd: &missing,
                command: "echo hi",
                shell: None,
                default_shell: None,
                cols: 120,
                sandbox: None,
                rows: 30,
            })
            .err();
        assert_eq!(
            error.as_deref(),
            Some("The project folder is not available.")
        );
    }

    #[test]
    fn unknown_tasks_name_the_list_tool() {
        let (manager, _rx) = manager("unknown");
        let error = manager.stop("c", "t9").expect_err("unknown");
        assert_eq!(
            error,
            "There is no task t9 in this chat. Use task_list to see them."
        );
        assert!(manager.list("c").is_empty());
        assert!(!manager.has_running("c"));
    }

    #[test]
    fn a_real_command_reports_its_output_and_exit_code() {
        let (manager, rx) = manager("exit");
        let started = start(&manager, "c", "echo hi & exit 2").expect("start");
        assert_eq!(started.task["id"], "t1");
        let task = wait_status(&manager, "c", "t1");
        assert_eq!(task["status"], "failed");
        assert_eq!(task["exitCode"], 2);
        let read = manager
            .output(
                "c",
                "t1",
                &OutputOptions {
                    since: Some(0.0),
                    ..OutputOptions::default()
                },
            )
            .expect("output");
        assert!(read["output"].as_str().unwrap_or_default().contains("hi"));
        let inbox = manager.take_inbox("c");
        assert_eq!(inbox.len(), 1);
        assert!(manager.take_inbox("c").is_empty());
        assert!(rx.try_iter().any(|event| event["type"] == "ended"));
    }

    #[test]
    fn the_chat_cap_is_enforced_per_chat() {
        let (manager, _rx) = manager("cap");
        for _ in 0..MAX_RUNNING_PER_CHAT {
            start(&manager, "cap", "ping -n 30 127.0.0.1 > nul").expect("start");
        }
        let error = start(&manager, "cap", "echo no").err().expect("capped");
        assert!(error.starts_with("This chat already has 5 background tasks running:"));
        start(&manager, "other", "echo yes").expect("another chat is not capped");
        manager.stop_all();
    }

    #[test]
    fn stop_ends_a_long_command_as_stopped() {
        let (manager, _rx) = manager("stop");
        start(&manager, "c", "ping -n 30 127.0.0.1 > nul").expect("start");
        manager.stop("c", "t1").expect("stop");
        let task = wait_status(&manager, "c", "t1");
        assert_eq!(task["status"], "stopped");
        assert!(manager.take_inbox("c").is_empty());
        let again = manager.stop("c", "t1").expect("stop again");
        assert_eq!(again["alreadyEnded"], true);
    }

    #[test]
    fn grep_and_tail_read_from_the_start() {
        let (manager, _rx) = manager("grep");
        let adopted = manager
            .adopt("c", "build", "cmd", "one\ntwo error\nthree\n", || {})
            .expect("adopt");
        adopted.push("four error\n");
        let grep = manager
            .output(
                "c",
                "t1",
                &OutputOptions {
                    grep: Some("error".into()),
                    ..OutputOptions::default()
                },
            )
            .expect("grep");
        let text = grep["output"].as_str().unwrap_or_default();
        assert!(
            text.contains("2: two error") && text.contains("4: four error"),
            "{text}"
        );
        let tail = manager
            .output(
                "c",
                "t1",
                &OutputOptions {
                    tail: Some(1.0),
                    ..OutputOptions::default()
                },
            )
            .expect("tail");
        assert_eq!(tail["output"], "four error");
        adopted.exit(Exit {
            code: Some(0),
            ..Exit::default()
        });
        assert_eq!(manager.list("c")[0]["status"], "exited");
    }

    #[test]
    fn an_invalid_pattern_is_an_error() {
        let (manager, _rx) = manager("pattern");
        let adopted = manager.adopt("c", "x", "cmd", "", || {}).expect("adopt");
        let error = manager
            .output(
                "c",
                "t1",
                &OutputOptions {
                    grep: Some("(".into()),
                    ..OutputOptions::default()
                },
            )
            .expect_err("invalid");
        assert_eq!(error, "That pattern is not a valid regular expression.");
        adopted.exit(Exit::default());
    }

    #[test]
    fn wait_returns_on_timeout_or_a_match() {
        let (manager, _rx) = manager("wait");
        let adopted = manager.adopt("c", "x", "cmd", "", || {}).expect("adopt");
        let abort = CancelToken::new();
        let writer = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            adopted.push("ready\n");
            adopted
        });
        let matched =
            tauri::async_runtime::block_on(manager.wait("c", "t1", 5.0, Some("READY"), &abort))
                .expect("wait");
        assert_eq!(matched.reason, "matched");
        let adopted = writer.join().expect("writer");
        let timed = tauri::async_runtime::block_on(manager.wait("c", "t1", 1.0, None, &abort))
            .expect("wait");
        assert_eq!(timed.reason, "timeout");
        adopted.exit(Exit::default());
        let ended = tauri::async_runtime::block_on(manager.wait("c", "t1", 5.0, None, &abort))
            .expect("wait");
        assert_eq!(ended.reason, "ended");
    }

    #[test]
    fn forget_drops_finished_tasks_and_their_logs() {
        let (manager, _rx) = manager("forget");
        let adopted = manager
            .adopt("c", "x", "cmd", "hello\n", || {})
            .expect("adopt");
        adopted.exit(Exit::default());
        manager.forget("c");
        assert!(manager.list("c").is_empty());
    }

    #[test]
    fn stop_all_removes_the_log_folder() {
        let (manager, _rx) = manager("stopall");
        let adopted = manager
            .adopt("c", "x", "cmd", "hello\n", || {})
            .expect("adopt");
        let dir = manager.inner.log_dir.clone().expect("dir");
        assert!(dir.exists());
        manager.stop_all();
        assert!(!dir.exists());
        adopted.exit(Exit::default());
    }

    #[test]
    fn pty_runs_a_quoted_cmd_line() {
        let (manager, _rx) = manager("pty-quotes");
        let started = start(&manager, "c", "echo \"a b\" & exit 0").expect("start");
        let id = started.task["id"].as_str().expect("id").to_owned();
        let task = wait_status(&manager, "c", &id);
        assert_eq!(task["exitCode"], 0);
        let read = manager
            .output(
                "c",
                &id,
                &OutputOptions {
                    since: Some(0.0),
                    ..OutputOptions::default()
                },
            )
            .expect("output");
        assert!(read["output"].as_str().unwrap_or_default().contains("a b"));
    }
}
