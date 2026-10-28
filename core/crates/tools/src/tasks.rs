//! Background tasks: commands that keep running while the model works on something else. Each chat has its own
//! tasks, named t1, t2 and so on, at most [`MAX_RUNNING`] running at once. Output is merged, kept in memory
//! (the end of it) and written whole to a log file, so the model can read it later with `task_output`.
//!
//! This is the piped mode of the Electron task manager (`win/electron/tasks.cjs`): there is no pseudo-terminal,
//! so a program that insists on a terminal sees a pipe. Input still reaches a task through its stdin.

use std::collections::HashMap;
use std::ffi::OsString;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use regex::RegexBuilder;

use crate::shell::{HostLookup, ShellError, command_env, shell_invocation};
use crate::spawn::{CancelToken, StdChild as Child, StdChildStdin as ChildStdin, spawn_task_blocking};
use crate::task_text::{
    MAX_OUTPUT_CHARS, clean_output, clip_with_pointer, grep_lines, slice_since, tail_lines,
};

/// Running tasks one chat may hold.
pub const MAX_RUNNING: usize = 5;
/// The longest a single `task_wait` may block.
pub const MAX_WAIT: Duration = Duration::from_secs(120);
/// How much output stays in memory. The log file keeps all of it.
const MEMORY_CHARS: usize = 1_000_000;
const MAX_COMMAND_CHARS: usize = 20_000;

#[derive(Debug, thiserror::Error)]
pub enum TaskError {
    #[error("There is no command to run.")]
    NoCommand,
    #[error("The command is too long.")]
    TooLong,
    #[error("The project folder does not exist.")]
    NoFolder,
    #[error("{0}")]
    Shell(#[from] ShellError),
    #[error(
        "This chat already has {MAX_RUNNING} tasks running. Stop one with task_stop or wait for one to end."
    )]
    TooMany,
    #[error("There is no task {0} in this chat. Use task_list to see them.")]
    Unknown(String),
    #[error("Task {0} is not running.")]
    NotRunning(String),
    #[error("Could not start the command: {0}")]
    Start(String),
    #[error("That pattern is not a valid regular expression.")]
    BadPattern,
}

/// Where a task stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Running,
    Exited,
    Failed,
    Stopped,
}

impl Status {
    pub fn is_running(self) -> bool {
        self == Self::Running
    }
}

/// A task as the model and the UI see it.
#[derive(Debug, Clone)]
pub struct TaskInfo {
    pub id: String,
    pub command: String,
    pub shell: String,
    pub status: Status,
    pub exit_code: Option<i32>,
    pub running_for: Duration,
    pub last_line: String,
    /// The file holding everything the task printed.
    pub log: PathBuf,
}

/// A task that ended since the model last heard about tasks.
#[derive(Debug, Clone)]
pub struct Ended {
    pub id: String,
    pub command: String,
    pub status: Status,
    pub exit_code: Option<i32>,
    pub duration: Duration,
    pub tail: String,
}

/// What the model asked to read of a task's output.
#[derive(Debug, Default, Clone)]
pub struct OutputQuery {
    /// Read only what arrived after this offset, as returned by an earlier read.
    pub since: Option<f64>,
    pub tail: Option<f64>,
    pub grep: Option<String>,
}

#[derive(Debug, Clone)]
pub struct OutputRead {
    pub text: String,
    /// Pass this as `since` to read only what comes after.
    pub next: usize,
    pub truncated: bool,
    pub info: TaskInfo,
}

#[derive(Debug, Clone)]
pub struct WaitResult {
    pub info: TaskInfo,
    /// The pattern showed up in the output.
    pub matched: bool,
    pub timed_out: bool,
    pub cancelled: bool,
    pub text: String,
    pub next: usize,
}

struct Run {
    /// The end of the output, as raw text.
    buf: String,
    /// Characters dropped from the front of `buf`; offsets stay absolute across drops.
    dropped: usize,
    status: Status,
    exit_code: Option<i32>,
    ended_at: Option<Instant>,
    stop_requested: bool,
}

