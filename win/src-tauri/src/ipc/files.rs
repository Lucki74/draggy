//! Handlers for the files channels: the project file tools (`fs:*`) and the folder of files the model made.
//! Blocking file work runs on the blocking pool; every answer keeps the Electron shape.

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use draggy_documents::office_files::write_generated_file;
use draggy_storage::{Checkpoint as StoredCheckpoint, CheckpointInput, Storage};
use draggy_tools::files::{
    Action, Checkpoint, CheckpointStore, ContentKind, FileOps, NewCheckpoint, Query, Recycler,
    StoreError, content_hash,
};
use draggy_tools::fs_guard::{self, Guard, MAX_READ_BYTES, ResolveOptions};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use super::{IpcError, Registry};
use crate::AppState;

/// Electron's executable list (documents.cjs). Anything here opens in the file manager, never runs.
const EXECUTABLE_EXTENSIONS: &[&str] = &[
    ".exe",
    ".msi",
    ".msix",
    ".appx",
    ".com",
    ".scr",
    ".pif",
    ".cpl",
    ".dll",
    ".bat",
    ".cmd",
    ".ps1",
    ".psm1",
    ".psd1",
    ".vbs",
    ".vbe",
    ".js",
    ".jse",
    ".wsf",
    ".wsh",
    ".hta",
    ".lnk",
    ".url",
    ".scf",
    ".reg",
    ".inf",
    ".jar",
    ".app",
    ".dmg",
    ".pkg",
    ".command",
    ".desktop",
    ".run",
    ".appimage",
    ".gadget",
    ".msc",
    ".sh",
    ".bash",
    ".zsh",
];

/// The most a preview of a created file shows.
const PREVIEW_LIMIT: usize = 200 * 1024;
/// The most a Word file is handed over whole, as base64.
const MAX_DOCX_BYTES: u64 = 20 * 1024 * 1024;

type Roots = Box<dyn Fn(&str) -> Vec<PathBuf> + Send + Sync>;

/// Everything the file channels share, built once on first use.
pub struct Services {
    ops: FileOps<Checkpoints, TrashBin, Roots>,
    guard: Guard,
    store: Checkpoints,
    storage: Arc<Mutex<Storage>>,
    chats: PathBuf,
    data: PathBuf,
}

static SERVICES: OnceLock<Result<Arc<Services>, String>> = OnceLock::new();

fn services() -> Result<Arc<Services>, String> {
    SERVICES
        .get_or_init(|| {
            let data = crate::paths::data_dir(std::env::var_os("APPDATA"))?;
            build(data).map(Arc::new)
        })
        .clone()
}

fn build(data: PathBuf) -> Result<Services, String> {
    let storage = Arc::new(Mutex::new(Storage::open(&data).map_err(|e| e.to_string())?));
    let chats = data.join("chats");
    let store = Checkpoints {
        storage: Arc::clone(&storage),
        blobs: data.join("checkpoints"),
    };
    let roots_storage = Arc::clone(&storage);
    let roots_chats = chats.clone();
    let roots: Roots =
        Box::new(move |workspace| folders_for(&roots_storage, &roots_chats, workspace));
    Ok(Services {
        ops: FileOps::new(Guard::new([data.clone()]), store.clone(), TrashBin, roots),
        guard: Guard::new([data.clone()]),
        store,
        storage,
        chats,
        data,
    })
}

impl Services {
    fn folders(&self, workspace: &str) -> Vec<PathBuf> {
        folders_for(&self.storage, &self.chats, workspace)
    }
}

