//! Foreground commands the model runs in a project: a real shell in the project folder, stoppable, with output cut
//! to a size a model can read. A command can be moved to the
//! background as a task, and a chat's folder and environment carry over from one command to the next.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use draggy_tools::shell::{clip, timeout_for};
use draggy_tools::spawn::CancelToken;
use draggy_tools::task_text::{
    EnvDiff, HEAD_CHARS, MAX_OUTPUT_CHARS, StateFilter, apply_env_diff, clean_output, env_diff,
    parse_state, state_epilogue, supports_state,
};
use serde_json::{Value, json};
use tokio::sync::oneshot;

use super::pipe::{self, Pipe, PipeExit, PipeLaunch};
use super::sandbox::{self, Launch, Spawn, inside};
use super::shells::{self, Env, build_env};
use super::tasks::{Adopted, Exit, Manager as TaskManager};

const MAX_COMMAND_CHARS: usize = 8_000;

/// Commands in flight by run id, so the renderer can stop one and a quit can stop them all.
static LIVE: LazyLock<Mutex<HashMap<String, Arc<Shared>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
/// Where each chat's commands left off: the folder and the environment changes, kept per shell because Git Bash
/// and PowerShell write the same variable (PATH) in different forms.
static STATE: LazyLock<Mutex<HashMap<String, Saved>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// One foreground run, as the IPC layer names it. `sandbox` is set when the command runs in the launcher.
pub struct Request {
    pub run_id: Option<String>,
    pub root: PathBuf,
    pub command: String,
    pub shell: Option<String>,
    pub default_shell: Option<String>,
    pub timeout: Option<f64>,
    pub chat_id: String,
    pub auto_detach: bool,
    pub sandbox: Option<sandbox::Options>,
    pub on_output: Arc<dyn Fn(&str) + Send + Sync>,
}

#[derive(Clone, Default)]
struct Saved {
    cwd: Option<PathBuf>,
    env: HashMap<String, EnvDiff>,
    note: Option<String>,
}

/// One command in flight. Output, the process and the reply live behind one lock; the rest is fixed.
struct Shared {
    run_id: Option<String>,
    root: PathBuf,
    chat_id: String,
    command: String,
    shell: String,
    notice: Option<String>,
    marker: Option<String>,
    pristine: BTreeMap<String, String>,
    saved: Saved,
    started: Instant,
    tasks: &'static TaskManager,
    on_output: Arc<dyn Fn(&str) + Send + Sync>,
    live: Mutex<Live>,
}

#[derive(Default)]
struct Live {
    output: String,
    filter: Option<StateFilter>,
    sink: Option<Adopted>,
    pipe: Option<Pipe>,
    timer: Option<CancelToken>,
    cancelled: bool,
    timed_out: bool,
    settled: bool,
    reply: Option<oneshot::Sender<Value>>,
}

fn refused(error: &str) -> Value {
    json!({ "success": false, "error": error })
}

fn live_map() -> MutexGuard<'static, HashMap<String, Arc<Shared>>> {
    LIVE.lock().unwrap_or_else(PoisonError::into_inner)
}

fn saved_state(chat_id: &str) -> Saved {
    STATE
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(chat_id)
        .cloned()
        .unwrap_or_default()
}

/// The folder the next command starts in: where the last one ended, if that is still inside the project.
fn start_folder(root: &Path, saved: &Saved) -> PathBuf {
    saved
        .cwd
        .as_ref()
        .filter(|cwd| inside(root, cwd) && cwd.exists())
        .cloned()
        .unwrap_or_else(|| root.to_path_buf())
}

