//! The only place in core that starts a process. Every child is hidden, has its own process group and dies with its
//! handle, so a stopped tool leaves nothing running. Mirrors platform.spawnHidden, execFileHidden and killTree.

use std::collections::VecDeque;
use std::ffi::{OsStr, OsString};
use std::io;
use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::sync::{mpsc, watch};

pub use tokio::process::{Child, ChildStdin};

const READ_CHUNK: usize = 8_192;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Stops every tool that holds it. One token per turn lets Escape stop all of the turn's running tools at once.
#[derive(Clone, Debug)]
pub struct CancelToken {
    stop: Arc<watch::Sender<bool>>,
}

impl CancelToken {
    pub fn new() -> Self {
        Self {
            stop: Arc::new(watch::channel(false).0),
        }
    }

    pub fn cancel(&self) {
        self.stop.send_replace(true);
    }

    pub fn is_cancelled(&self) -> bool {
        *self.stop.borrow()
    }

    /// Resolves once `cancel` has run, at once when it already has.
    pub async fn cancelled(&self) {
        let mut stopped = self.stop.subscribe();
        // The token owns the sender, so the wait cannot fail with every sender gone.
        let _ = stopped.wait_for(|value| *value).await;
    }
}

impl Default for CancelToken {
    fn default() -> Self {
        Self::new()
    }
}

/// Builds a command that starts hidden. `setup` sets the caller's options first, then the helper pins stdio, kill on
/// drop, the process group and the console flag, so `setup` cannot switch them off.
pub fn hidden_command<S: AsRef<OsStr>>(
    program: impl AsRef<OsStr>,
    args: &[S],
    setup: impl FnOnce(&mut Command),
) -> Command {
    let mut command = Command::new(program);
    command.args(args);
    setup(&mut command);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

/// Starts a hidden process whose output the caller reads through the returned handle.
pub fn spawn_hidden<S: AsRef<OsStr>>(
    program: impl AsRef<OsStr>,
    args: &[S],
    setup: impl FnOnce(&mut Command),
) -> io::Result<Child> {
    hidden_command(program, args, setup).spawn()
}

/// Starts a hidden process whose input the caller writes to, for servers that read requests from stdin.
pub fn spawn_hidden_with_input<S: AsRef<OsStr>>(
    program: impl AsRef<OsStr>,
    args: &[S],
    setup: impl FnOnce(&mut Command),
) -> io::Result<Child> {
    let mut command = hidden_command(program, args, setup);
    command.stdin(Stdio::piped());
    command.spawn()
}

/// Runs a hidden process to the end and returns its whole output, for calls that need no timeout or cancel.
pub async fn exec_hidden<S: AsRef<OsStr>>(
    program: impl AsRef<OsStr>,
    args: &[S],
    setup: impl FnOnce(&mut Command),
) -> io::Result<std::process::Output> {
    hidden_command(program, args, setup).output().await
}

/// Output limits in characters. Up to `limit`, a stream is kept whole; beyond it, only the first `head` and the last
/// `tail` characters are kept.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CaptureLimits {
    pub limit: usize,
    pub head: usize,
    pub tail: usize,
}

impl CaptureLimits {
    /// Keeps everything, for output that is read whole.
    pub const fn unbounded() -> Self {
        Self {
            limit: usize::MAX,
            head: 0,
            tail: 0,
        }
    }
}

/// What a stream kept: its start, its end, and how many characters lay between them.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Captured {
    pub head: String,
    pub tail: String,
    pub cut: usize,
}

impl Captured {
    pub fn is_cut(&self) -> bool {
        self.cut > 0
    }
}

/// Collects a stream as it arrives. Past the limit, the tail is a ring that keeps only the newest characters.
#[derive(Debug)]
pub struct Capture {
    limits: CaptureLimits,
    whole: String,
    split: bool,
    head: String,
    tail: VecDeque<char>,
    total: usize,
}

impl Capture {
    pub fn new(limits: CaptureLimits) -> Self {
        Self {
            limits,
            whole: String::new(),
            split: false,
            head: String::new(),
            tail: VecDeque::new(),
            total: 0,
        }
    }

