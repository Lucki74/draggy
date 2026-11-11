//! Handlers for the user's terminals. The renderer names a workspace and gets back an id minted here.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex, PoisonError};

use draggy_tools::spawn::CancelToken;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use super::storage::workspace_root;
use super::{IpcError, Registry, emit};
use crate::AppState;
use crate::terminals::pty::{Launch, OpenError, clamp};
use crate::terminals::tasks::{Manager as TaskManager, OutputOptions, TASKS};
use crate::terminals::{TERMINALS, shells};

pub fn register_all(registry: &mut Registry) {
    register!(registry, "shell:open" => shell_open);
    register!(registry, "shell:list" => shell_list);
    register!(registry, "shell:write" => shell_write);
    register!(registry, "shell:resize" => shell_resize);
    register!(registry, "shell:close" => shell_close);
    register!(registry, "tasks:list" => tasks_list);
    register!(registry, "tasks:output" => tasks_output);
    register!(registry, "tasks:wait" => tasks_wait);
    register!(registry, "tasks:abortWait" => tasks_abort_wait);
    register!(registry, "tasks:stop" => tasks_stop);
    register!(registry, "tasks:write" => tasks_write);
    register!(registry, "tasks:input" => tasks_input);
    register!(registry, "tasks:resize" => tasks_resize);
    register!(registry, "tasks:snapshot" => tasks_snapshot);
    register!(registry, "tasks:takeInbox" => tasks_take_inbox);
    register!(registry, "tasks:hasRunning" => tasks_has_running);
    register!(registry, "tasks:forget" => tasks_forget);
}

/// Waits in progress, by the id the renderer gave them, so `tasks:abortWait` can end one.
static WAITS: LazyLock<Mutex<HashMap<String, CancelToken>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// The task manager, made on first use. Its logs live in the app data folder and go on quit.
fn tasks_manager(app: &AppHandle) -> &'static TaskManager {
    TASKS.get_or_init(|| {
        let logs: PathBuf = app.state::<AppState>().storage.data_dir().join("task-logs");
        let app = app.clone();
        TaskManager::new(Some(logs), move |event| {
            emit(&app, "tasks:event", event);
        })
    })
}

/// `{ success: true, ...result }`, or the error the task layer gave.
fn answered(result: Result<Value, String>) -> Value {
    match result {
        Ok(Value::Object(mut body)) => {
            body.insert("success".into(), Value::Bool(true));
            Value::Object(body)
        }
        Ok(other) => json!({ "success": true, "result": other }),
        Err(error) => refused(&error),
    }
}

fn number(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64)
}

async fn tasks_list(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let tasks = tasks_manager(&app).list(&text(args.first()));
    Ok(json!({ "success": true, "tasks": tasks }))
}

async fn tasks_output(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let options = args.get(2);
    let options = OutputOptions {
        since: number(option(options, "since")),
        tail: number(option(options, "tail")),
        grep: option(options, "grep")
            .and_then(Value::as_str)
            .map(str::to_owned),
        max_chars: number(option(options, "max_chars")),
    };
    let result = tasks_manager(&app).output(&text(args.first()), &text(args.get(1)), &options);
    Ok(answered(result))
}

async fn tasks_wait(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let options = args.get(2);
    let wait_id = option(options, "waitId")
        .map(|value| text(Some(value)))
        .filter(|id| !id.is_empty());
    let abort = CancelToken::new();
    if let Some(id) = &wait_id {
        WAITS
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(id.clone(), abort.clone());
    }
    let seconds = number(option(options, "seconds")).unwrap_or(30.0);
    let until = option(options, "until")
        .and_then(Value::as_str)
        .filter(|pattern| !pattern.is_empty());
    let result = tasks_manager(&app)
        .wait(
            &text(args.first()),
            &text(args.get(1)),
            seconds,
            until,
            &abort,
        )
        .await
        .map(|waited| json!({ "reason": waited.reason, "task": waited.task }));
    if let Some(id) = &wait_id {
        WAITS
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(id);
    }
    Ok(answered(result))
}

async fn tasks_abort_wait(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let waits = WAITS.lock().unwrap_or_else(PoisonError::into_inner);
    let token = waits.get(&text(args.first()));
    let found = token.is_some();
    if let Some(token) = token {
        token.cancel();
    }
    Ok(json!({ "success": found }))
}

async fn tasks_stop(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    Ok(answered(
        tasks_manager(&app).stop(&text(args.first()), &text(args.get(1))),
    ))
}

async fn tasks_write(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let data = text(args.get(2));
    Ok(answered(tasks_manager(&app).write(
        &text(args.first()),
        &text(args.get(1)),
        &data,
    )))
}

/// Fire-and-forget keystrokes from the terminal pane. Nothing is answered.
async fn tasks_input(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let data = text(args.get(2));
    let _ = tasks_manager(&app).write(&text(args.first()), &text(args.get(1)), &data);
    Ok(Value::Null)
}