/// `/d/work` or `d:/work` from Git Bash is `D:\work` to everything else. Other paths are left alone.
pub fn from_shell_path(value: &str) -> String {
    let bytes = value.as_bytes();
    if bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'/' {
        return value.replace('/', "\\");
    }
    let stripped = value
        .strip_prefix("/mnt/")
        .or_else(|| value.strip_prefix('/'));
    if let Some(rest) = stripped {
        let mut chars = rest.chars();
        if let Some(drive) = chars.next().filter(char::is_ascii_alphabetic) {
            let after = chars.as_str();
            if after.is_empty() {
                return format!("{}:\\", drive.to_ascii_uppercase());
            }
            if let Some(path) = after.strip_prefix('/') {
                return format!(
                    "{}:\\{}",
                    drive.to_ascii_uppercase(),
                    path.replace('/', "\\")
                );
            }
        }
    }
    value.to_owned()
}

/// Runs one command and resolves with its result once it finishes, is cancelled, or is moved to the background.
pub async fn run(tasks: &'static TaskManager, request: Request) -> Value {
    let text = request.command.clone();
    if text.trim().is_empty() {
        return refused("No command was given.");
    }
    if text.chars().count() > MAX_COMMAND_CHARS {
        return refused("That command is too long to run.");
    }
    if !request.root.exists() {
        return refused("The project folder is not available.");
    }

    let env = Env::system();
    let shell = request.shell.as_deref();
    let default_shell = request.default_shell.as_deref();
    let sandboxed = request.sandbox.is_some();
    let proven = match &request.sandbox {
        Some(options) => sandbox_shells(&request, options).await,
        None => Vec::new(),
    };
    let plain = match shells::invocation(&env, &text, shell, default_shell, sandboxed, &proven) {
        Ok(invocation) => invocation,
        Err(error) => return refused(&error),
    };
    let marker = supports_state(&plain.shell).then(|| format!("DG{}", marker_token()));
    let invocation = match &marker {
        Some(marker) => {
            let epilogue = state_epilogue(&plain.shell, marker).unwrap_or_default();
            match shells::invocation(
                &env,
                &format!("{text}{epilogue}"),
                shell,
                default_shell,
                sandboxed,
                &proven,
            ) {
                Ok(invocation) => invocation,
                Err(error) => return refused(&error),
            }
        }
        None => plain,
    };

    let key = request.run_id.clone();
    if key.as_ref().is_some_and(|key| live_map().contains_key(key)) {
        return refused("A command with that id is already running.");
    }

    let limit = timeout_for(request.timeout);
    let saved = if marker.is_some() {
        saved_state(&request.chat_id)
    } else {
        Saved::default()
    };
    let pristine = build_env(&invocation.env);
    let child_env = match saved.env.get(&invocation.shell) {
        Some(diff) => apply_env_diff(&pristine, diff),
        None => pristine.clone(),
    };
    let folder = if marker.is_some() {
        start_folder(&request.root, &saved)
    } else {
        request.root.clone()
    };

    let (reply, answer) = oneshot::channel();
    let shared = Arc::new(Shared {
        run_id: key.clone(),
        root: request.root.clone(),
        chat_id: request.chat_id.clone(),
        command: text.clone(),
        shell: invocation.shell.clone(),
        notice: invocation.notice.clone(),
        marker,
        pristine,
        saved,
        started: Instant::now(),
        tasks,
        on_output: Arc::clone(&request.on_output),
        live: Mutex::new(Live {
            reply: Some(reply),
            ..Live::default()
        }),
    });
    if let Some(key) = &key {
        live_map().insert(key.clone(), Arc::clone(&shared));
    }

    let spawn = Spawn {
        file: &invocation.file,
        args: &invocation.args,
        verbatim: invocation.verbatim,
        cwd: &folder,
        env: &child_env,
    };
    let launch = match &request.sandbox {
        Some(options) => match sandbox::wrap(&spawn, options) {
            Ok(launch) => launch,
            Err(error) => {
                shared.finish(refused(&error));
                return await_reply(answer).await;
            }
        },
        None => Launch::direct(&spawn),
    };

    if sandbox::needs_grant(&launch) {
        (shared.on_output)(sandbox::SETUP_NOTE);
        let waiting = Arc::clone(&shared);
        let auto_detach = request.auto_detach;
        tauri::async_runtime::spawn(async move {
            match sandbox::ready(&launch).await {
                Ok(()) => waiting.begin(launch, limit, auto_detach),
                Err(error) => waiting.finish(refused(&format!(
                    "The sandbox could not get access to the folder: {error}"
                ))),
            }
        });
    } else {
        shared.begin(launch, limit, request.auto_detach);
    }
    await_reply(answer).await
}