struct Task {
    id: String,
    command: String,
    shell: String,
    started: Instant,
    pid: u32,
    log: PathBuf,
    state: Mutex<Run>,
    changed: Condvar,
    stdin: Mutex<Option<ChildStdin>>,
}

impl Task {
    fn lock(&self) -> MutexGuard<'_, Run> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn info(&self) -> TaskInfo {
        let run = self.lock();
        self.info_of(&run)
    }

    fn info_of(&self, run: &Run) -> TaskInfo {
        let cleaned = clean_output(&run.buf);
        let last_line = cleaned
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .unwrap_or_default()
            .chars()
            .take(200)
            .collect();
        TaskInfo {
            id: self.id.clone(),
            command: self.command.clone(),
            shell: self.shell.clone(),
            status: run.status,
            exit_code: run.exit_code,
            running_for: run.ended_at.unwrap_or_else(Instant::now) - self.started,
            last_line,
            log: self.log.clone(),
        }
    }

    fn total(run: &Run) -> usize {
        run.dropped + run.buf.chars().count()
    }
}

#[derive(Default)]
struct Chat {
    next: u32,
    tasks: Vec<Arc<Task>>,
    inbox: Vec<Ended>,
}

struct Shared {
    chats: Mutex<HashMap<String, Chat>>,
    logs: PathBuf,
}

/// Owns the background tasks of every chat in a session. Cloning shares them. Call [`TaskManager::shutdown`]
/// when the session ends, or whatever still runs keeps running.
#[derive(Clone)]
pub struct TaskManager {
    shared: Arc<Shared>,
    closing: Arc<AtomicBool>,
}

impl TaskManager {
    /// `logs` is the folder the full output of each task is written to. It is created when needed.
    pub fn new(logs: impl Into<PathBuf>) -> Self {
        Self {
            shared: Arc::new(Shared {
                chats: Mutex::new(HashMap::new()),
                logs: logs.into(),
            }),
            closing: Arc::new(AtomicBool::new(false)),
        }
    }

    fn chats(&self) -> MutexGuard<'_, HashMap<String, Chat>> {
        self.shared.chats.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn find(&self, chat: &str, id: &str) -> Result<Arc<Task>, TaskError> {
        self.chats()
            .get(chat)
            .and_then(|c| c.tasks.iter().find(|t| t.id == id).cloned())
            .ok_or_else(|| TaskError::Unknown(id.to_string()))
    }

    /// Starts a command in the background and returns right away.
    pub fn start(
        &self,
        chat: &str,
        command: &str,
        shell: Option<&str>,
        cwd: &Path,
        env: Option<Vec<(OsString, OsString)>>,
    ) -> Result<TaskInfo, TaskError> {
        if command.trim().is_empty() {
            return Err(TaskError::NoCommand);
        }
        if command.chars().count() > MAX_COMMAND_CHARS {
            return Err(TaskError::TooLong);
        }
        if !cwd.exists() {
            return Err(TaskError::NoFolder);
        }
        let invocation = shell_invocation(command, shell, &HostLookup::current())?;

        let (id, log) = {
            let mut chats = self.chats();
            let entry = chats.entry(chat.to_string()).or_default();
            let running = entry
                .tasks
                .iter()
                .filter(|t| t.lock().status.is_running())
                .count();
            if running >= MAX_RUNNING {
                return Err(TaskError::TooMany);
            }
            entry.next += 1;
            let id = format!("t{}", entry.next);
            let log = self
                .shared
                .logs
                .join(format!("{}-{id}.log", safe_name(chat)));
            (id, log)
        };
        let _ = std::fs::create_dir_all(&self.shared.logs);
        let file = File::create(&log).ok();

        let base = env.unwrap_or_else(|| std::env::vars_os().collect());
        let mut child = spawn_task_blocking(
            Path::new(&invocation.file),
            &invocation.args,
            cwd,
            command_env(base),
        )
        .map_err(|error| TaskError::Start(error.to_string()))?;
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let stdin = child.stdin.take();

        let task = Arc::new(Task {
            id: id.clone(),
            command: command.to_string(),
            shell: invocation.shell.clone(),
            started: Instant::now(),
            pid: child.id(),
            log,
            state: Mutex::new(Run {
                buf: String::new(),
                dropped: 0,
                status: Status::Running,
                exit_code: None,
                ended_at: None,
                stop_requested: false,
            }),
            changed: Condvar::new(),
            stdin: Mutex::new(stdin),
        });
        self.chats()
            .entry(chat.to_string())
            .or_default()
            .tasks
            .push(task.clone());

        let sink = Arc::new(Mutex::new(file));
        let mut readers = Vec::new();
        if let Some(pipe) = stdout {
            readers.push(pump(pipe, task.clone(), sink.clone()));
        }
        if let Some(pipe) = stderr {
            readers.push(pump(pipe, task.clone(), sink.clone()));
        }
        let manager = self.clone();
        let owner = chat.to_string();
        let watched = task.clone();
        std::thread::spawn(move || manager.watch(&owner, &watched, child, readers));

        Ok(task.info())
    }