/// The folders a conversation may reach: a `chat:` folder, or its workspace's root. Nothing else.
fn folders_for(storage: &Mutex<Storage>, chats: &Path, workspace: &str) -> Vec<PathBuf> {
    if let Some(chat) = workspace.strip_prefix("chat:") {
        let Some(dir) = chat_dir(chats, chat) else {
            return Vec::new();
        };
        return if fs::create_dir_all(&dir).is_ok() {
            vec![dir]
        } else {
            Vec::new()
        };
    }
    match lock(storage).get_workspace(workspace) {
        Ok(Some(found)) => found
            .root_path
            .filter(|root| !root.is_empty())
            .map(|root| vec![PathBuf::from(root)])
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

/// A chat's folder: a plain id only, as the Electron build's `chatDirPath` allows.
fn chat_dir(chats: &Path, id: &str) -> Option<PathBuf> {
    let valid = (1..=128).contains(&id.len())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    valid.then(|| chats.join(id))
}

fn lock(value: &Mutex<Storage>) -> MutexGuard<'_, Storage> {
    value.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Checkpoint rows live in storage; the bytes they name live beside them, as in Electron's `checkpoints.cjs`.
#[derive(Clone)]
pub struct Checkpoints {
    storage: Arc<Mutex<Storage>>,
    blobs: PathBuf,
}

impl Checkpoints {
    fn blob(&self, hash: &str) -> PathBuf {
        self.blobs.join(hash.get(..2).unwrap_or(hash)).join(hash)
    }
}

impl CheckpointStore for Checkpoints {
    fn keep(&self, bytes: &[u8]) -> Result<String, StoreError> {
        let hash = content_hash(bytes);
        let target = self.blob(&hash);
        if !target.exists() {
            let parent = target
                .parent()
                .ok_or_else(|| StoreError("no blob folder".to_owned()))?;
            fs::create_dir_all(parent).map_err(store_io)?;
            // Written beside the blob and renamed in, so a crash never leaves half a blob under its name.
            let staging = parent.join(format!("{hash}.tmp"));
            fs::write(&staging, bytes).map_err(store_io)?;
            fs::rename(&staging, &target).map_err(store_io)?;
        }
        Ok(hash)
    }

    fn read(&self, hash: &str) -> Option<Vec<u8>> {
        if !is_hash(hash) {
            return None;
        }
        let bytes = fs::read(self.blob(hash)).ok()?;
        // A damaged blob is never written back over a user's file.
        (content_hash(&bytes) == hash).then_some(bytes)
    }

    fn add(&self, entry: &NewCheckpoint) -> Result<i64, StoreError> {
        let input = CheckpointInput {
            workspace_id: Some(entry.workspace_id.clone()),
            chat_id: entry.chat_id.clone(),
            path: entry.path.to_string_lossy().into_owned(),
            action: Some(action_name(entry.action).to_owned()),
            detail: entry.detail.clone(),
            before_hash: entry.before_hash.clone(),
            after_hash: entry.after_hash.clone(),
            created_at: now_ms(),
        };
        lock(&self.storage).add_checkpoint(&input).map_err(store_db)
    }

    fn get(&self, id: i64) -> Result<Option<Checkpoint>, StoreError> {
        let row = lock(&self.storage).get_checkpoint(id).map_err(store_db)?;
        Ok(row.map(from_row))
    }

    fn drop_checkpoint(&self, id: i64) -> Result<(), StoreError> {
        lock(&self.storage).drop_checkpoint(id).map_err(store_db)
    }
}

fn from_row(row: StoredCheckpoint) -> Checkpoint {
    Checkpoint {
        id: row.id,
        entry: NewCheckpoint {
            workspace_id: row.workspace_id,
            chat_id: row.chat_id,
            path: PathBuf::from(row.path),
            action: match row.action.as_str() {
                "move" => Action::Move,
                "delete" => Action::Delete,
                _ => Action::Write,
            },
            detail: row.detail,
            before_hash: row.before_hash,
            after_hash: row.after_hash,
        },
    }
}

fn action_name(action: Action) -> &'static str {
    match action {
        Action::Write => "write",
        Action::Move => "move",
        Action::Delete => "delete",
    }
}

fn is_hash(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |d| d.as_millis() as f64)
}

fn store_io(error: io::Error) -> StoreError {
    StoreError(error.to_string())
}

fn store_db(error: draggy_storage::StorageError) -> StoreError {
    StoreError(error.to_string())
}

/// Undo and delete go to the Recycle Bin, not gone, so a mistake stays recoverable.
pub struct TrashBin;

impl Recycler for TrashBin {
    fn recycle(&self, path: &Path) -> io::Result<()> {
        trash::delete(path).map_err(io::Error::other)
    }
}

pub fn register_all(registry: &mut Registry) {
    register!(registry, "fs:list" => fs_list);
    register!(registry, "fs:read" => fs_read);
    register!(registry, "fs:open" => fs_open);
    register!(registry, "fs:reveal" => fs_reveal);
    register!(registry, "fs:write" => fs_write);
    register!(registry, "fs:edit" => fs_edit);
    register!(registry, "fs:move" => fs_move);
    register!(registry, "fs:delete" => fs_delete);
    register!(registry, "fs:search" => fs_search);
    register!(registry, "create-file" => create_file_channel);
    register!(registry, "read-created-file" => read_created_file);
    register!(registry, "list-created-files" => list_created_files);
    register!(registry, "open-created-files" => open_created_files);
    register!(registry, "reveal-created-file" => reveal_created_file);
    register!(registry, "delete-created-file" => delete_created_file);
}