/// The shell a sandboxed command may use: the one it asked for, once a check showed it starts in the container.
/// Cmd always starts there, so it needs no check.
async fn sandbox_shells(request: &Request, options: &sandbox::Options) -> Vec<String> {
    let mark = format!("echo {}", sandbox::SHELL_MARK);
    let shell = request.shell.as_deref();
    let default_shell = request.default_shell.as_deref();
    let Ok(wanted) = shells::invocation(&Env::system(), &mark, shell, default_shell, false, &[])
    else {
        return Vec::new();
    };
    if wanted.shell == "cmd" {
        return Vec::new();
    }
    let child_env = build_env(&wanted.env);
    let spawn = Spawn {
        file: &wanted.file,
        args: &wanted.args,
        verbatim: wanted.verbatim,
        cwd: &request.root,
        env: &child_env,
    };
    let Ok(launch) = sandbox::wrap(&spawn, options) else {
        return Vec::new();
    };
    if sandbox::needs_grant(&launch) {
        (request.on_output)(sandbox::SETUP_NOTE);
    }
    if sandbox::shell_works(&launch, &wanted.shell).await {
        vec![wanted.shell]
    } else {
        Vec::new()
    }
}

async fn await_reply(answer: oneshot::Receiver<Value>) -> Value {
    answer
        .await
        .unwrap_or_else(|_| refused("The command did not finish."))
}

impl Shared {
    fn locked(&self) -> MutexGuard<'_, Live> {
        self.live.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Starts the process, with a timer that moves it to the background or stops it at the time limit.
    fn begin(self: &Arc<Self>, launch: Launch, limit: Duration, auto_detach: bool) {
        if self.locked().cancelled {
            self.finish(json!({ "success": false, "cancelled": true, "error": "The command was cancelled." }));
            return;
        }
        let timer = CancelToken::new();
        self.locked().timer = Some(timer.clone());
        let weak = Arc::downgrade(self);
        tauri::async_runtime::spawn(async move {
            tokio::select! {
                () = tokio::time::sleep(limit) => {}
                () = timer.cancelled() => return,
            }
            let Some(shared) = weak.upgrade() else {
                return;
            };
            if auto_detach && shared.detach()["success"] == json!(true) {
                return;
            }
            shared.locked().timed_out = true;
            shared.kill();
        });

        let on_chunk = {
            let shared = Arc::clone(self);
            move |chunk: &str| shared.collect(chunk)
        };
        let on_exit = {
            let shared = Arc::clone(self);
            move |exit: PipeExit| shared.exited(exit)
        };
        let plain = PipeLaunch {
            file: &launch.file,
            args: &launch.args,
            verbatim: launch.verbatim,
            cwd: &launch.cwd,
            env: &launch.env,
        };
        match pipe::spawn(&plain, on_chunk, on_exit) {
            Ok(process) => {
                let cancelled = {
                    let mut live = self.locked();
                    live.pipe = Some(process.clone());
                    live.cancelled
                };
                if cancelled {
                    process.kill();
                }
            }
            Err(error) => self.finish(refused(&error.to_string())),
        }
    }

    /// Output as it arrives: kept while the command runs, or handed to the task once it has been moved.
    fn collect(&self, chunk: &str) {
        {
            let mut guard = self.locked();
            let live = &mut *guard;
            if let Some(sink) = live.sink.as_ref() {
                let shown = match live.filter.as_mut() {
                    Some(filter) => filter.push(chunk),
                    None => chunk.to_owned(),
                };
                if !shown.is_empty() {
                    sink.push(&shown);
                }
                return;
            }
            live.output.push_str(chunk);
            // Kept bounded while it runs: the start, and a generous end.
            if live.output.len() > MAX_OUTPUT_CHARS * 3 {
                let total = live.output.chars().count();
                let head: String = live.output.chars().take(HEAD_CHARS).collect();
                let tail: String = live
                    .output
                    .chars()
                    .skip(total.saturating_sub(MAX_OUTPUT_CHARS * 2))
                    .collect();
                live.output = head + &tail;
            }
        }
        (self.on_output)(chunk);
    }