    /// Waits for the process, then for its output to drain, then records how it ended.
    fn watch(
        &self,
        chat: &str,
        task: &Arc<Task>,
        mut child: Child,
        readers: Vec<std::thread::JoinHandle<()>>,
    ) {
        let status = child.wait().ok();
        for reader in readers {
            // A grandchild holding the pipe open would block this forever after a stop; give up on it.
            if task.lock().stop_requested {
                break;
            }
            let _ = reader.join();
        }
        *task.stdin.lock().unwrap_or_else(|e| e.into_inner()) = None;

        let ended = {
            let mut run = task.lock();
            run.exit_code = status.and_then(|s| s.code());
            run.ended_at = Some(Instant::now());
            run.status = if run.stop_requested {
                Status::Stopped
            } else if run.exit_code == Some(0) {
                Status::Exited
            } else {
                Status::Failed
            };
            let cleaned = clean_output(&run.buf);
            Ended {
                id: task.id.clone(),
                command: task.command.clone(),
                status: run.status,
                exit_code: run.exit_code,
                duration: run.ended_at.unwrap_or_else(Instant::now) - task.started,
                tail: tail_lines(&cleaned, 20.0),
            }
        };
        task.changed.notify_all();
        if !self.closing.load(Ordering::Relaxed) {
            self.chats()
                .entry(chat.to_string())
                .or_default()
                .inbox
                .push(ended);
        }
    }

    pub fn list(&self, chat: &str) -> Vec<TaskInfo> {
        let tasks: Vec<Arc<Task>> = self
            .chats()
            .get(chat)
            .map(|c| c.tasks.clone())
            .unwrap_or_default();
        tasks.iter().map(|t| t.info()).collect()
    }

    /// The tasks that ended since the last call. The model is told about each of them once.
    pub fn take_ended(&self, chat: &str) -> Vec<Ended> {
        self.chats()
            .get_mut(chat)
            .map(|c| std::mem::take(&mut c.inbox))
            .unwrap_or_default()
    }

    pub fn output(
        &self,
        chat: &str,
        id: &str,
        query: &OutputQuery,
    ) -> Result<OutputRead, TaskError> {
        let task = self.find(chat, id)?;
        let run = task.lock();
        let info = task.info_of(&run);
        let total = Task::total(&run);
        let raw = &run.buf;
        let from = query.since.map(|s| (s - run.dropped as f64).max(0.0));
        let (fresh, _) = slice_since(raw, from);
        let mut text = clean_output(&fresh);
        if let Some(pattern) = query.grep.as_deref().filter(|p| !p.is_empty()) {
            text = grep_lines(&text, pattern, 200)
                .map_err(|_| TaskError::BadPattern)?
                .text;
        }
        if let Some(count) = query.tail {
            text = tail_lines(&text, count);
        }
        let clipped = clip_with_pointer(&text, Some(&task.id));
        Ok(OutputRead {
            text: clipped.text,
            next: total,
            truncated: clipped.truncated,
            info,
        })
    }

