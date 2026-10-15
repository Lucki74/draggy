//! Shell commands for the model: a real shell in the project folder, stoppable, with output cut to a size the model can
//! read. Ports electron/commands.cjs on macOS and Linux; the Windows Git Bash and WSL lookups stay in Electron.

use std::collections::BTreeMap;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::spawn::{self, CancelToken, Capture, CaptureLimits, Captured, SpawnError, SpawnOptions};

const DEFAULT_TIMEOUT_MS: f64 = 120_000.0;
const MIN_TIMEOUT_MS: f64 = 1_000.0;
const MAX_TIMEOUT_MS: f64 = 600_000.0;
const MAX_COMMAND_CHARS: usize = 8_000;
const MAX_OUTPUT_CHARS: usize = 30_000;
const HEAD_CHARS: usize = 8_000;
const OUTPUT_LIMITS: CaptureLimits = CaptureLimits {
    limit: MAX_OUTPUT_CHARS,
    head: HEAD_CHARS,
    tail: MAX_OUTPUT_CHARS - HEAD_CHARS,
};
const LOGIN_ENV_TIMEOUT: Duration = Duration::from_secs(10);
const LOGIN_ENV_MARKER: &str = "__DRAGGY_LOGIN_ENV__";

/// Shell names the model may ask for. Anything else means the user's own shell.
const SHELLS: [&str; 5] = ["pwsh", "powershell", "cmd", "bash", "sh"];
const PWSH_UTF8_PREFIX: &str = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ";
const EXTRA_PATHS: [&str; 2] = ["/usr/local/bin", "/opt/homebrew/bin"];
/// Keeps commands from prompting: there is no terminal to answer one, so a prompt would only wait out the timeout.
const NON_INTERACTIVE_ENV: [(&str, &str); 6] = [
    ("GIT_TERMINAL_PROMPT", "0"),
    ("GH_PROMPT_DISABLED", "1"),
    ("GIT_PAGER", "cat"),
    ("PAGER", "cat"),
    ("NO_COLOR", "1"),
    ("TERM", "dumb"),
];

#[derive(Debug, thiserror::Error)]
pub enum ShellError {
    #[error("No command was given.")]
    NoCommand,
    #[error("That command is too long to run.")]
    TooLong,
    #[error("The project folder is not available.")]
    NoFolder,
    #[error("{0} is not installed on this computer.")]
    NotInstalled(String),
    #[error("cmd is only available on Windows.")]
    CmdWindowsOnly,
    #[error(transparent)]
    Spawn(#[from] SpawnError),
}

/// The program that runs a command, its arguments, and the shell's name for the report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellInvocation {
    pub shell: String,
    pub file: PathBuf,
    pub args: Vec<String>,
}

/// Where shells are found. `HostLookup` asks the system; tests answer from a fixed list.
pub trait ShellLookup {
    /// The user's login shell, from $SHELL.
    fn user_shell(&self) -> Option<PathBuf>;
    fn is_file(&self, path: &Path) -> bool;
    /// The first PATH folder that holds a file with this name.
    fn find(&self, name: &str) -> Option<PathBuf>;
}

/// The running system: $SHELL, the files on disk and this process's PATH.
#[derive(Debug)]
pub struct HostLookup {
    user_shell: Option<PathBuf>,
    path: Option<OsString>,
}

impl HostLookup {
    pub fn current() -> Self {
        Self {
            user_shell: std::env::var_os("SHELL").map(PathBuf::from),
            path: std::env::var_os("PATH"),
        }
    }
}

impl ShellLookup for HostLookup {
    fn user_shell(&self) -> Option<PathBuf> {
        self.user_shell.clone()
    }

    fn is_file(&self, path: &Path) -> bool {
        path.is_file()
    }

    fn find(&self, name: &str) -> Option<PathBuf> {
        let path = self.path.as_ref()?;
        std::env::split_paths(path)
            .filter(|dir| !dir.as_os_str().is_empty())
            .map(|dir| dir.join(name))
            .find(|candidate| candidate.is_file())
    }
}