    fn exited(&self, exit: PipeExit) {
        let mut guard = self.locked();
        let live = &mut *guard;
        if let Some(sink) = live.sink.as_ref() {
            let rest = live
                .filter
                .as_mut()
                .map(StateFilter::end)
                .unwrap_or_default();
            if !rest.is_empty() {
                sink.push(&rest);
            }
            sink.exit(Exit {
                code: exit.code,
                signal: None,
                error: exit.error,
            });
            return;
        }
        if let Some(error) = exit.error {
            drop(guard);
            self.finish(refused(&error));
            return;
        }
        let (output, timed_out, cancelled) = (live.output.clone(), live.timed_out, live.cancelled);
        drop(guard);

        let (shown, outside) = self.record_state(&output);
        let clipped = clip(&shown);
        let mut result = json!({
            "success": !timed_out && !cancelled && exit.code == Some(0),
            "exitCode": exit.code,
            "signal": null,
            "timedOut": timed_out,
            "cancelled": cancelled,
            "output": clipped.text,
            "truncated": clipped.truncated,
        });
        if let Some(note) = outside {
            result["outside"] = json!(note);
        }
        self.finish(result);
    }

    /// Reads the folder and environment the shell reported, and returns the output the model sees.
    fn record_state(&self, output: &str) -> (String, Option<String>) {
        let Some(marker) = &self.marker else {
            return (output.to_owned(), None);
        };
        let (shown, state) = parse_state(output, marker);
        if let Some(state) = state {
            let next = PathBuf::from(from_shell_path(&state.cwd));
            let within = inside(&self.root, &next);
            let mut env = self.saved.env.clone();
            env.insert(self.shell.clone(), env_diff(&self.pristine, &state.env));
            let cwd = if within && next.exists() {
                Some(next.clone())
            } else {
                self.saved.cwd.clone()
            };
            let note = (!within).then(|| next.display().to_string());
            STATE
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .insert(self.chat_id.clone(), Saved { cwd, env, note });
        }
        let note = STATE
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&self.chat_id)
            .and_then(|saved| saved.note.clone());
        (shown, note)
    }

    /// Hands the running process to the task manager. The output so far goes with it, and the run resolves at once.
    fn detach(self: &Arc<Self>) -> Value {
        let mut guard = self.locked();
        let live = &mut *guard;
        if live.settled || live.sink.is_some() {
            return refused("This command cannot be moved to the background.");
        }
        let shown = match &self.marker {
            Some(marker) => {
                let mut filter = StateFilter::new(marker);
                let mut text = filter.push(&live.output);
                text.push_str(&filter.end());
                text
            }
            None => live.output.clone(),
        };
        live.filter = self.marker.as_ref().map(|marker| StateFilter::new(marker));
        let weak = Arc::downgrade(self);
        let kill = move || {
            if let Some(shared) = weak.upgrade() {
                shared.kill();
            }
        };
        let adopted =
            match self
                .tasks
                .adopt(&self.chat_id, &self.command, &self.shell, &shown, kill)
            {
                Ok(adopted) => adopted,
                Err(error) => return refused(&error),
            };
        let id = adopted.task.get("id").cloned().unwrap_or(Value::Null);
        live.sink = Some(adopted);
        let output = clean_output(&shown);
        drop(guard);
        self.finish(json!({
            "success": true,
            "detached": true,
            "taskId": id,
            "output": output,
            "truncated": false,
        }));
        json!({ "success": true, "taskId": id })
    }

    fn kill(&self) {
        let process = self.locked().pipe.clone();
        if let Some(process) = process {
            process.kill();
        }
    }

    /// Resolves the run once. Adds the shell, duration and notice to the result, and drops the run from the live list.
    fn finish(&self, result: Value) {
        let (reply, timer) = {
            let mut live = self.locked();
            if live.settled {
                return;
            }
            live.settled = true;
            (live.reply.take(), live.timer.take())
        };
        if let Some(timer) = timer {
            timer.cancel();
        }
        if let Some(key) = &self.run_id {
            let mut map = live_map();
            if map
                .get(key)
                .is_some_and(|entry| std::ptr::eq(Arc::as_ptr(entry), self))
            {
                map.remove(key);
            }
        }
        let mut body = match result {
            Value::Object(map) => map,
            _ => serde_json::Map::new(),
        };
        body.insert("shell".into(), json!(self.shell));
        body.insert(
            "durationMs".into(),
            json!(u64::try_from(self.started.elapsed().as_millis()).unwrap_or(u64::MAX)),
        );
        if let Some(notice) = &self.notice {
            body.insert("notice".into(), json!(notice));
        }
        if let Some(reply) = reply {
            let _ = reply.send(Value::Object(body));
        }
    }
}