    pub fn push(&mut self, text: &str) {
        self.total += text.chars().count();
        if self.split {
            self.push_tail(text);
            return;
        }
        self.whole.push_str(text);
        if self.total > self.limits.limit {
            self.split_whole();
        }
    }

    pub fn finish(self) -> Captured {
        if !self.split {
            return Captured {
                head: self.whole,
                tail: String::new(),
                cut: 0,
            };
        }
        // TS quirk: commands.cjs counts the cut on a buffer already trimmed at 90000 characters, so its figure depends on read sizes.
        let kept = self.head.chars().count() + self.tail.len();
        Captured {
            head: self.head,
            tail: self.tail.iter().collect(),
            cut: self.total.saturating_sub(kept),
        }
    }

    fn split_whole(&mut self) {
        let chars: Vec<char> = std::mem::take(&mut self.whole).chars().collect();
        let head_len = self.limits.head.min(chars.len());
        let tail_start = chars.len().saturating_sub(self.limits.tail).max(head_len);
        self.head = chars[..head_len].iter().collect();
        self.tail = chars[tail_start..].iter().copied().collect();
        self.split = true;
    }

    fn push_tail(&mut self, text: &str) {
        let keep = self.limits.tail;
        for ch in text.chars() {
            if keep == 0 {
                break;
            }
            if self.tail.len() == keep {
                self.tail.pop_front();
            }
            self.tail.push_back(ch);
        }
    }
}