    /// Blocks until the task ends, its output matches `pattern`, the time runs out or the turn is stopped.
    pub fn wait(
        &self,
        chat: &str,
        id: &str,
        pattern: Option<&str>,
        timeout: Duration,
        cancel: &CancelToken,
    ) -> Result<WaitResult, TaskError> {
        let task = self.find(chat, id)?;
        let regex = pattern
            .filter(|p| !p.is_empty())
            .map(|p| {
                RegexBuilder::new(p)
                    .case_insensitive(true)
                    .build()
                    .map_err(|_| TaskError::BadPattern)
            })
            .transpose()?;
        let deadline = Instant::now() + timeout.min(MAX_WAIT);
        let mut run = task.lock();
        let start = Task::total(&run);
        let mut matched = false;
        let mut timed_out = false;
        let mut cancelled = false;
        loop {
            if let Some(regex) = &regex {
                let fresh = clean_output(&run.buf);
                if regex.is_match(&fresh) {
                    matched = true;
                    break;
                }
            }
            if !run.status.is_running() {
                break;
            }
            if cancel.is_cancelled() {
                cancelled = true;
                break;
            }
            let now = Instant::now();
            if now >= deadline {
                timed_out = true;
                break;
            }
            let step = (deadline - now).min(Duration::from_millis(100));
            run = task
                .changed
                .wait_timeout(run, step)
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
        let from = start.saturating_sub(run.dropped);
        let (fresh, next) = slice_since(&run.buf, Some(from as f64));
        let info = task.info_of(&run);
        drop(run);
        let text = clip_with_pointer(&clean_output(&fresh), Some(&task.id)).text;
        Ok(WaitResult {
            info,
            matched,
            timed_out,
            cancelled,
            text,
            next: next + task.lock().dropped,
        })
    }

    pub fn stop(&self, chat: &str, id: &str) -> Result<TaskInfo, TaskError> {
        let task = self.find(chat, id)?;
        {
            let mut run = task.lock();
            if !run.status.is_running() {
                return Err(TaskError::NotRunning(id.to_string()));
            }
            run.stop_requested = true;
        }
        kill_tree(task.pid);
        // The watcher records the end; give it a moment so the answer shows the final state.
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut run = task.lock();
        while run.status.is_running() && Instant::now() < deadline {
            run = task
                .changed
                .wait_timeout(run, Duration::from_millis(50))
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
        Ok(task.info_of(&run))
    }

    /// Types into a running task.
    pub fn input(&self, chat: &str, id: &str, data: &str) -> Result<(), TaskError> {
        let task = self.find(chat, id)?;
        if !task.lock().status.is_running() {
            return Err(TaskError::NotRunning(id.to_string()));
        }
        let mut guard = task.stdin.lock().unwrap_or_else(|e| e.into_inner());
        let Some(stdin) = guard.as_mut() else {
            return Err(TaskError::NotRunning(id.to_string()));
        };
        stdin
            .write_all(data.as_bytes())
            .and_then(|()| stdin.flush())
            .map_err(|_| TaskError::NotRunning(id.to_string()))
    }

    /// Drops a chat's tasks, stopping any that run. Used when the chat is deleted.
    pub fn forget(&self, chat: &str) {
        let removed = self.chats().remove(chat);
        for task in removed.map(|c| c.tasks).unwrap_or_default() {
            let mut run = task.lock();
            if run.status.is_running() {
                run.stop_requested = true;
                drop(run);
                kill_tree(task.pid);
            }
        }
    }

    /// Stops everything. The app calls this on quit.
    pub fn shutdown(&self) {
        self.closing.store(true, Ordering::Relaxed);
        let chats: Vec<String> = self.chats().keys().cloned().collect();
        for chat in chats {
            self.forget(&chat);
        }
    }
}

fn safe_name(chat: &str) -> String {
    let name: String = chat
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' })
        .take(64)
        .collect();
    if name.is_empty() { "chat".to_string() } else { name }
}

/// Reads a pipe to its end, adding every piece to the task's output and its log.
fn pump(
    mut pipe: impl Read + Send + 'static,
    task: Arc<Task>,
    sink: Arc<Mutex<Option<File>>>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut bytes = [0u8; 8192];
        // A character split across two reads waits for its other half.
        let mut pending: Vec<u8> = Vec::new();
        loop {
            let count = match pipe.read(&mut bytes) {
                Ok(0) | Err(_) => break,
                Ok(count) => count,
            };
            pending.extend_from_slice(&bytes[..count]);
            let keep = incomplete_tail(&pending);
            let ready: Vec<u8> = pending.drain(..pending.len() - keep).collect();
            append(&task, &sink, &String::from_utf8_lossy(&ready));
        }
        if !pending.is_empty() {
            append(&task, &sink, &String::from_utf8_lossy(&pending));
        }
    })
}