/// Moves a running command to the background. Fails when it has already finished or cannot move.
pub fn detach(run_id: &str) -> Value {
    let shared = live_map().get(run_id).cloned();
    match shared {
        Some(shared) => shared.detach(),
        None => refused("That command is not running."),
    }
}

/// Stops one command and everything it started. False when it had already finished.
pub fn cancel(run_id: &str) -> bool {
    let Some(shared) = live_map().remove(run_id) else {
        return false;
    };
    let process = {
        let mut live = shared.locked();
        live.cancelled = true;
        live.pipe.clone()
    };
    if let Some(process) = process {
        process.kill();
    }
    true
}

/// Kills every command still going, for a quit.
pub fn stop_all() {
    let running: Vec<Arc<Shared>> = live_map().drain().map(|(_, shared)| shared).collect();
    for shared in running {
        let process = {
            let mut live = shared.locked();
            live.cancelled = true;
            live.pipe.clone()
        };
        if let Some(process) = process {
            process.kill();
        }
    }
}

/// Forgets a chat's folder and environment, so its next command starts fresh. True when there was any.
pub fn reset_state(chat_id: &str) -> bool {
    STATE
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(chat_id)
        .is_some()
}

/// Twelve random hex digits that name one command's state marker.
fn marker_token() -> String {
    let mut bytes = [0u8; 6];
    if getrandom::fill(&mut bytes).is_err() {
        return format!("{:012x}", Instant::now().elapsed().as_nanos());
    }
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_paths_become_windows_paths() {
        assert_eq!(from_shell_path("/d/work"), "D:\\work");
        assert_eq!(from_shell_path("/mnt/c/x/y"), "C:\\x\\y");
        assert_eq!(from_shell_path("/d"), "D:\\");
        assert_eq!(from_shell_path("E:/dev/app"), "E:\\dev\\app");
        assert_eq!(from_shell_path("/etc/hosts"), "/etc/hosts");
        assert_eq!(from_shell_path("/mnt"), "/mnt");
    }
}

#[cfg(test)]
mod run_tests {
    use super::*;

