//! The hook runner: one command with its JSON payload on stdin, a timeout that stops the whole tree, output capped.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};

use super::commands::{chat_dir, flag, opt_text, resource_dir};
use super::storage::workspace_root;
use super::terminals::{refused, text};
use super::{IpcError, Registry};
use crate::AppState;
use crate::terminals::sandbox::{self, Extras, Launch, Spawn};
use crate::terminals::shells::{self, Env, build_env};
use draggy_tools::spawn::{kill_tree, spawn_hidden_with_input};

const OUTPUT_CAP: usize = 64 * 1024;
const DEFAULT_TIMEOUT_MS: f64 = 60_000.0;
const MAX_TIMEOUT_MS: f64 = 600_000.0;

pub fn register_all(registry: &mut Registry) {
    register!(registry, "hooks:run" => hooks_run);
    register!(registry, "hooks:cancel" => hooks_cancel);
}

/// Process ids of hooks still running, keyed by the run id the renderer chose.
static RUNNING: LazyLock<Mutex<HashMap<String, u32>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Ends the hook run with this id and its process tree. Returns false when nothing was running under it.
async fn cancel_run(run_id: &str) -> bool {
    let pid = RUNNING
        .lock()
        .ok()
        .and_then(|mut running| running.remove(run_id));
    match pid {
        Some(pid) => {
            kill_tree(pid, false).await;
            true
        }
        None => false,
    }
}

async fn hooks_cancel(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let run_id = text(args.first());
    Ok(json!({ "cancelled": cancel_run(&run_id).await }))
}

/// Args: workspace, runId, command, options `{chatId, chatFolder, payload, timeoutMs, sandbox, outsideSandbox, network, shell, defaultShell}`.
async fn hooks_run(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let workspace = text(args.first());
    let command = text(args.get(2));
    let options = args.get(3);
    if command.trim().is_empty() {
        return Ok(refused("No hook command was given."));
    }

    let chat_id = opt_text(options, "chatId").unwrap_or_else(|| "default".to_owned());
    let root = match workspace_root(&app, &workspace).await {
        Some(root) => root,
        None if flag(options, "chatFolder") => match chat_dir(&app, &chat_id) {
            Ok(dir) => dir,
            Err(error) => return Ok(refused(&error)),
        },
        None => {
            return Ok(refused(
                "Hooks run inside a project, and this conversation has none.",
            ));
        }
    };

    let sandboxed = flag(options, "sandbox") && !flag(options, "outsideSandbox");
    let payload = opt_text(options, "payload").unwrap_or_default();
    let timeout_ms = timeout_ms(options);

    let invocation = match shells::invocation(
        &Env::system(),
        &command,
        opt_text(options, "shell").as_deref(),
        opt_text(options, "defaultShell").as_deref(),
        sandboxed,
        &[],
    ) {
        Ok(invocation) => invocation,
        Err(error) => return Ok(refused(&error)),
    };
    let child_env = build_env(&invocation.env);
    let spawn = Spawn {
        file: &invocation.file,
        args: &invocation.args,
        verbatim: invocation.verbatim,
        cwd: &root,
        env: &child_env,
    };
    let launch = if sandboxed {
        let sandbox_options = sandbox::Options {
            project: root.clone(),
            data_dir: app.state::<AppState>().storage.data_dir().to_path_buf(),
            chat_key: chat_id.clone(),
            launcher: sandbox::launcher(resource_dir(&app).as_deref()),
            network: flag(options, "network"),
            writable: flag(options, "writable"),
            extras: Extras::default(),
        };
        match sandbox::wrap(&spawn, &sandbox_options) {
            Ok(launch) => launch,
            Err(error) => return Ok(refused(&error)),
        }
    } else {
        Launch::direct(&spawn)
    };

    // The first hook of a folder may wait for the sandbox grant; the note tells the user why.
    let mut notice = None;
    if sandbox::needs_grant(&launch) {
        notice = Some(sandbox::SETUP_NOTE.to_owned());
        if let Err(error) = sandbox::ready(&launch).await {
            return Ok(refused(&format!(
                "The sandbox could not get access to the folder: {error}"
            )));
        }
    }

    let run_id = text(args.get(1));
    let mut result = run_hook_for(
        &run_id,
        &launch,
        &payload,
        Duration::from_millis(timeout_ms as u64),
    )
    .await;
    if let Ok(mut running) = RUNNING.lock() {
        running.remove(&run_id);
    }
    if let Some(notice) = notice {
        result["notice"] = json!(notice);
    }
    Ok(result)
}

