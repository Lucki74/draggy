//! Handlers for the command channels: a run in the foreground or as a task, detach, cancel and reset.

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use super::storage::workspace_root;
use super::terminals::{option, refused, tasks_manager, text};
use super::{IpcError, Registry, emit};
use crate::AppState;
use crate::terminals::commands::{self, Request};
use crate::terminals::elevate;
use crate::terminals::sandbox::{self, Extras};
use crate::terminals::tasks::StartOptions;

pub fn register_all(registry: &mut Registry) {
    register!(registry, "commands:run" => commands_run);
    register!(registry, "commands:detach" => commands_detach);
    register!(registry, "commands:resetState" => commands_reset_state);
    register!(registry, "commands:cancel" => commands_cancel);
}

async fn commands_run(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let workspace = text(args.first());
    let run_id = text(args.get(1));
    let command = text(args.get(2));
    let options = args.get(3);

    let chat_id = opt_text(options, "chatId")
        .or_else(|| (!workspace.is_empty()).then(|| workspace.clone()))
        .unwrap_or_else(|| "default".to_owned());
    let chat_folder = flag(options, "chatFolder");
    let real = workspace_root(&app, &workspace).await;
    let from_chat = real.is_none() && chat_folder;
    let root = match real {
        Some(root) => root,
        None if from_chat => match chat_dir(&app, &chat_id) {
            Ok(dir) => dir,
            Err(error) => return Ok(refused(&error)),
        },
        None => {
            return Ok(refused(
                "Commands run inside a project, and this conversation has none.",
            ));
        }
    };

    if flag(options, "elevated") && !from_chat {
        let timeout = option(options, "timeoutMs").and_then(Value::as_f64);
        let result = elevate::run_elevated(&command, &root, timeout).await;
        if let Some(chunk) = result["output"].as_str().filter(|chunk| !chunk.is_empty()) {
            emit(
                &app,
                "commands:output",
                json!({ "runId": run_id, "chunk": chunk }),
            );
        }
        return Ok(result);
    }

    let outside = flag(options, "outsideSandbox");
    let sandboxed = if from_chat {
        !outside
    } else {
        flag(options, "sandbox") && !outside
    };
    let sandbox_options = sandboxed.then(|| sandbox::Options {
        project: root.clone(),
        data_dir: app.state::<AppState>().storage.data_dir().to_path_buf(),
        chat_key: chat_id.clone(),
        launcher: sandbox::launcher(resource_dir(&app).as_deref()),
        network: !from_chat && flag(options, "network"),
        writable: from_chat || option(options, "writable").and_then(Value::as_bool) != Some(false),
        extras: if from_chat {
            python_extras(&app).unwrap_or_default()
        } else {
            extras_from(options).unwrap_or_default()
        },
    });

    let shell = opt_text(options, "shell");
    let default_shell = opt_text(options, "defaultShell");
    if flag(options, "background") {
        let started = tasks_manager(&app).start(&StartOptions {
            chat_id: &chat_id,
            cwd: &root,
            command: &command,
            shell: shell.as_deref(),
            default_shell: default_shell.as_deref(),
            cols: 120,
            rows: 30,
            sandbox: sandbox_options.as_ref(),
        });
        return Ok(match started {
            Ok(started) => {
                let mut body = json!({
                    "success": true,
                    "background": true,
                    "taskId": started.task.get("id").cloned().unwrap_or(Value::Null),
                    "shell": started.task.get("shell").cloned().unwrap_or(Value::Null),
                    "task": started.task,
                });
                if let Some(notice) = started.notice {
                    body["notice"] = json!(notice);
                }
                body
            }
            Err(error) => refused(&error),
        });
    }

    let output_app = app.clone();
    let output_run = run_id.clone();
    let request = Request {
        run_id: (!run_id.is_empty()).then(|| run_id.clone()),
        root,
        command,
        shell,
        default_shell,
        timeout: option(options, "timeoutMs").and_then(Value::as_f64),
        chat_id,
        auto_detach: option(options, "autoDetach").and_then(Value::as_bool) != Some(false),
        sandbox: sandbox_options,
        on_output: Arc::new(move |chunk: &str| {
            emit(
                &output_app,
                "commands:output",
                json!({ "runId": output_run, "chunk": chunk }),
            );
        }),
    };
    Ok(commands::run(tasks_manager(&app), request).await)
}

async fn commands_detach(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    Ok(commands::detach(&text(args.first())))
}

async fn commands_reset_state(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    Ok(json!({ "success": commands::reset_state(&text(args.first())) }))
}

async fn commands_cancel(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    Ok(json!({ "success": commands::cancel(&text(args.first())) }))
}

fn opt_text(options: Option<&Value>, name: &str) -> Option<String> {
    option(options, name)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn flag(options: Option<&Value>, name: &str) -> bool {
    option(options, name).and_then(Value::as_bool) == Some(true)
}

fn resource_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().resource_dir().ok()
}

/// The chat's own folder under the app data, made on first use.
fn chat_dir(app: &AppHandle, chat_id: &str) -> Result<PathBuf, String> {
    let dir = app
        .state::<AppState>()
        .storage
        .chat_dir(chat_id)
        .ok_or_else(|| "That chat has no folder.".to_owned())?;
    fs::create_dir_all(&dir).map_err(|_| "The chat folder could not be created.".to_owned())?;
    Ok(dir)
}

/// The bundled Python on a chat command's PATH, with PYTHONHOME keeping it off any Python on the machine.
fn python_extras(app: &AppHandle) -> Option<Extras> {
    let mut candidates: Vec<PathBuf> = resource_dir(app)
        .map(|dir| dir.join("python"))
        .into_iter()
        .collect();
    if cfg!(debug_assertions) {
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("vendor")
                .join("python"),
        );
    }
    let python = candidates
        .into_iter()
        .find(|dir| dir.join("python.exe").exists())?;
    Some(Extras {
        read_only: vec![python.clone()],
        path: vec![python.clone()],
        env: vec![
            ("PYTHONHOME".to_owned(), python.display().to_string()),
            ("PYTHONNOUSERSITE".to_owned(), "1".to_owned()),
        ],
    })
}

/// Extra folders and environment the renderer asks for.
fn extras_from(options: Option<&Value>) -> Option<Extras> {
    let extras = option(options, "extras")?;
    let folders = |name: &str| -> Vec<PathBuf> {
        extras
            .get(name)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(PathBuf::from)
            .collect()
    };
    let env = extras
        .get("env")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(key, value)| Some((key.clone(), value.as_str()?.to_owned())))
        .collect();
    Some(Extras {
        read_only: folders("readOnly"),
        path: folders("path"),
        env,
    })
}
