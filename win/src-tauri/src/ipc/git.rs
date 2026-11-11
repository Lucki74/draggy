//! Handlers for the git channels. Read calls take a workspace or chat folder; stage, unstage, commit and
//! switch branch write to it. Failures come back as `{ success: false, error }`, as the Electron wrapper gives.

mod ops;

use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use draggy_tools::fs_guard::{Guard, ResolveOptions};
use draggy_tools::git::{MAX_DIFF_FILES, SpawnRunner, to_pathspec};
use rusqlite::{Connection, OpenFlags};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use super::{IpcError, Registry};
use crate::{AppState, paths};
use ops::{DiffOptions, Git};

static GIT: LazyLock<Git<SpawnRunner>> = LazyLock::new(|| Git::new(SpawnRunner));

pub fn register_all(registry: &mut Registry) {
    register!(registry, "git:status" => status);
    register!(registry, "git:diff" => diff);
    register!(registry, "git:log" => log);
    register!(registry, "git:show" => show);
    register!(registry, "git:branches" => branches);
    register!(registry, "git:stage" => stage);
    register!(registry, "git:unstage" => unstage);
    register!(registry, "git:commit" => commit);
    register!(registry, "git:checkout" => checkout);
}

const NO_FOLDER: &str = "This conversation has no project folder.";

async fn status(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let diag = app.state::<AppState>().diag.clone();
    let Some(root) = folder(text_of(args.first())).await else {
        return Ok(json!({ "success": true, "available": false, "isRepo": false }));
    };
    Ok(GIT.status(&diag, &root).await)
}

/// Args: workspace, target, staged, untracked, ignoreWhitespace.
async fn diff(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let diag = app.state::<AppState>().diag.clone();
    let Some(root) = folder(text_of(args.first())).await else {
        return Ok(no_folder());
    };
    let relative = match pathspec(&root, args.get(1)) {
        Ok(relative) => relative,
        Err(error) => return Ok(fail(error)),
    };
    let opts = DiffOptions {
        relative: &relative,
        staged: truthy(args.get(2)),
        untracked: truthy(args.get(3)),
        ignore_whitespace: truthy(args.get(4)),
    };
    let guard = guard();
    let allow = |absolute: &Path| guard.is_readable(absolute);
    Ok(GIT.diff(&diag, &root, &opts, &allow).await)
}

async fn log(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let diag = app.state::<AppState>().diag.clone();
    let Some(root) = folder(text_of(args.first())).await else {
        return Ok(no_folder());
    };
    Ok(GIT
        .log(&diag, &root, js_number(args.get(1)), truthy(args.get(2)))
        .await)
}

/// Args: workspace, hash, ignoreWhitespace.
async fn show(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let diag = app.state::<AppState>().diag.clone();
    let Some(root) = folder(text_of(args.first())).await else {
        return Ok(no_folder());
    };
    let guard = guard();
    let allow = |absolute: &Path| guard.is_readable(absolute);
    let hash = nullish_text(args.get(1));
    Ok(GIT
        .show(&diag, &root, &hash, truthy(args.get(2)), &allow)
        .await)
}

async fn branches(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let diag = app.state::<AppState>().diag.clone();
    let Some(root) = folder(text_of(args.first())).await else {
        return Ok(no_folder());
    };
    Ok(GIT.branches(&diag, &root).await)
}

/// Args: workspace, targets (a list of paths, or one).
async fn stage(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let diag = app.state::<AppState>().diag.clone();
    let Some(root) = folder(text_of(args.first())).await else {
        return Ok(no_folder());
    };
    let paths = match relative_paths(&root, args.get(1)) {
        Ok(paths) => paths,
        Err(error) => return Ok(fail(error)),
    };
    Ok(GIT.stage(&diag, &root, &paths).await)
}

async fn unstage(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let diag = app.state::<AppState>().diag.clone();
    let Some(root) = folder(text_of(args.first())).await else {
        return Ok(no_folder());
    };
    let paths = match relative_paths(&root, args.get(1)) {
        Ok(paths) => paths,
        Err(error) => return Ok(fail(error)),
    };
    Ok(GIT.unstage(&diag, &root, &paths).await)
}

async fn commit(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let diag = app.state::<AppState>().diag.clone();
    let Some(root) = folder(text_of(args.first())).await else {
        return Ok(no_folder());
    };
    Ok(GIT.commit(&diag, &root, &nullish_text(args.get(1))).await)
}

async fn checkout(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let diag = app.state::<AppState>().diag.clone();
    let Some(root) = folder(text_of(args.first())).await else {
        return Ok(no_folder());
    };
    Ok(GIT.checkout(&diag, &root, &nullish_text(args.get(1))).await)
}