/// Runs blocking file work off the async runtime. Failures of the work itself are answers, not IPC errors.
async fn run<F>(app: &AppHandle, op: &'static str, work: F) -> Result<Value, IpcError>
where
    F: FnOnce(&Services) -> Value + Send + 'static,
{
    let answer = tauri::async_runtime::spawn_blocking(move || match services() {
        Ok(services) => work(services.as_ref()),
        Err(error) => fail(error),
    })
    .await
    .map_err(|error| IpcError::Failed(error.to_string()))?;
    log_outcome(app, op, &answer);
    Ok(answer)
}

fn fail(error: String) -> Value {
    json!({ "success": false, "error": error })
}

fn answer(result: Result<Value, String>) -> Value {
    result.unwrap_or_else(fail)
}

/// One line per operation: the op and its outcome. Paths and text are never logged.
fn log_outcome(app: &AppHandle, op: &str, outcome: &Value) {
    let diag = &app.state::<AppState>().diag;
    if outcome.get("success") == Some(&Value::Bool(false)) {
        diag.warn(
            "files",
            "file op refused",
            Some(json!({ "op": op, "outcome": "refused" })),
        );
    } else {
        diag.info(
            "files",
            "file op done",
            Some(json!({ "op": op, "outcome": "ok" })),
        );
    }
}

/// Tells the canvas a file changed, as the Electron `announceChange` does.
fn announce(app: &AppHandle, workspace: &str, outcome: &Value) {
    if outcome.get("success") != Some(&Value::Bool(true)) {
        return;
    }
    let Some(path) = outcome.get("path").and_then(Value::as_str) else {
        return;
    };
    let mut payload = json!({ "workspaceId": workspace, "path": path });
    if let Some(from) = outcome.get("from").and_then(Value::as_str) {
        payload["from"] = json!(from);
    }
    crate::ipc::emit(app, "file-changed", payload);
}

/// The renderer's `String(value || "")`: falsy becomes empty, anything else is its text.
fn arg_text(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) | Some(Value::Bool(false)) => String::new(),
        Some(Value::String(text)) => text.clone(),
        Some(other) => other.to_string(),
    }
}

fn opt_text(value: Option<&Value>) -> Option<String> {
    Some(arg_text(value)).filter(|text| !text.is_empty())
}