/// The hook's time limit in milliseconds: the default when missing or invalid, never above the maximum.
fn timeout_ms(options: Option<&Value>) -> f64 {
    options
        .and_then(|value| value.get("timeoutMs"))
        .and_then(Value::as_f64)
        .filter(|ms| ms.is_finite() && *ms > 0.0)
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .min(MAX_TIMEOUT_MS)
}

/// Windows job that kills every process in it when closed, so grandchildren cannot outlive the hook.
#[cfg(windows)]
struct Job(std::os::windows::io::OwnedHandle);

#[cfg(windows)]
impl Job {
    /// Puts the hook into a new job. Processes started before this call are not covered.
    fn adopt(process: std::os::windows::io::RawHandle) -> Option<Self> {
        use std::os::windows::io::{FromRawHandle, OwnedHandle};
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
            SetInformationJobObject,
        };
        // SAFETY: plain Win32 calls on handles this function owns; the job handle is closed by OwnedHandle.
        unsafe {
            let raw = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if raw.is_null() {
                return None;
            }
            let job = OwnedHandle::from_raw_handle(raw);
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let size = std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
            let set = SetInformationJobObject(
                raw,
                JobObjectExtendedLimitInformation,
                (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size,
            );
            if set == 0 || AssignProcessToJobObject(raw, process) == 0 {
                return None;
            }
            Some(Self(job))
        }
    }

    /// Ends every process still in the job, including ones holding the hook's pipes.
    fn end(&self) {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::TerminateJobObject;
        // SAFETY: the handle stays open for the life of self.
        unsafe {
            TerminateJobObject(self.0.as_raw_handle(), 1);
        }
    }
}

/// Runs a prepared launch with the payload on stdin and returns the hook's result, never an error.
#[cfg(test)]
async fn run_hook(launch: &Launch, payload: &str, limit: Duration) -> Value {
    run_hook_for("", launch, payload, limit).await
}

/// As `run_hook`, and while it runs the child is listed under `run_id` so `hooks:cancel` can end it.
pub(crate) async fn run_hook_for(
    run_id: &str,
    launch: &Launch,
    payload: &str,
    limit: Duration,
) -> Value {
    let no_args: [&str; 0] = [];
    let spawned = spawn_hidden_with_input(&launch.file, &no_args, |command| {
        #[cfg(windows)]
        if launch.verbatim {
            for arg in &launch.args {
                command.raw_arg(arg);
            }
        } else {
            command.args(&launch.args);
        }
        #[cfg(not(windows))]
        command.args(&launch.args);
        command
            .current_dir(&launch.cwd)
            .env_clear()
            .envs(&launch.env);
    });
    let mut child = match spawned {
        Ok(child) => child,
        Err(error) => return refused(&format!("The hook could not start: {error}")),
    };
    let pid = child.id();
    if let (Some(pid), false) = (pid, run_id.is_empty())
        && let Ok(mut running) = RUNNING.lock()
    {
        running.insert(run_id.to_owned(), pid);
    }
    #[cfg(windows)]
    let job = child.raw_handle().and_then(Job::adopt);
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let body = async {
        let feed = async move {
            if let Some(mut stdin) = stdin {
                // A hook that never reads stdin closes the pipe early; that is not a failure.
                let _ = stdin.write_all(payload.as_bytes()).await;
            }
        };
        let reap = async {
            let status = child.wait().await;
            // The hook is done: end whatever it left behind so the pipes reach their end.
            #[cfg(windows)]
            if let Some(job) = &job {
                job.end();
            }
            status
        };
        let read = async { tokio::join!(read_capped(stdout), read_capped(stderr)) };
        let ((), (out, err), status) = tokio::join!(feed, read, reap);
        (out, err, status)
    };

    match tokio::time::timeout(limit, body).await {
        Ok((stdout, stderr, status)) => {
            let code = status.ok().and_then(|status| status.code());
            json!({
                "success": code == Some(0),
                "exitCode": code,
                "stdout": stdout,
                "stderr": stderr,
                "timedOut": false,
            })
        }
        Err(_) => {
            if let Some(pid) = pid {
                kill_tree(pid, false).await;
            }
            json!({ "success": false, "exitCode": null, "stdout": "", "stderr": "", "timedOut": true })
        }
    }
}

