//! Handlers for the user's terminals. The renderer names a workspace and gets back an id minted here.

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use super::storage::workspace_root;
use super::{IpcError, Registry, emit};
use crate::AppState;
use crate::terminals::pty::{Launch, OpenError, clamp};
use crate::terminals::{TERMINALS, shells};

pub fn register_all(registry: &mut Registry) {
    register!(registry, "shell:open" => shell_open);
    register!(registry, "shell:list" => shell_list);
    register!(registry, "shell:write" => shell_write);
    register!(registry, "shell:resize" => shell_resize);
    register!(registry, "shell:close" => shell_close);
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
    let launch_env = shells::build_env(&invocation.env);
    let args = shells::interactive_args(&invocation.shell);
    let launch = Launch {
        file: &invocation.file,
        args: &args,
        cwd: &root,
        env: &launch_env,
        cols: clamp(option(options, "cols").and_then(Value::as_f64), 2, 500, 80),
        rows: clamp(option(options, "rows").and_then(Value::as_f64), 1, 200, 24),
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