/// Electron's `Number(value) || 1` for an edit count, with 0 meaning one.
fn count_arg(value: Option<&Value>) -> i64 {
    let number = match value {
        Some(Value::Number(n)) => n.as_f64(),
        Some(Value::String(s)) => s.trim().parse::<f64>().ok(),
        Some(Value::Bool(true)) => Some(1.0),
        _ => None,
    };
    match number.map(|n| n as i64) {
        Some(0) | None => 1,
        Some(n) => n,
    }
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn is_executable(name: &str) -> bool {
    Path::new(name)
        .extension()
        .map(|ext| format!(".{}", ext.to_string_lossy().to_lowercase()))
        .is_some_and(|ext| EXECUTABLE_EXTENSIONS.contains(&ext.as_str()))
}

async fn fs_list(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let workspace = arg_text(args.first());
    let target = arg_text(args.get(1));
    run(&app, "list", move |s| {
        answer(list_now(s, &workspace, &target))
    })
    .await
}

fn list_now(s: &Services, workspace: &str, target: &str) -> Result<Value, String> {
    let listing = s.ops.list(workspace, target).map_err(|e| e.to_string())?;
    let entries: Vec<Value> = listing
        .entries
        .iter()
        .map(|e| {
            json!({
                "name": e.name,
                "path": path_text(&e.path),
                "isDirectory": e.is_directory,
                "size": e.size,
                "modified": e.modified_ms,
            })
        })
        .collect();
    Ok(json!({
        "success": true,
        "path": path_text(&listing.path),
        "entries": entries,
        "truncated": listing.truncated,
    }))
}

async fn fs_read(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let workspace = arg_text(args.first());
    let target = arg_text(args.get(1));
    run(&app, "read", move |s| {
        answer(read_now(s, &workspace, &target))
    })
    .await
}

fn read_now(s: &Services, workspace: &str, target: &str) -> Result<Value, String> {
    let opened = s.ops.read(workspace, target).map_err(|e| e.to_string())?;
    let path = path_text(&opened.path);
    Ok(match opened.kind {
        ContentKind::Text => json!({
            "success": true,
            "path": path,
            "text": opened.text,
            "bytes": opened.bytes,
        }),
        kind => json!({
            "success": true,
            "path": path,
            "isImage": kind == ContentKind::Image,
            "isMedia": kind == ContentKind::Media,
            "mime": opened.mime,
            "dataUrl": opened.data_url,
            "text": opened.text,
            "bytes": opened.bytes,
        }),
    })
}

async fn fs_open(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let workspace = arg_text(args.first());
    let target = arg_text(args.get(1));
    let opener_app = app.clone();
    run(&app, "open", move |s| {
        answer(open_now(&opener_app, s, &workspace, &target))
    })
    .await
}

/// A script or an installer is shown in its folder, so a click never runs it.
fn open_now(app: &AppHandle, s: &Services, workspace: &str, target: &str) -> Result<Value, String> {
    let found = s.ops.locate(workspace, target).map_err(|e| e.to_string())?;
    if is_executable(&path_text(&found)) {
        app.opener()
            .reveal_item_in_dir(&found)
            .map_err(|e| e.to_string())?;
        return Ok(json!({ "success": true, "revealed": true }));
    }
    app.opener()
        .open_path(path_text(&found), None::<&str>)
        .map_err(|e| e.to_string())?;
    Ok(json!({ "success": true }))
}

async fn fs_reveal(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let workspace = arg_text(args.first());
    let target = arg_text(args.get(1));
    let opener_app = app.clone();
    run(&app, "reveal", move |s| {
        answer(reveal_now(&opener_app, s, &workspace, &target))
    })
    .await
}

fn reveal_now(
    app: &AppHandle,
    s: &Services,
    workspace: &str,
    target: &str,
) -> Result<Value, String> {
    let found = s.ops.locate(workspace, target).map_err(|e| e.to_string())?;
    app.opener()
        .reveal_item_in_dir(&found)
        .map_err(|e| e.to_string())?;
    Ok(json!({ "success": true }))
}

async fn fs_write(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let workspace = arg_text(args.first());
    let target = arg_text(args.get(1));
    let contents = arg_text(args.get(2));
    let chat = opt_text(args.get(3));
    let for_event = workspace.clone();
    let outcome = run(&app, "write", move |s| {
        answer(
            s.ops
                .write(&workspace, &target, &contents, chat.as_deref())
                .map(|w| {
                    json!({
                        "success": true,
                        "path": path_text(&w.path),
                        "checkpointId": w.checkpoint_id,
                        "created": w.created,
                        "bytes": w.bytes,
                    })
                })
                .map_err(|e| e.to_string()),
        )
    })
    .await?;
    announce(&app, &for_event, &outcome);
    Ok(outcome)
}

async fn fs_edit(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let workspace = arg_text(args.first());
    let target = arg_text(args.get(1));
    let find = arg_text(args.get(2));
    let replace = arg_text(args.get(3));
    let expected = count_arg(args.get(4));
    let chat = opt_text(args.get(5));
    let for_event = workspace.clone();
    let outcome = run(&app, "edit", move |s| {
        answer(edit_now(
            s,
            &workspace,
            &target,
            &find,
            &replace,
            expected,
            chat.as_deref(),
        ))
    })
    .await?;
    announce(&app, &for_event, &outcome);
    Ok(outcome)
}

/// Replaces text, tolerating CRLF files and whitespace at line ends, as Electron's `fileOps.edit` does.
fn edit_now(
    s: &Services,
    workspace: &str,
    target: &str,
    find: &str,
    replace: &str,
    wanted: i64,
    chat: Option<&str>,
) -> Result<Value, String> {
    let folders = s.folders(workspace);
    let path = s
        .guard
        .resolve_within(
            &folders,
            target,
            ResolveOptions {
                must_exist: true,
                create_parents: false,
            },
        )
        .map_err(|r| r.0)?;
    let current = fs_guard::read_text(&path, MAX_READ_BYTES).map_err(|e| e.to_string())?;
    if find.is_empty() {
        return Err("Nothing was given to replace.".to_owned());
    }
    let found = match_edit(&current.text, find, replace, wanted);
    let Some(next) = found.next else {
        return Err(miss_message(found.occurrences, wanted));
    };
    let before = s.store.keep(current.text.as_bytes()).map_err(store_text)?;
    fs::write(&path, next.as_bytes()).map_err(|e| format!("could not change the file: {e}"))?;
    let after = s.store.keep(next.as_bytes()).map_err(store_text)?;
    let id = s
        .store
        .add(&NewCheckpoint {
            workspace_id: workspace.to_owned(),
            chat_id: chat.map(str::to_owned),
            path: path.clone(),
            action: Action::Write,
            detail: None,
            before_hash: Some(before),
            after_hash: Some(after),
        })
        .map_err(store_text)?;
    Ok(json!({
        "success": true,
        "path": path_text(&path),
        "checkpointId": id,
        "replaced": found.occurrences,
        "before": current.text,
        "after": next,
        "bytes": next.len(),
    }))
}

fn store_text(error: StoreError) -> String {
    error.0
}

fn miss_message(occurrences: usize, wanted: i64) -> String {
    if occurrences == 0 {
        return "That text is not in the file. Read it again and copy the lines exactly, whitespace included."
            .to_owned();
    }
    format!(
        "That text appears {occurrences} times, not {wanted}. Include more of the surrounding lines so it matches once, or say how many to replace."
    )
}

/// What an edit found: the new text when exactly the wanted places matched, and how many matched.
struct Found {
    next: Option<String>,
    occurrences: usize,
}

fn match_edit(text: &str, find: &str, replace: &str, wanted: i64) -> Found {
    let exact = text.matches(find).count();
    if exact as i64 == wanted {
        return Found {
            next: Some(text.replace(find, replace)),
            occurrences: exact,
        };
    }
    if exact != 0 {
        return Found {
            next: None,
            occurrences: exact,
        };
    }

    // Line endings first, then whitespace at line ends, then the whole line.
    let crlf = text.contains("\r\n");
    let lf_text = text.replace("\r\n", "\n");
    let lf_find = find.replace("\r\n", "\n");
    let lf_replace = replace.replace("\r\n", "\n");
    let loose = lf_text.matches(lf_find.as_str()).count();
    if loose as i64 == wanted {
        return Found {
            next: Some(restore_crlf(lf_text.replace(&lf_find, &lf_replace), crlf)),
            occurrences: loose,
        };
    }
    if loose != 0 {
        return Found {
            next: None,
            occurrences: loose,
        };
    }

    let file_lines: Vec<&str> = lf_text.split('\n').collect();
    // A trailing newline in the find or replace text ends its last line, not a new empty one.
    let needle_lines: Vec<&str> = lf_find
        .strip_suffix('\n')
        .unwrap_or(&lf_find)
        .split('\n')
        .collect();
    let mut hits = line_hits(&file_lines, &needle_lines, str::trim_end);
    if hits.is_empty() && needle_lines.iter().any(|line| !line.trim().is_empty()) {
        hits = line_hits(&file_lines, &needle_lines, str::trim);
    }
    if hits.len() as i64 != wanted {
        return Found {
            next: None,
            occurrences: hits.len(),
        };
    }

    let replacement: Vec<&str> = lf_replace
        .strip_suffix('\n')
        .unwrap_or(&lf_replace)
        .split('\n')
        .collect();
    let mut out: Vec<&str> = Vec::with_capacity(file_lines.len());
    let mut hit_starts = hits.iter().peekable();
    let mut i = 0;
    while i < file_lines.len() {
        if hit_starts.peek() == Some(&&i) {
            out.extend(replacement.iter().copied());
            i += needle_lines.len();
            hit_starts.next();
        } else {
            out.push(file_lines[i]);
            i += 1;
        }
    }
    Found {
        next: Some(restore_crlf(out.join("\n"), crlf)),
        occurrences: hits.len(),
    }
}

/// Start indexes of every run of file lines that equals the needle lines under `norm`.
fn line_hits(file: &[&str], needle: &[&str], norm: fn(&str) -> &str) -> Vec<usize> {
    if needle.is_empty() || file.len() < needle.len() {
        return Vec::new();
    }
    (0..=file.len() - needle.len())
        .filter(|&i| {
            needle
                .iter()
                .enumerate()
                .all(|(j, line)| norm(file[i + j]) == norm(line))
        })
        .collect()
}

fn restore_crlf(text: String, crlf: bool) -> String {
    if crlf {
        text.replace('\n', "\r\n")
    } else {
        text
    }
}

async fn fs_move(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let workspace = arg_text(args.first());
    let from = arg_text(args.get(1));
    let to = arg_text(args.get(2));
    let chat = opt_text(args.get(3));
    let for_event = workspace.clone();
    let outcome = run(&app, "move", move |s| {
        answer(
            s.ops
                .move_path(&workspace, &from, &to, chat.as_deref())
                .map(|m| {
                    json!({
                        "success": true,
                        "path": path_text(&m.path),
                        "from": path_text(&m.from),
                        "checkpointId": m.checkpoint_id,
                    })
                })
                .map_err(|e| e.to_string()),
        )
    })
    .await?;
    announce(&app, &for_event, &outcome);
    Ok(outcome)
}

async fn fs_delete(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let workspace = arg_text(args.first());
    let target = arg_text(args.get(1));
    let chat = opt_text(args.get(2));
    let for_event = workspace.clone();
    let outcome = run(&app, "delete", move |s| {
        answer(
            s.ops
                .remove(&workspace, &target, chat.as_deref())
                .map(|r| {
                    json!({
                        "success": true,
                        "path": path_text(&r.path),
                        "checkpointId": r.checkpoint_id,
                    })
                })
                .map_err(|e| e.to_string()),
        )
    })
    .await?;
    announce(&app, &for_event, &outcome);
    Ok(outcome)
}

async fn fs_search(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let workspace = arg_text(args.first());
    let spec = args.get(1);
    let query = Query {
        name: arg_text(spec.and_then(|q| q.get("name"))),
        text: arg_text(spec.and_then(|q| q.get("text"))),
        limit: spec.and_then(|q| q.get("limit")).and_then(Value::as_f64),
    };
    run(&app, "search", move |s| {
        answer(
            s.ops
                .search(&workspace, &query)
                .map(|found| {
                    let hits: Vec<Value> = found
                        .hits
                        .iter()
                        .map(|hit| {
                            let mut item =
                                json!({ "path": path_text(&hit.path), "name": hit.name });
                            if let Some(line) = hit.line {
                                item["line"] = json!(line);
                            }
                            if let Some(text) = &hit.text {
                                item["text"] = json!(text);
                            }
                            item
                        })
                        .collect();
                    json!({ "success": true, "hits": hits, "truncated": found.truncated })
                })
                .map_err(|e| e.to_string()),
        )
    })
    .await
}

pub(crate) fn created_dir(data: &Path) -> PathBuf {
    data.join("created_files")
}

/// The path a created-files channel may touch: lexically resolved and strictly below the folder. None when refused.
pub(crate) fn created_file_path(data: &Path, raw: &str) -> Option<PathBuf> {
    if raw.is_empty() {
        return None;
    }
    let dir = lexical(&absolute(&created_dir(data)));
    let resolved = lexical(&absolute(Path::new(raw)));
    is_inside(&dir, &resolved).then_some(resolved)
}

/// `path.resolve` for an absolute or cwd-relative path. An odd path resolves to something outside and is refused.
fn absolute(path: &Path) -> PathBuf {
    std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf())
}