    fn manager() -> &'static TaskManager {
        Box::leak(Box::new(TaskManager::new(None, |_| {})))
    }

    fn request(command: &str, root: PathBuf) -> Request {
        Request {
            run_id: None,
            root,
            command: command.to_owned(),
            shell: Some("cmd".to_owned()),
            default_shell: None,
            timeout: None,
            chat_id: "test-chat".to_owned(),
            auto_detach: false,
            sandbox: None,
            on_output: Arc::new(|_| {}),
        }
    }

    #[tokio::test]
    async fn refuses_empty_and_missing_folders() {
        let empty = run(manager(), request("   ", std::env::temp_dir())).await;
        assert_eq!(empty["success"], json!(false));
        let missing = run(
            manager(),
            request("echo hi", PathBuf::from("Z:/no/such/folder")),
        )
        .await;
        assert_eq!(
            missing["error"],
            json!("The project folder is not available.")
        );
    }

    #[tokio::test]
    async fn echo_returns_output_and_exit_code() {
        let result = run(manager(), request("echo hi", std::env::temp_dir())).await;
        assert_eq!(result["success"], json!(true));
        assert_eq!(result["exitCode"], json!(0));
        assert!(result["output"].as_str().unwrap_or_default().contains("hi"));
    }

    #[tokio::test]
    async fn timeout_moves_the_command_to_a_background_task() {
        let manager = manager();
        let mut req = request("ping -n 20 127.0.0.1 >nul", std::env::temp_dir());
        req.timeout = Some(1000.0);
        req.auto_detach = true;
        req.chat_id = "timeout-chat".to_owned();
        let result = run(manager, req).await;
        assert_eq!(result["detached"], json!(true));
        let id = result["taskId"].as_str().expect("task id").to_owned();
        manager.stop("timeout-chat", &id).expect("stop");
    }

    #[tokio::test]
    async fn cancel_stops_a_running_command_by_run_id() {
        let mut req = request("ping -n 20 127.0.0.1 >nul", std::env::temp_dir());
        req.run_id = Some("cancel-run".to_owned());
        let running = tokio::spawn(run(manager(), req));
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(cancel("cancel-run"));
        let result = running.await.expect("join");
        assert_eq!(result["cancelled"], json!(true));
        assert_eq!(result["success"], json!(false));
    }

    #[tokio::test]
    async fn refuses_a_duplicate_run_id() {
        let manager = manager();
        let mut req = request("ping -n 20 127.0.0.1 >nul", std::env::temp_dir());
        req.run_id = Some("dup-run".to_owned());
        let first = tokio::spawn(run(manager, req));
        tokio::time::sleep(Duration::from_millis(300)).await;
        let mut again = request("echo hi", std::env::temp_dir());
        again.run_id = Some("dup-run".to_owned());
        let second = run(manager, again).await;
        assert_eq!(
            second["error"],
            json!("A command with that id is already running.")
        );
        assert!(cancel("dup-run"));
        first.await.expect("join");
    }

    #[tokio::test]
    async fn detach_hands_a_running_command_to_a_task() {
        let manager = manager();
        let mut req = request("ping -n 20 127.0.0.1 >nul", std::env::temp_dir());
        req.run_id = Some("detach-run".to_owned());
        req.chat_id = "detach-chat".to_owned();
        let running = tokio::spawn(run(manager, req));
        tokio::time::sleep(Duration::from_millis(300)).await;
        let moved = detach("detach-run");
        assert_eq!(moved["success"], json!(true));
        let result = running.await.expect("join");
        assert_eq!(result["detached"], json!(true));
        let id = moved["taskId"].as_str().expect("task id").to_owned();
        manager.stop("detach-chat", &id).expect("stop");
    }

    #[tokio::test]
    async fn carries_folder_and_environment_until_reset() {
        let manager = manager();
        let root = std::env::temp_dir().join(format!("dg-state-{}", marker_token()));
        std::fs::create_dir_all(root.join("sub")).expect("folder");
        let chat = "state-chat";
        let mut first = request("cd sub && export DG_STATE=carried", root.clone());
        first.shell = Some("bash".to_owned());
        first.chat_id = chat.to_owned();
        assert_eq!(run(manager, first).await["success"], json!(true));

        let mut second = request("pwd && echo $DG_STATE", root.clone());
        second.shell = Some("bash".to_owned());
        second.chat_id = chat.to_owned();
        let seen = run(manager, second).await;
        let output = seen["output"].as_str().unwrap_or_default().to_owned();
        assert!(output.contains("sub") && output.contains("carried"));

        assert!(reset_state(chat));
        assert!(!reset_state(chat));
        let mut third = request("pwd", root);
        third.shell = Some("bash".to_owned());
        third.chat_id = chat.to_owned();
        let fresh = run(manager, third).await;
        assert!(!fresh["output"].as_str().unwrap_or_default().contains("sub"));
    }
}