/// How many bytes at the end of `bytes` start a character that is not complete yet.
fn incomplete_tail(bytes: &[u8]) -> usize {
    let len = bytes.len();
    for back in 1..=len.min(3) {
        let byte = bytes[len - back];
        if byte & 0b1100_0000 == 0b1000_0000 {
            continue;
        }
        let needed = match byte {
            b if b >= 0b1111_0000 => 4,
            b if b >= 0b1110_0000 => 3,
            b if b >= 0b1100_0000 => 2,
            _ => 1,
        };
        return if needed > back { back } else { 0 };
    }
    0
}

fn append(task: &Task, sink: &Mutex<Option<File>>, text: &str) {
    if text.is_empty() {
        return;
    }
    if let Some(file) = sink.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        let _ = file.write_all(text.as_bytes());
    }
    {
        let mut run = task.lock();
        run.buf.push_str(text);
        let length = run.buf.chars().count();
        if length > MEMORY_CHARS {
            let drop_chars = length - MEMORY_CHARS;
            let at = run
                .buf
                .char_indices()
                .nth(drop_chars)
                .map_or(run.buf.len(), |(i, _)| i);
            run.buf.drain(..at);
            run.dropped += drop_chars;
        }
    }
    task.changed.notify_all();
}

/// Stops a process and everything it started.
fn kill_tree(pid: u32) {
    #[cfg(unix)]
    {
        use nix::sys::signal::{Signal, killpg};
        use nix::unistd::Pid;
        if let Ok(raw) = i32::try_from(pid)
            && raw > 0
        {
            let _ = killpg(Pid::from_raw(raw), Signal::SIGKILL);
        }
    }
    #[cfg(windows)]
    {
        let args = ["/pid".to_string(), pid.to_string(), "/T".to_string(), "/F".to_string()];
        let _ = crate::spawn::output_blocking("taskkill", &args);
    }
}

/// What the model reads when tasks ended since it last looked.
pub fn describe_ended(ended: &[Ended]) -> String {
    let mut lines = vec!["[Background tasks ended]".to_string()];
    for item in ended {
        let seconds = item.duration.as_secs();
        let how = match (item.status, item.exit_code) {
            (Status::Stopped, _) => format!("was stopped after {seconds}s"),
            (Status::Exited, _) => format!("finished with exit code 0 after {seconds}s"),
            (_, Some(code)) => format!("failed with exit code {code} after {seconds}s"),
            (_, None) => format!("failed after {seconds}s"),
        };
        lines.push(format!("Task {} ({}) {how}.", item.id, item.command));
        let tail = item.tail.trim_end();
        if !tail.is_empty() && item.status != Status::Stopped {
            lines.push(format!("Last output:\n{tail}"));
        }
    }
    lines.push("Read the rest with task_output.".to_string());
    lines.join("\n")
}

/// One line about a task for `task_list`.
pub fn describe_task(info: &TaskInfo) -> String {
    let seconds = info.running_for.as_secs();
    let state = match (info.status, info.exit_code) {
        (Status::Running, _) => format!("running for {seconds}s"),
        (Status::Stopped, _) => format!("stopped after {seconds}s"),
        (Status::Exited, _) => format!("exited with code 0 after {seconds}s"),
        (_, Some(code)) => format!("failed with code {code} after {seconds}s"),
        (_, None) => format!("failed after {seconds}s"),
    };
    format!("{}: {} ({}, {state})", info.id, info.command, info.shell)
}