/// Drops `.` and folds `..` lexically, as `path.resolve` does, so `folder\..\x` cannot escape.
fn lexical(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// True only for a path strictly below `dir`. Windows names are compared case-insensitively.
fn is_inside(dir: &Path, candidate: &Path) -> bool {
    let dir: Vec<Component> = dir.components().collect();
    let candidate: Vec<Component> = candidate.components().collect();
    candidate.len() > dir.len()
        && dir
            .iter()
            .zip(&candidate)
            .all(|(a, b)| a.as_os_str().eq_ignore_ascii_case(b.as_os_str()))
}

/// The last part of a name the way Node's `path.basename` gives it, for either slash.
fn base_name(text: &str) -> String {
    text.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .to_owned()
}

async fn create_file_channel(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let filename = arg_text(args.first());
    let content = arg_text(args.get(1));
    let chat = opt_text(args.get(2));
    run(&app, "create-file", move |s| {
        answer(create_file(s, &filename, &content, chat.as_deref()))
    })
    .await
}

/// Writes a file the model made into the chat's folder, or the shared created-files folder.
fn create_file(
    s: &Services,
    filename: &str,
    content: &str,
    chat: Option<&str>,
) -> Result<Value, String> {
    let safe = base_name(filename);
    if safe.is_empty() || safe == "." || safe == ".." {
        return Err("That file name is not usable.".to_owned());
    }
    if is_executable(&safe) {
        return Err(format!(
            "Refused to write {safe}: Draggy does not create executable or script files that Windows would run on a double-click. Use a .txt or .md extension instead."
        ));
    }
    let dir = match chat {
        Some(id) => chat_dir(&s.chats, id).ok_or_else(|| "That chat has no folder.".to_owned())?,
        None => created_dir(&s.data),
    };
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let filepath = dir.join(&safe);
    if Path::new(&safe)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
    {
        // TODO: core documents has a PDF reader only; no Rust PDF writer yet.
        return Err("PDF files cannot be created in this build yet.".to_owned());
    }
    write_generated_file(&filepath, content).map_err(|e| e.to_string())?;
    Ok(json!({ "success": true, "filepath": path_text(&filepath), "filename": safe }))
}

async fn read_created_file(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let raw = arg_text(args.first());
    run(
        &app,
        "read-created-file",
        move |s| match created_file_path(&s.data, &raw) {
            Some(path) => answer(preview(&path)),
            None => outside(),
        },
    )
    .await
}

fn outside() -> Value {
    fail("That file is outside the output folder.".to_owned())
}

/// The first part of a file as text, and the whole of a Word file so the renderer can draw it.
fn preview(path: &Path) -> Result<Value, String> {
    let size = fs::metadata(path).map_err(|e| e.to_string())?.len();
    let buffer = fs::read(path).map_err(|e| e.to_string())?;
    let shown = &buffer[..buffer.len().min(PREVIEW_LIMIT)];
    let is_word = path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("docx"));
    let mut out = json!({
        "success": true,
        "text": String::from_utf8_lossy(shown),
        "truncated": size > PREVIEW_LIMIT as u64,
        // A NUL byte in the first kilobyte means this is not text to show.
        "binary": buffer[..buffer.len().min(1024)].contains(&0),
    });
    if is_word && size <= MAX_DOCX_BYTES {
        out["data"] = json!(STANDARD.encode(&buffer));
    }
    Ok(out)
}