fn fail(error: impl Into<String>) -> Value {
    json!({ "success": false, "error": error.into() })
}

fn no_folder() -> Value {
    fail(NO_FOLDER)
}

/// Draggy's data folder, the same one the rest of the app opens. None when APPDATA is missing.
fn data_dir() -> Option<PathBuf> {
    paths::data_dir(std::env::var_os("APPDATA")).ok()
}

/// The guard that keeps Draggy's own storage out of reach, as the Electron build sets it.
fn guard() -> Guard {
    Guard::new(data_dir())
}

/// The folder a workspace id or `chat:<id>` names. The database read and any folder creation run off the
/// runtime. None when there is no folder.
async fn folder(id: String) -> Option<PathBuf> {
    let data_dir = data_dir()?;
    tauri::async_runtime::spawn_blocking(move || root_for(&data_dir, &id))
        .await
        .ok()
        .flatten()
}

fn root_for(data_dir: &Path, id: &str) -> Option<PathBuf> {
    // A chat with no project keeps its folder under the data folder, made on first use.
    if let Some(chat) = id.strip_prefix("chat:") {
        if !is_chat_id(chat) {
            return None;
        }
        let dir = data_dir.join("chats").join(chat);
        return std::fs::create_dir_all(&dir).ok().map(|()| dir);
    }
    let conn = Connection::open_with_flags(
        data_dir.join("draggy.db"),
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    conn.query_row(
        "SELECT root_path FROM workspaces WHERE id = ?1",
        [id],
        |row| row.get::<_, Option<String>>(0),
    )
    .ok()
    .flatten()
    .filter(|root| !root.is_empty())
    .map(PathBuf::from)
}

fn is_chat_id(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= 128
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// A path the renderer named, as git should see it inside the project. The same guard as reading the file,
/// which also keeps a credentials file out of a diff or a commit asked for by name.
fn pathspec(root: &Path, target: Option<&Value>) -> Result<String, String> {
    let text = text_of(target);
    if text.trim().is_empty() || text.trim() == "." {
        return Ok(".".to_owned());
    }
    let resolved = guard()
        .resolve_within(&[root.to_path_buf()], &text, ResolveOptions::default())
        .map_err(|refusal| refusal.0)?;
    to_pathspec(&real_path(root), &resolved)
        .ok_or_else(|| "That path is outside the project.".to_owned())
}

/// Each target as a pathspec, at most `MAX_DIFF_FILES` of them. A single target counts as a list of one.
fn relative_paths(root: &Path, targets: Option<&Value>) -> Result<Vec<String>, String> {
    let list: Vec<Option<&Value>> = match targets {
        Some(Value::Array(items)) => items.iter().map(Some).collect(),
        other => vec![other],
    };
    list.into_iter()
        .take(MAX_DIFF_FILES)
        .map(|target| pathspec(root, target))
        .collect()
}

/// The folder with its links resolved, without Windows' verbatim prefix, so it compares with the paths the
/// guard builds from the folder it was given.
fn real_path(root: &Path) -> PathBuf {
    let Ok(canonical) = std::fs::canonicalize(root) else {
        return root.to_path_buf();
    };
    match canonical.to_string_lossy().strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with(r"UNC\") => PathBuf::from(rest),
        _ => canonical,
    }
}

/// `String(value || "")`: the text of a truthy argument, empty otherwise.
fn text_of(value: Option<&Value>) -> String {
    if truthy(value) {
        nullish_text(value)
    } else {
        String::new()
    }
}

/// `String(value ?? "")`: the text of an argument, empty only when it is missing or null.
fn nullish_text(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(text)) => text.clone(),
        Some(Value::Bool(flag)) => flag.to_string(),
        Some(Value::Number(number)) => number.to_string(),
        Some(other) => other.to_string(),
    }
}

/// JavaScript truthiness of an argument.
fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(flag)) => *flag,
        Some(Value::Number(number)) => number.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Some(Value::String(text)) => !text.is_empty(),
        Some(_) => true,
    }
}

/// `Number(value)` for a log limit. None stands for NaN, which the log call reads as "use the default".
fn js_number(value: Option<&Value>) -> Option<f64> {
    match value {
        None => None,
        Some(Value::Null) => Some(0.0),
        Some(Value::Bool(flag)) => Some(f64::from(u8::from(*flag))),
        Some(Value::Number(number)) => number.as_f64(),
        Some(Value::String(text)) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                Some(0.0)
            } else {
                trimmed.parse().ok()
            }
        }
        Some(_) => None,
    }
}