/// The most output a single read returns, for the tool text.
pub const READ_LIMIT: usize = MAX_OUTPUT_CHARS;

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    const SHELL: &str = "sh";

    fn manager() -> (TaskManager, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("temp dir");
        (TaskManager::new(dir.path().join("logs")), dir)
    }

    fn start(m: &TaskManager, dir: &Path, command: &str) -> TaskInfo {
        m.start("chat", command, Some(SHELL), dir, None).expect("started")
    }

    fn settle(m: &TaskManager, id: &str) -> WaitResult {
        m.wait("chat", id, None, Duration::from_secs(10), &CancelToken::new())
            .expect("wait")
    }

    #[test]
    fn a_task_runs_to_its_end_and_is_reported_once() {
        let (m, dir) = manager();
        let info = start(&m, dir.path(), "echo hello; echo oops 1>&2");
        let done = settle(&m, &info.id);
        assert_eq!(done.info.status, Status::Exited);
        assert!(done.text.contains("hello") && done.text.contains("oops"));

        std::thread::sleep(Duration::from_millis(100));
        let ended = m.take_ended("chat");
        assert_eq!(ended.len(), 1);
        assert!(describe_ended(&ended).contains("finished with exit code 0"));
        assert!(m.take_ended("chat").is_empty());
    }

    #[test]
    fn a_failing_task_keeps_its_exit_code() {
        let (m, dir) = manager();
        let info = start(&m, dir.path(), "echo bad; exit 3");
        let done = settle(&m, &info.id);
        assert_eq!(done.info.status, Status::Failed);
        assert_eq!(done.info.exit_code, Some(3));
    }

    #[test]
    fn wait_returns_when_the_pattern_shows_up() {
        let (m, dir) = manager();
        let info = start(&m, dir.path(), "echo starting; sleep 1; echo READY; sleep 30");
        let found = m
            .wait("chat", &info.id, Some("ready"), Duration::from_secs(10), &CancelToken::new())
            .expect("wait");
        assert!(found.matched && found.info.status.is_running());
        let stopped = m.stop("chat", &info.id).expect("stop");
        assert_eq!(stopped.status, Status::Stopped);
    }

    #[test]
    fn output_reads_only_what_is_new() {
        let (m, dir) = manager();
        let info = start(&m, dir.path(), "echo one; sleep 0.5; echo two");
        settle(&m, &info.id);
        let first = m.output("chat", &info.id, &OutputQuery::default()).expect("read");
        assert!(first.text.contains("one") && first.text.contains("two"));
        let again = m
            .output("chat", &info.id, &OutputQuery { since: Some(first.next as f64), ..OutputQuery::default() })
            .expect("read");
        assert!(again.text.is_empty());
    }

    #[test]
    fn input_reaches_a_running_task() {
        let (m, dir) = manager();
        let info = start(&m, dir.path(), "read answer; echo got-$answer");
        m.input("chat", &info.id, "yes\n").expect("input");
        let done = settle(&m, &info.id);
        assert!(done.text.contains("got-yes"));
    }

    #[test]
    fn a_chat_holds_five_running_tasks_and_others_are_separate() {
        let (m, dir) = manager();
        for _ in 0..MAX_RUNNING {
            start(&m, dir.path(), "sleep 30");
        }
        assert!(matches!(
            m.start("chat", "sleep 30", Some(SHELL), dir.path(), None),
            Err(TaskError::TooMany)
        ));
        assert!(m.start("other", "sleep 30", Some(SHELL), dir.path(), None).is_ok());
        assert!(m.list("chat").len() == MAX_RUNNING);
        m.shutdown();
    }

    #[test]
    fn an_unknown_task_is_refused() {
        let (m, _dir) = manager();
        assert!(matches!(m.stop("chat", "t9"), Err(TaskError::Unknown(_))));
    }

    #[test]
    fn a_split_character_waits_for_its_other_half() {
        let bytes = "é".as_bytes();
        assert_eq!(incomplete_tail(&bytes[..1]), 1);
        assert_eq!(incomplete_tail(bytes), 0);
        assert_eq!(incomplete_tail(b"abc"), 0);
    }
}