/// The program and arguments that run `command` in the shell asked for, or in the user's own login shell.
pub fn shell_invocation(
    command: &str,
    requested: Option<&str>,
    lookup: &impl ShellLookup,
) -> Result<ShellInvocation, ShellError> {
    let Some(shell) = requested.filter(|name| SHELLS.contains(name)) else {
        return default_invocation(command, lookup);
    };
    match shell {
        "cmd" => Err(ShellError::CmdWindowsOnly),
        "pwsh" | "powershell" => Ok(ShellInvocation {
            shell: shell.to_string(),
            file: installed(shell, lookup)?,
            args: vec![
                "-NoLogo".to_string(),
                "-NoProfile".to_string(),
                "-NonInteractive".to_string(),
                "-Command".to_string(),
                format!("{PWSH_UTF8_PREFIX}{command}"),
            ],
        }),
        _ => Ok(ShellInvocation {
            shell: shell.to_string(),
            file: installed(shell, lookup)?,
            args: vec!["-c".to_string(), command.to_string()],
        }),
    }
}

fn default_invocation(
    command: &str,
    lookup: &impl ShellLookup,
) -> Result<ShellInvocation, ShellError> {
    // The user's own shell as a login shell, so PATH matches their terminal.
    let file = lookup
        .user_shell()
        .filter(|path| !path.as_os_str().is_empty() && lookup.is_file(path))
        .or_else(|| lookup.find("bash"))
        .unwrap_or_else(|| PathBuf::from("/bin/sh"));
    let shell = file
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(ShellInvocation {
        shell,
        file,
        args: vec!["-lc".to_string(), command.to_string()],
    })
}

fn installed(name: &str, lookup: &impl ShellLookup) -> Result<PathBuf, ShellError> {
    lookup
        .find(name)
        .ok_or_else(|| ShellError::NotInstalled(name.to_string()))
}

/// A command's time limit: the model's ask in milliseconds, held to one second to ten minutes. Missing or
/// non-positive asks get two minutes.
pub fn timeout_for(asked: Option<f64>) -> Duration {
    let ms = match asked {
        Some(value) if value.is_finite() && value > 0.0 => {
            value.clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
        }
        _ => DEFAULT_TIMEOUT_MS,
    };
    Duration::from_millis(ms as u64)
}

/// The text the model reads, and whether the middle of it was cut.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Clipped {
    pub text: String,
    pub truncated: bool,
}

/// Keeps the start and the end of a long output, where errors and summaries are.
// TS quirk: JavaScript counts UTF-16 units, so an emoji counts as two there and as one here.
pub fn clip(text: &str) -> Clipped {
    let mut capture = Capture::new(OUTPUT_LIMITS);
    capture.push(text);
    render(capture.finish())
}

fn render(captured: Captured) -> Clipped {
    if !captured.is_cut() {
        return Clipped {
            text: captured.head,
            truncated: false,
        };
    }
    Clipped {
        text: format!(
            "{}\n\n[... {} characters cut ...]\n\n{}",
            captured.head, captured.cut, captured.tail
        ),
        truncated: true,
    }
}

/// PATH with the Homebrew and /usr/local folders after the current ones, each folder once and empty entries dropped.
pub fn merge_path(current: &str) -> String {
    let mut folders: Vec<&str> = Vec::new();
    for entry in current.split(':').chain(EXTRA_PATHS) {
        if !entry.is_empty() && !folders.contains(&entry) {
            folders.push(entry);
        }
    }
    folders.join(":")
}

/// The environment a command runs in: the base with PATH widened and the non-interactive settings. Electron's own
/// marker is removed, so a command never inherits it.
pub fn command_env(
    base: impl IntoIterator<Item = (OsString, OsString)>,
) -> Vec<(OsString, OsString)> {
    let mut env: BTreeMap<OsString, OsString> = base.into_iter().collect();
    let current = env
        .get(OsStr::new("PATH"))
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    env.insert(OsString::from("PATH"), OsString::from(merge_path(&current)));
    for (key, value) in NON_INTERACTIVE_ENV {
        env.insert(OsString::from(key), OsString::from(value));
    }
    env.remove(OsStr::new("ELECTRON_RUN_AS_NODE"));
    env.into_iter().collect()
}