/// Decodes one read on its own. TS quirk: commands.cjs calls toString per read, so a character split across reads
/// becomes U+FFFD at each side of the split, which lossy decoding of each read reproduces.
fn decode_read(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

#[derive(Clone, Copy, Debug)]
enum Stream {
    Stdout,
    Stderr,
}

/// Gathers both pipes into their captures. With `merge`, stderr joins stdout in the order it arrives.
struct Collector {
    merge: bool,
    stdout: Capture,
    stderr: Capture,
}

impl Collector {
    fn new(merge: bool, limits: CaptureLimits) -> Self {
        Self {
            merge,
            stdout: Capture::new(limits),
            stderr: Capture::new(limits),
        }
    }

    fn push(&mut self, stream: Stream, bytes: &[u8]) {
        let sink = match stream {
            Stream::Stdout => &mut self.stdout,
            Stream::Stderr if self.merge => &mut self.stdout,
            Stream::Stderr => &mut self.stderr,
        };
        sink.push(&decode_read(bytes));
    }

    fn finish(self) -> (Captured, Captured) {
        (self.stdout.finish(), self.stderr.finish())
    }
}

/// How a child runs: where, with which environment, for how long, and which token stops it.
#[derive(Debug)]
pub struct SpawnOptions {
    pub cwd: Option<PathBuf>,
    /// The complete environment when set; the caller's own environment when None.
    pub env: Option<Vec<(OsString, OsString)>>,
    pub timeout: Duration,
    pub cancel: CancelToken,
    /// Stderr joins stdout in arrival order, as a terminal shows it. Stderr is then empty.
    pub merge_output: bool,
    pub capture: CaptureLimits,
}

/// How a run ended and what it printed.
#[derive(Debug)]
pub struct Output {
    pub exit_code: Option<i32>,
    /// The name of the signal that ended the process, such as "SIGKILL". Unix only.
    pub signal: Option<String>,
    pub timed_out: bool,
    pub cancelled: bool,
    pub stdout: Captured,
    pub stderr: Captured,
    pub duration: Duration,
}

impl Output {
    /// Exited on its own with status 0: neither timed out nor cancelled.
    pub fn success(&self) -> bool {
        !self.timed_out && !self.cancelled && self.exit_code == Some(0)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SpawnError {
    #[error("could not start {program}: {source}")]
    Start {
        program: String,
        #[source]
        source: io::Error,
    },
    #[error("could not wait for the process: {0}")]
    Wait(#[source] io::Error),
}

/// Runs a program until it exits, times out or is cancelled. A timeout or cancel stops its whole process group.
pub async fn run<S: AsRef<OsStr>>(
    program: impl AsRef<OsStr>,
    args: &[S],
    options: SpawnOptions,
) -> Result<Output, SpawnError> {
    let started = Instant::now();
    let name = program_name(program.as_ref());
    let SpawnOptions {
        cwd,
        env,
        timeout,
        cancel,
        merge_output,
        capture,
    } = options;
    if cancel.is_cancelled() {
        // A stop that came first means the tool never starts.
        return Ok(Output {
            exit_code: None,
            signal: None,
            timed_out: false,
            cancelled: true,
            stdout: Captured::default(),
            stderr: Captured::default(),
            duration: started.elapsed(),
        });
    }

    let mut child = spawn_hidden(program, args, |command| {
        if let Some(dir) = &cwd {
            command.current_dir(dir);
        }
        if let Some(vars) = &env {
            command
                .env_clear()
                .envs(vars.iter().map(|(key, value)| (key, value)));
        }
    })
    .map_err(|source| SpawnError::Start {
        program: name.clone(),
        source,
    })?;
    let pid = child.id();
    tracing::debug!(target: "tools.spawn", program = %name, "process started");

    let (tx, mut rx) = mpsc::unbounded_channel::<(Stream, Vec<u8>)>();
    if let Some(pipe) = child.stdout.take() {
        tokio::spawn(pump(pipe, Stream::Stdout, tx.clone()));
    }
    if let Some(pipe) = child.stderr.take() {
        tokio::spawn(pump(pipe, Stream::Stderr, tx.clone()));
    }
    drop(tx);

    let mut group = GroupGuard::new(pid);
    let mut collector = Collector::new(merge_output, capture);
    let mut status: Option<ExitStatus> = None;
    let mut streams_open = true;
    let mut timed_out = false;
    let mut cancelled = false;
    let mut stopping = false;
    let deadline = tokio::time::sleep(timeout);
    tokio::pin!(deadline);

    while status.is_none() || streams_open {
        tokio::select! {
            chunk = rx.recv(), if streams_open => match chunk {
                Some((stream, bytes)) => collector.push(stream, &bytes),
                None => streams_open = false,
            },
            exit = child.wait(), if status.is_none() => {
                status = Some(exit.map_err(SpawnError::Wait)?);
            },
            () = &mut deadline, if !stopping => {
                timed_out = true;
                stopping = true;
                stop_group(pid, status.is_some());
            },
            () = cancel.cancelled(), if !stopping => {
                cancelled = true;
                stopping = true;
                stop_group(pid, status.is_some());
            },
        }
    }
    group.disarm();

    let (exit_code, signal) = match &status {
        Some(exit) => (exit.code(), signal_name(exit)),
        None => (None, None),
    };
    let (stdout, stderr) = collector.finish();
    Ok(Output {
        exit_code,
        signal,
        timed_out,
        cancelled,
        stdout,
        stderr,
        duration: started.elapsed(),
    })
}

/// Stops a process and everything it started, as platform.cjs killTree does: SIGKILL to the group at once.
/// Once the child's exit was seen its pid may belong to another process, so nothing is sent then.
pub async fn kill_tree(pid: u32, exited: bool) {
    if exited {
        return;
    }
    #[cfg(unix)]
    {
        let _ = signal_group(pid, nix::sys::signal::Signal::SIGKILL);
    }
    #[cfg(windows)]
    {
        let pid = pid.to_string();
        let args = ["/pid", pid.as_str(), "/T", "/F"];
        if let Err(error) = exec_hidden("taskkill", &args, |_| {}).await {
            tracing::debug!(target: "tools.spawn", error = %error, "taskkill failed");
        }
    }
}

async fn pump<R: AsyncRead + Unpin>(
    mut pipe: R,
    stream: Stream,
    tx: mpsc::UnboundedSender<(Stream, Vec<u8>)>,
) {
    let mut buffer = vec![0u8; READ_CHUNK];
    loop {
        match pipe.read(&mut buffer).await {
            Ok(0) => break,
            Ok(count) => {
                if tx.send((stream, buffer[..count].to_vec())).is_err() {
                    break;
                }
            }
            Err(error) => {
                tracing::debug!(target: "tools.spawn", error = %error, "pipe read failed");
                break;
            }
        }
    }
}

/// Starts the group stop in the background, so output keeps being read while the group is signalled.
fn stop_group(pid: Option<u32>, exited: bool) {
    // TS quirk: killTree returns once the child exited, so a grandchild holding the pipe outlives the timeout.
    if let Some(pid) = pid {
        drop(tokio::spawn(kill_tree(pid, exited)));
    }
}

fn program_name(program: &OsStr) -> String {
    Path::new(program)
        .file_name()
        .unwrap_or(program)
        .to_string_lossy()
        .into_owned()
}

#[cfg(unix)]
fn signal_group(pid: u32, signal: nix::sys::signal::Signal) -> nix::Result<()> {
    use nix::errno::Errno;
    use nix::sys::signal::killpg;
    use nix::unistd::Pid;

    // Pid 0 would mean Draggy's own group, so only a positive pid is ever signalled.
    let raw = i32::try_from(pid)
        .ok()
        .filter(|value| *value > 0)
        .ok_or(Errno::ESRCH)?;
    killpg(Pid::from_raw(raw), signal)
}

/// Kills the group if the run is dropped before it finishes, so no child outlives the tool that started it.
struct GroupGuard {
    #[cfg(unix)]
    pid: Option<u32>,
}

impl GroupGuard {
    #[cfg(unix)]
    fn new(pid: Option<u32>) -> Self {
        Self { pid }
    }

    #[cfg(not(unix))]
    fn new(_pid: Option<u32>) -> Self {
        Self {}
    }

    fn disarm(&mut self) {
        #[cfg(unix)]
        {
            self.pid = None;
        }
    }
}

impl Drop for GroupGuard {
    fn drop(&mut self) {
        #[cfg(unix)]
        if let Some(pid) = self.pid {
            let _ = signal_group(pid, nix::sys::signal::Signal::SIGKILL);
        }
    }
}

#[cfg(unix)]
fn signal_name(exit: &ExitStatus) -> Option<String> {
    use std::os::unix::process::ExitStatusExt;

    let number = exit.signal()?;
    Some(
        nix::sys::signal::Signal::try_from(number)
            .map_or_else(|_| number.to_string(), |signal| signal.as_str().to_string()),
    )
}

#[cfg(not(unix))]
fn signal_name(_exit: &ExitStatus) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn limits(limit: usize, head: usize, tail: usize) -> CaptureLimits {
        CaptureLimits { limit, head, tail }
    }

    #[test]
    fn keeps_a_short_stream_whole() {
        let mut capture = Capture::new(limits(10, 3, 3));
        capture.push("abc");
        capture.push("def");
        assert_eq!(
            capture.finish(),
            Captured {
                head: "abcdef".into(),
                tail: String::new(),
                cut: 0
            }
        );
    }

    #[test]
    fn keeps_the_start_and_a_rolling_end_past_the_limit() {
        let mut capture = Capture::new(limits(10, 3, 4));
        capture.push("0123456789");
        capture.push("ABCDEFGH");
        let captured = capture.finish();
        assert_eq!(captured.head, "012");
        assert_eq!(captured.tail, "EFGH");
        assert_eq!(captured.cut, 11);
        assert!(captured.is_cut());
    }

    #[test]
    fn counts_characters_not_bytes() {
        let mut capture = Capture::new(limits(4, 2, 2));
        capture.push("éééééé");
        let captured = capture.finish();
        assert_eq!(captured.head, "éé");
        assert_eq!(captured.tail, "éé");
        assert_eq!(captured.cut, 2);
    }

    #[test]
    fn unbounded_keeps_everything() {
        let mut capture = Capture::new(CaptureLimits::unbounded());
        capture.push(&"x".repeat(100_000));
        let captured = capture.finish();
        assert_eq!(captured.head.len(), 100_000);
        assert!(!captured.is_cut());
    }

    #[test]
    fn a_character_split_across_reads_is_replaced_on_each_side() {
        // TS quirk: each read is decoded alone, so the two halves of "é" are two replacement characters.
        let bytes = "é!".as_bytes();
        let text = format!("{}{}", decode_read(&bytes[..1]), decode_read(&bytes[1..]));
        assert_eq!(text, "\u{FFFD}\u{FFFD}!");
    }

    #[test]
    fn an_invalid_byte_becomes_a_replacement_character() {
        assert_eq!(decode_read(&[b'a', 0xff, b'b']), "a\u{FFFD}b");
    }

    #[tokio::test]
    async fn cancel_wakes_every_waiter() {
        let token = CancelToken::new();
        let waiter = token.clone();
        let task = tokio::spawn(async move { waiter.cancelled().await });
        assert!(!token.is_cancelled());
        token.cancel();
        task.await.expect("waiter finishes");
        assert!(token.is_cancelled());
        token.cancelled().await;
    }

    #[tokio::test]
    async fn run_returns_stdout_and_the_exit_code() {
        let output = run(
            "sh",
            &["-c", "printf hi; exit 4"],
            SpawnOptions {
                cwd: None,
                env: None,
                timeout: Duration::from_secs(20),
                cancel: CancelToken::new(),
                merge_output: false,
                capture: CaptureLimits::unbounded(),
            },
        )
        .await
        .expect("sh starts");
        assert_eq!(output.stdout.head, "hi");
        assert_eq!(output.exit_code, Some(4));
        assert!(!output.success());
    }

    #[tokio::test]
    async fn kill_tree_ends_a_process_group() {
        let child = spawn_hidden("sh", &["-c", "sleep 30"], |_| {}).expect("sh starts");
        let pid = child.id().expect("pid is known before the wait");
        kill_tree(pid, false).await;
        let status = child.wait_with_output().await.expect("the child is reaped");
        assert!(!status.status.success());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn kill_tree_sigkills_a_group_that_ignores_sigterm_at_once() {
        use std::os::unix::process::ExitStatusExt;

        let mut child = spawn_hidden(
            "sh",
            &["-c", "trap '' TERM; echo ready; exec sleep 30"],
            |_| {},
        )
        .expect("sh starts");
        let pid = child.id().expect("pid is known before the wait");
        let mut stdout = child.stdout.take().expect("stdout is piped");
        let mut ready = [0u8; 6];
        stdout
            .read_exact(&mut ready)
            .await
            .expect("the trap is set before the kill");
        kill_tree(pid, false).await;
        let status = tokio::time::timeout(Duration::from_secs(1), child.wait())
            .await
            .expect("the group dies without a grace period")
            .expect("the child is reaped");
        assert_eq!(
            status.signal(),
            Some(nix::sys::signal::Signal::SIGKILL as i32)
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn kill_tree_after_the_exit_sends_nothing() {
        use tokio::io::{AsyncBufReadExt, BufReader};

        // The shell exits, but its background sleep keeps the group and the pipe alive.
        let mut child =
            spawn_hidden("sh", &["-c", "sleep 30 & echo $!"], |_| {}).expect("sh starts");
        let pid = child.id().expect("pid is known before the wait");
        let mut stdout = BufReader::new(child.stdout.take().expect("stdout is piped"));
        let mut line = String::new();
        stdout
            .read_line(&mut line)
            .await
            .expect("the shell prints the sleep's pid");
        child.wait().await.expect("the shell exits");
        kill_tree(pid, true).await;
        let mut rest = Vec::new();
        let drained =
            tokio::time::timeout(Duration::from_millis(500), stdout.read_to_end(&mut rest)).await;
        if let Ok(sleep) = line.trim().parse::<i32>() {
            let _ = nix::sys::signal::kill(
                nix::unistd::Pid::from_raw(sleep),
                nix::sys::signal::Signal::SIGKILL,
            );
        }
        assert!(
            drained.is_err(),
            "a kill after the exit must leave the group running"
        );
    }
}