async fn list_created_files(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    run(&app, "list-created-files", |s| {
        answer(list_created(&s.data))
    })
    .await
}

/// The folder on disk is the record of what the model made: a file deleted outside the app stops being listed.
fn list_created(data: &Path) -> Result<Value, String> {
    let dir = created_dir(data);
    if !dir.exists() {
        return Ok(json!({ "success": true, "files": [] }));
    }
    let mut files: Vec<(f64, Value)> = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let Ok(entry) = entry else { continue };
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0.0, |d| d.as_millis() as f64);
        let extension = Path::new(&name)
            .extension()
            .map(|ext| ext.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        files.push((
            modified,
            json!({
                "name": name,
                "path": path_text(&entry.path()),
                "size": meta.len(),
                "modified": modified,
                "extension": extension,
            }),
        ));
    }
    files.sort_by(|a, b| b.0.total_cmp(&a.0));
    let files: Vec<Value> = files.into_iter().map(|(_, file)| file).collect();
    Ok(json!({ "success": true, "files": files }))
}

async fn open_created_files(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let opener_app = app.clone();
    run(&app, "open-created-files", move |s| {
        let dir = created_dir(&s.data);
        if let Err(error) = fs::create_dir_all(&dir) {
            return fail(error.to_string());
        }
        // Electron answers with the shell's error text, empty on success.
        let text = match opener_app.opener().open_path(path_text(&dir), None::<&str>) {
            Ok(()) => String::new(),
            Err(error) => error.to_string(),
        };
        Value::String(text)
    })
    .await
}