/// One command from the model. `base_env` is the environment to start from; None uses this process's.
#[derive(Debug)]
pub struct CommandRequest {
    pub cwd: PathBuf,
    pub command: String,
    /// The shell the model asked for, or None for the user's own login shell.
    pub shell: Option<String>,
    pub timeout_ms: Option<f64>,
    pub base_env: Option<Vec<(OsString, OsString)>>,
    pub cancel: CancelToken,
}

/// A command that ran to an end, a timeout or a cancel.
#[derive(Debug)]
pub struct CommandOutput {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub signal: Option<String>,
    pub timed_out: bool,
    pub cancelled: bool,
    pub output: String,
    pub truncated: bool,
    pub shell: String,
    pub duration: Duration,
}

/// Runs one command in the project folder. Refused before it starts when the command is empty or too long, or the
/// folder is missing or the shell is unavailable.
pub async fn run_command(request: CommandRequest) -> Result<CommandOutput, ShellError> {
    let text = request.command.as_str();
    if text.trim().is_empty() {
        return Err(ShellError::NoCommand);
    }
    let chars = text.chars().count();
    if chars > MAX_COMMAND_CHARS {
        return Err(ShellError::TooLong);
    }
    if !request.cwd.exists() {
        return Err(ShellError::NoFolder);
    }

    let invocation = shell_invocation(text, request.shell.as_deref(), &HostLookup::current())?;
    let limit = timeout_for(request.timeout_ms);
    tracing::info!(target: "tools.shell", shell = %invocation.shell, chars, timeout_ms = %limit.as_millis(), "command spawning");

    let base = request
        .base_env
        .unwrap_or_else(|| std::env::vars_os().collect());
    let output = spawn::run(
        &invocation.file,
        invocation.args.as_slice(),
        SpawnOptions {
            cwd: Some(request.cwd),
            env: Some(command_env(base)),
            timeout: limit,
            cancel: request.cancel,
            merge_output: true,
            capture: OUTPUT_LIMITS,
        },
    )
    .await?;

    let success = output.success();
    if output.timed_out {
        tracing::warn!(target: "tools.shell", limit_ms = %limit.as_millis(), "command timed out");
    }
    tracing::info!(
        target: "tools.shell",
        duration_ms = %output.duration.as_millis(),
        exit_code = ?output.exit_code,
        timed_out = output.timed_out,
        cancelled = output.cancelled,
        "command finished"
    );
    let rendered = render(output.stdout);
    Ok(CommandOutput {
        success,
        exit_code: output.exit_code,
        signal: output.signal,
        timed_out: output.timed_out,
        cancelled: output.cancelled,
        output: rendered.text,
        truncated: rendered.truncated,
        shell: invocation.shell,
        duration: output.duration,
    })
}

/// The environment a login shell gives, as the user's terminal would have it. A marker before and after the listing
/// makes anything an rc file prints harmless.
pub async fn login_shell_env(shell: Option<&Path>) -> Result<BTreeMap<String, String>, SpawnError> {
    let file = shell
        .map(Path::to_path_buf)
        .or_else(|| HostLookup::current().user_shell())
        .unwrap_or_else(|| PathBuf::from("/bin/sh"));
    let probe =
        format!("printf '%s\\n' {LOGIN_ENV_MARKER}; env; printf '%s\\n' {LOGIN_ENV_MARKER}");
    let output = spawn::run(
        &file,
        &["-lc".to_string(), probe],
        SpawnOptions {
            cwd: None,
            env: None,
            timeout: LOGIN_ENV_TIMEOUT,
            cancel: CancelToken::new(),
            merge_output: false,
            capture: CaptureLimits::unbounded(),
        },
    )
    .await?;
    let stdout = output.stdout;
    Ok(parse_login_env(&format!("{}{}", stdout.head, stdout.tail)))
}

/// The variables between the first and second marker lines of `raw`. A line that is not `NAME=value` continues the
/// value before it, since variables can span lines.
pub fn parse_login_env(raw: &str) -> BTreeMap<String, String> {
    let mut env: BTreeMap<String, String> = BTreeMap::new();
    let mut last: Option<String> = None;
    let mut inside = false;
    for line in raw.lines() {
        if line == LOGIN_ENV_MARKER {
            if inside {
                break;
            }
            inside = true;
            continue;
        }
        if !inside {
            continue;
        }
        match split_entry(line) {
            Some((name, value)) => {
                env.insert(name.to_string(), value.to_string());
                last = Some(name.to_string());
            }
            None => {
                if let Some(value) = last.as_ref().and_then(|name| env.get_mut(name)) {
                    value.push('\n');
                    value.push_str(line);
                }
            }
        }
    }
    env
}