/// Reads a stream to its end so the child never blocks, keeping at most the cap and noting a cut.
async fn read_capped<R: AsyncRead + Unpin>(stream: Option<R>) -> String {
    let Some(mut stream) = stream else {
        return String::new();
    };
    let mut kept = Vec::new();
    let mut cut = false;
    let mut chunk = [0u8; 8_192];
    loop {
        match stream.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(read) => {
                let room = OUTPUT_CAP.saturating_sub(kept.len());
                kept.extend_from_slice(&chunk[..read.min(room)]);
                cut |= read > room;
            }
        }
    }
    let mut text = String::from_utf8_lossy(&kept).into_owned();
    if cut {
        text.push_str("\n[output cut]");
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn direct(file: &str, args: &[&str], verbatim: bool) -> Launch {
        Launch {
            file: PathBuf::from(file),
            args: args.iter().map(|arg| (*arg).to_owned()).collect(),
            verbatim,
            cwd: std::env::temp_dir(),
            env: build_env(&[]),
            grant: None,
        }
    }

    #[cfg(windows)]
    fn echo_stdin() -> Launch {
        direct("cmd", &["/D", "/S", "/C", "findstr ."], true)
    }

    #[cfg(not(windows))]
    fn echo_stdin() -> Launch {
        direct("cat", &[], false)
    }

    #[tokio::test]
    async fn hook_reads_the_payload_from_stdin() {
        let result = run_hook(
            &echo_stdin(),
            "{\"hook_event_name\":\"Stop\"}",
            Duration::from_secs(20),
        )
        .await;
        assert_eq!(result["success"], json!(true));
        assert!(
            result["stdout"]
                .as_str()
                .unwrap_or_default()
                .contains("Stop")
        );
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn exit_two_maps_to_exit_code_two() {
        let launch = direct("cmd", &["/D", "/S", "/C", "exit 2"], true);
        let result = run_hook(&launch, "{}", Duration::from_secs(20)).await;
        assert_eq!(result["exitCode"], json!(2));
        assert_eq!(result["success"], json!(false));
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn timeout_stops_a_sleeping_hook() {
        let launch = direct(
            "cmd",
            &["/D", "/S", "/C", "ping -n 30 127.0.0.1 >nul"],
            true,
        );
        let result = run_hook(&launch, "{}", Duration::from_millis(300)).await;
        assert_eq!(result["timedOut"], json!(true));
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn grandchild_holding_the_pipes_is_ended_with_the_hook() {
        let marker =
            std::env::temp_dir().join(format!("draggy-hook-grandchild-{}.txt", std::process::id()));
        let _ = std::fs::remove_file(&marker);
        let script = format!(
            "start /b cmd /d /c \"ping -n 4 127.0.0.1 >nul && echo done > {}\" & exit 0",
            marker.display()
        );
        let launch = direct("cmd", &["/D", "/S", "/C", script.as_str()], true);
        let started = std::time::Instant::now();
        let result = run_hook(&launch, "{}", Duration::from_secs(20)).await;
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "hook waited for the grandchild"
        );
        assert_eq!(result["timedOut"], json!(false));
        tokio::time::sleep(Duration::from_secs(5)).await;
        assert!(!marker.exists(), "grandchild survived the hook");
    }

    #[tokio::test]
    async fn cancel_ends_a_running_hook() {
        let launch = if cfg!(windows) {
            direct(
                "cmd",
                &["/D", "/S", "/C", "ping -n 30 127.0.0.1 >nul"],
                true,
            )
        } else {
            direct("sleep", &["30"], false)
        };
        let started = std::time::Instant::now();
        let hook = run_hook_for("cancel-test", &launch, "{}", Duration::from_secs(60));
        let cancel = async {
            tokio::time::sleep(Duration::from_millis(500)).await;
            assert!(cancel_run("cancel-test").await);
        };
        let (result, ()) = tokio::join!(hook, cancel);
        assert!(started.elapsed() < Duration::from_secs(20));
        assert_eq!(result["timedOut"], json!(false));
    }

    #[tokio::test]
    async fn output_is_capped_and_marked() {
        let big = vec![b'a'; OUTPUT_CAP + 1_000];
        let text = read_capped(Some(big.as_slice())).await;
        assert!(text.ends_with("[output cut]"));
        assert_eq!(text.len(), OUTPUT_CAP + "\n[output cut]".len());
    }

    #[test]
    fn timeout_defaults_and_caps() {
        assert_eq!(timeout_ms(None), DEFAULT_TIMEOUT_MS);
        assert_eq!(
            timeout_ms(Some(&json!({"timeoutMs": -5}))),
            DEFAULT_TIMEOUT_MS
        );
        assert_eq!(
            timeout_ms(Some(&json!({"timeoutMs": 1e12}))),
            MAX_TIMEOUT_MS
        );
        assert_eq!(timeout_ms(Some(&json!({"timeoutMs": 2500}))), 2500.0);
    }

    #[tokio::test]
    async fn missing_program_returns_a_refusal_not_an_error() {
        let launch = direct("draggy-no-such-hook-binary", &[], false);
        let result = run_hook(&launch, "{}", Duration::from_secs(5)).await;
        assert_eq!(result["success"], json!(false));
        assert!(result["error"].is_string());
    }
}