async fn tasks_resize(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let cols = clamp(number(args.get(1)), 2, 500, 80);
    let rows = clamp(number(args.get(2)), 1, 200, 24);
    Ok(json!({ "success": tasks_manager(&app).resize(&text(args.first()), cols, rows) }))
}

async fn tasks_snapshot(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    Ok(match tasks_manager(&app).snapshot(&text(args.first())) {
        Some(Value::Object(mut body)) => {
            body.insert("success".into(), Value::Bool(true));
            Value::Object(body)
        }
        _ => refused("That task is gone."),
    })
}

async fn tasks_take_inbox(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let items = tasks_manager(&app).take_inbox(&text(args.first()));
    Ok(json!({ "success": true, "items": items }))
}

async fn tasks_has_running(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let running = tasks_manager(&app).has_running(&text(args.first()));
    Ok(json!({ "success": true, "running": running }))
}

async fn tasks_forget(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    tasks_manager(&app).forget(&text(args.first()));
    // TODO(commands): also reset the chat's command state here once commands are ported.
    Ok(json!({ "success": true }))
}

fn text(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Number(number)) => number.to_string(),
        _ => String::new(),
    }
}

fn option<'a>(options: Option<&'a Value>, name: &str) -> Option<&'a Value> {
    options.and_then(|options| options.get(name))
}

fn refused(error: &str) -> Value {
    json!({ "success": false, "error": error })
}

async fn shell_open(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let Some(root) = workspace_root(&app, &text(args.first())).await else {
        return Ok(refused(
            "Terminals open inside a project, and this conversation has none.",
        ));
    };
    let options = args.get(1);
    let requested = option(options, "shell")
        .and_then(Value::as_str)
        .filter(|shell| *shell != "default");
    let default_shell = option(options, "defaultShell").and_then(Value::as_str);
    let env = shells::Env::system();
    let invocation = match shells::invocation(&env, "", requested, default_shell, false) {
        Ok(invocation) => invocation,
        Err(error) => return Ok(refused(&error)),
    };
    let mut launch_env = shells::build_env(&invocation.env);
    launch_env.insert("TERM".into(), "xterm-256color".into());
    launch_env.insert("COLORTERM".into(), "truecolor".into());
    let args = shells::interactive_args(&invocation.shell);
    let launch = Launch {
        file: &invocation.file,
        args: &args,
        cwd: &root,
        env: &launch_env,
        cols: clamp(option(options, "cols").and_then(Value::as_f64), 2, 500, 80),
        rows: clamp(option(options, "rows").and_then(Value::as_f64), 1, 200, 24),
        scrub_secrets: true,
    };
    let (data_app, exit_app) = (app.clone(), app.clone());
    let opened = TERMINALS.open(
        &launch,
        move |id, data| {
            emit(&data_app, "shell:data", json!({ "id": id, "data": data }));
        },
        move |id, code| {
            exit_app.state::<AppState>().diag.info(
                "proc.pty",
                "terminal closed",
                Some(json!({ "id": id, "exitCode": code })),
            );
            emit(
                &exit_app,
                "shell:exit",
                json!({ "id": id, "exitCode": code }),
            );
        },
    );
    let diag = &app.state::<AppState>().diag;
    match opened {
        Ok(opened) => {
            diag.info(
                "proc.pty",
                "terminal opened",
                Some(json!({ "id": opened.id, "shell": invocation.shell, "pid": opened.pid })),
            );
            let mut answer = json!({ "success": true, "id": opened.id, "shell": invocation.shell });
            if let Some(notice) = invocation.notice {
                answer["notice"] = Value::String(notice);
            }
            Ok(answer)
        }
        Err(OpenError::Unavailable) => Ok(json!({
            "success": false,
            "unavailable": true,
            "error": "The terminal is not available on this computer.",
        })),
        Err(OpenError::Failed(error)) => {
            diag.warn(
                "proc.pty",
                "terminal did not start",
                Some(json!({ "shell": invocation.shell, "error": error })),
            );
            let error = if error.is_empty() {
                "The terminal did not start.".to_owned()
            } else {
                error
            };
            Ok(refused(&error))
        }
    }
}

async fn shell_list(_app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    Ok(json!({ "success": true, "shells": shells::available(&shells::Env::system()) }))
}

/// Keystrokes and pastes. Only text reaches the shell.
async fn shell_write(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    if let Some(Value::String(data)) = args.get(1) {
        TERMINALS.write(&text(args.first()), data);
    }
    Ok(Value::Null)
}

async fn shell_resize(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let cols = clamp(args.get(1).and_then(Value::as_f64), 2, 500, 80);
    let rows = clamp(args.get(2).and_then(Value::as_f64), 1, 200, 24);
    Ok(json!({ "success": TERMINALS.resize(&text(args.first()), cols, rows) }))
}

async fn shell_close(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    Ok(json!({ "success": TERMINALS.close(&text(args.first())) }))
}