async fn reveal_created_file(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let raw = arg_text(args.first());
    let opener_app = app.clone();
    run(&app, "reveal-created-file", move |s| {
        let Some(path) = created_file_path(&s.data, &raw) else {
            return outside();
        };
        match opener_app.opener().reveal_item_in_dir(&path) {
            Ok(()) => json!({ "success": true }),
            Err(error) => fail(error.to_string()),
        }
    })
    .await
}

async fn delete_created_file(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let raw = arg_text(args.first());
    run(&app, "delete-created-file", move |s| {
        let Some(path) = created_file_path(&s.data, &raw) else {
            return outside();
        };
        // Into the recycle bin rather than gone, so a mis-click is recoverable.
        match TrashBin.recycle(&path) {
            Ok(()) => json!({ "success": true }),
            Err(error) => fail(error.to_string()),
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_paths_below_the_created_files_folder_open() {
        let data = PathBuf::from(r"C:\Users\x\AppData\Roaming\Draggy");
        let inside = r"C:\Users\x\AppData\Roaming\Draggy\created_files\a.txt";
        assert!(created_file_path(&data, inside).is_some());
        assert!(
            created_file_path(&data, r"C:\Users\x\AppData\Roaming\Draggy\created_files").is_none()
        );
        assert!(created_file_path(&data, r"C:\Users\x\Documents\a.txt").is_none());
        assert!(created_file_path(&data, "").is_none());
    }

    #[test]
    fn traversal_out_of_the_folder_is_refused() {
        let data = PathBuf::from(r"C:\data");
        assert!(created_file_path(&data, r"C:\data\created_files\..\secret.txt").is_none());
    }

    #[test]
    fn folder_match_ignores_case_on_windows() {
        let dir = PathBuf::from(r"C:\data\created_files");
        assert!(is_inside(&dir, Path::new(r"c:\data\created_files\a.txt")));
    }

    #[test]
    fn lexical_folds_parent_and_current_steps() {
        assert_eq!(
            lexical(Path::new(r"C:\a\.\b\..\c.txt")),
            PathBuf::from(r"C:\a\c.txt")
        );
    }

    #[test]
    fn base_name_takes_the_last_part_for_either_slash() {
        assert_eq!(base_name(r"a\b\c.txt"), "c.txt");
        assert_eq!(base_name("a/b/"), "b");
        assert_eq!(base_name(""), "");
    }

    #[test]
    fn scripts_are_refused_by_extension() {
        assert!(is_executable("run.PS1"));
        assert!(is_executable("tool.exe"));
        assert!(!is_executable("notes.md"));
    }

    #[test]
    fn chat_folders_need_a_plain_id() {
        let chats = Path::new(r"C:\data\chats");
        assert!(chat_dir(chats, "abc_123-X").is_some());
        assert!(chat_dir(chats, "../x").is_none());
        assert!(chat_dir(chats, "").is_none());
    }

    #[test]
    fn exact_edit_replaces_one_match() {
        let found = match_edit("a b c", "b", "x", 1);
        assert_eq!(found.next.as_deref(), Some("a x c"));
        assert_eq!(found.occurrences, 1);
    }

    #[test]
    fn edit_counts_must_match() {
        let found = match_edit("a a", "a", "x", 1);
        assert!(found.next.is_none());
        assert_eq!(found.occurrences, 2);
        assert!(miss_message(2, 1).contains("appears 2 times, not 1"));
    }

    #[test]
    fn edit_matches_across_crlf_and_keeps_the_endings() {
        let found = match_edit("one\r\ntwo\r\n", "one\ntwo", "uno\ndos", 1);
        assert_eq!(found.next.as_deref(), Some("uno\r\ndos\r\n"));
    }

    #[test]
    fn edit_matches_whole_lines_ignoring_trailing_space() {
        let found = match_edit(
            "let a = 1;   \nlet b = 2;\n",
            "let a = 1;\n",
            "let a = 3;\n",
            1,
        );
        assert_eq!(found.next.as_deref(), Some("let a = 3;\nlet b = 2;\n"));
    }

    #[test]
    fn edit_matches_whole_lines_ignoring_indent_when_trim_is_needed() {
        let found = match_edit("    fn go() {}  \n", "fn go() {}\n", "fn stop() {}\n", 1);
        assert_eq!(found.next.as_deref(), Some("fn stop() {}\n"));
    }

    #[test]
    fn exact_substring_keeps_the_indent_around_it() {
        let found = match_edit("    fn go() {}\n", "fn go() {}", "fn stop() {}", 1);
        assert_eq!(found.next.as_deref(), Some("    fn stop() {}\n"));
    }

    #[test]
    fn edit_reports_no_match() {
        let found = match_edit("abc", "zzz", "x", 1);
        assert!(found.next.is_none());
        assert!(miss_message(0, 1).contains("not in the file"));
    }

    #[test]
    fn count_arg_follows_electron_or() {
        assert_eq!(count_arg(None), 1);
        assert_eq!(count_arg(Some(&json!(0))), 1);
        assert_eq!(count_arg(Some(&json!("3"))), 3);
        assert_eq!(count_arg(Some(&json!("nope"))), 1);
    }

    #[test]
    fn checkpoint_blobs_round_trip_and_refuse_damage() {
        let dir = tempfile::tempdir().unwrap();
        let storage = Storage::open(dir.path()).unwrap();
        let store = Checkpoints {
            storage: Arc::new(Mutex::new(storage)),
            blobs: dir.path().join("checkpoints"),
        };
        let hash = store.keep(b"hello").unwrap();
        assert_eq!(store.read(&hash).as_deref(), Some(&b"hello"[..]));
        fs::write(store.blob(&hash), b"tampered").unwrap();
        assert!(store.read(&hash).is_none());
        assert!(store.read("../../etc").is_none());
    }
}