fn split_entry(line: &str) -> Option<(&str, &str)> {
    let (name, value) = line.split_once('=')?;
    let mut chars = name.chars();
    let first = chars.next()?;
    let valid = (first.is_ascii_alphabetic() || first == '_')
        && chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_');
    valid.then_some((name, value))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(dir: &Path, command: &str, shell: &str, timeout_ms: Option<f64>) -> CommandRequest {
        CommandRequest {
            cwd: dir.to_path_buf(),
            command: command.to_string(),
            shell: Some(shell.to_string()),
            timeout_ms,
            base_env: None,
            cancel: CancelToken::new(),
        }
    }

    /// Whether a process has ended. A zombie counts as ended: it is dead and only waits to be reaped.
    #[cfg(target_os = "linux")]
    fn is_gone(pid: i32) -> bool {
        match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
            Ok(stat) => stat
                .rsplit(')')
                .next()
                .is_some_and(|rest| rest.trim_start().starts_with('Z')),
            Err(_) => true,
        }
    }

    #[cfg(all(unix, not(target_os = "linux")))]
    fn is_gone(pid: i32) -> bool {
        use nix::errno::Errno;
        use nix::sys::signal::kill;
        use nix::unistd::Pid;

        matches!(kill(Pid::from_raw(pid), None), Err(Errno::ESRCH))
    }

    #[cfg(unix)]
    async fn wait_until_gone(pid: i32) -> bool {
        for _ in 0..50 {
            if is_gone(pid) {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        false
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn echo_returns_output_and_success() {
        let dir = tempfile::tempdir().expect("tempdir");
        let result = run_command(request(dir.path(), "echo hello", "sh", None))
            .await
            .expect("sh runs");
        assert!(result.success);
        assert_eq!(result.exit_code, Some(0));
        assert_eq!(result.output, "hello\n");
        assert_eq!(result.shell, "sh");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_failing_command_reports_its_exit_code() {
        let dir = tempfile::tempdir().expect("tempdir");
        let result = run_command(request(dir.path(), "echo oops >&2; exit 3", "sh", None))
            .await
            .expect("sh runs");
        assert!(!result.success);
        assert_eq!(result.exit_code, Some(3));
        assert!(result.output.contains("oops"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stderr_is_part_of_the_output() {
        let dir = tempfile::tempdir().expect("tempdir");
        let result = run_command(request(
            dir.path(),
            "echo one; echo two >&2; echo three",
            "sh",
            None,
        ))
        .await
        .expect("sh runs");
        for word in ["one", "two", "three"] {
            assert!(result.output.contains(word), "missing {word}");
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn the_command_runs_in_the_project_folder() {
        let dir = tempfile::tempdir().expect("tempdir");
        let result = run_command(request(dir.path(), "pwd -P", "sh", None))
            .await
            .expect("sh runs");
        let expected = dir.path().canonicalize().expect("canonical path");
        assert_eq!(result.output.trim(), expected.display().to_string());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_long_output_keeps_its_start_and_end() {
        let dir = tempfile::tempdir().expect("tempdir");
        let result = run_command(request(
            dir.path(),
            "head -c 100000 /dev/zero | tr '\\0' x; echo END",
            "sh",
            None,
        ))
        .await
        .expect("sh runs");
        assert!(result.truncated);
        assert!(result.output.starts_with("xxxxxxxx"));
        assert!(result.output.ends_with("END\n"));
        assert!(
            result
                .output
                .contains("\n\n[... 70004 characters cut ...]\n\n")
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_command_past_its_limit_is_stopped_with_its_children() {
        let dir = tempfile::tempdir().expect("tempdir");
        let pid_file = dir.path().join("child.pid");
        let command = format!("sleep 30 & echo $! > '{}'; wait", pid_file.display());
        let started = std::time::Instant::now();

        let result = run_command(request(dir.path(), &command, "sh", Some(1_000.0)))
            .await
            .expect("sh runs");

        assert!(result.timed_out);
        assert!(!result.success);
        assert!(started.elapsed() < Duration::from_secs(20));
        let pid: i32 = std::fs::read_to_string(&pid_file)
            .expect("the child wrote its pid")
            .trim()
            .parse()
            .expect("a pid");
        assert!(
            wait_until_gone(pid).await,
            "grandchild {pid} is still running"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancel_stops_the_command_and_its_children() {
        let dir = tempfile::tempdir().expect("tempdir");
        let pid_file = dir.path().join("child.pid");
        let command = format!("sleep 30 & echo $! > '{}'; wait", pid_file.display());
        let req = request(dir.path(), &command, "sh", None);
        let trigger = req.cancel.clone();
        let stopper = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(800)).await;
            trigger.cancel();
        });

        let result = run_command(req).await.expect("sh runs");
        stopper.await.expect("stopper finishes");

        assert!(result.cancelled);
        assert!(!result.timed_out);
        assert!(!result.success);
        let pid: i32 = std::fs::read_to_string(&pid_file)
            .expect("the child wrote its pid")
            .trim()
            .parse()
            .expect("a pid");
        assert!(
            wait_until_gone(pid).await,
            "grandchild {pid} is still running"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_command_cancelled_before_it_starts_stops_at_once() {
        let dir = tempfile::tempdir().expect("tempdir");
        let req = request(dir.path(), "sleep 30", "sh", None);
        req.cancel.cancel();
        let started = std::time::Instant::now();
        let result = run_command(req).await.expect("sh runs");
        assert!(result.cancelled);
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[tokio::test]
    async fn bad_requests_are_refused_before_anything_starts() {
        let dir = tempfile::tempdir().expect("tempdir");
        let empty = run_command(request(dir.path(), "   ", "sh", None)).await;
        assert!(matches!(empty, Err(ShellError::NoCommand)));

        let long = "x".repeat(MAX_COMMAND_CHARS + 1);
        let too_long = run_command(request(dir.path(), &long, "sh", None)).await;
        assert!(matches!(too_long, Err(ShellError::TooLong)));

        let missing = dir.path().join("missing");
        let no_folder = run_command(CommandRequest {
            cwd: missing,
            command: "ls".into(),
            shell: Some("sh".into()),
            timeout_ms: None,
            base_env: None,
            cancel: CancelToken::new(),
        })
        .await;
        let message = no_folder.expect_err("no folder").to_string();
        assert_eq!(message, "The project folder is not available.");

        let cmd = run_command(request(dir.path(), "dir", "cmd", None)).await;
        assert_eq!(
            cmd.expect_err("cmd").to_string(),
            "cmd is only available on Windows."
        );
    }

    #[test]
    fn login_env_ignores_what_comes_before_the_marker() {
        let raw = format!(
            "Welcome to the shell\nmotd: updates available\n{LOGIN_ENV_MARKER}\nPATH=/usr/bin:/bin\nHOME=/home/me\n{LOGIN_ENV_MARKER}\n"
        );
        let env = parse_login_env(&raw);
        assert_eq!(env.get("PATH").map(String::as_str), Some("/usr/bin:/bin"));
        assert_eq!(env.get("HOME").map(String::as_str), Some("/home/me"));
        assert!(!env.contains_key("motd"));
        assert_eq!(env.len(), 2);
    }

    #[test]
    fn login_env_keeps_a_value_that_spans_lines_and_keeps_equals_signs() {
        let raw =
            format!("{LOGIN_ENV_MARKER}\nMULTI=first\nsecond line\nEQ=a=b\n{LOGIN_ENV_MARKER}\n");
        let env = parse_login_env(&raw);
        assert_eq!(
            env.get("MULTI").map(String::as_str),
            Some("first\nsecond line")
        );
        assert_eq!(env.get("EQ").map(String::as_str), Some("a=b"));
    }

    #[test]
    fn login_env_without_a_marker_is_empty() {
        assert!(parse_login_env("PATH=/usr/bin\n").is_empty());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn login_shell_env_reads_the_shells_environment() {
        let env = login_shell_env(Some(Path::new("/bin/sh")))
            .await
            .expect("sh starts");
        assert!(env.contains_key("PATH"));
    }
}
