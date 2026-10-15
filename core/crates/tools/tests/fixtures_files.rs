//! Runs the golden fixtures in `shared/fixtures/tools/{files,git,skills}-*.json` through the Rust port. The vitest runner
//! in `src/__tests__/fixtures/toolsFiles.test.ts` calls the Electron reference on the same files, so both must agree.
#![cfg(unix)]

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::future::Future;
use std::io;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::{Arc, Mutex};

use draggy_testkit::{cases, files};
use draggy_tools::files as ops;
use draggy_tools::files::{
    Checkpoint, CheckpointStore, ContentKind, FileError, FileOps, NewCheckpoint, Query, Recycler,
    StoreError,
};
use draggy_tools::fs_guard::{self, Guard, MAX_READ_BYTES, ReadError, ResolveOptions};
use draggy_tools::git::{self, FileChange, Git, GitError, GitRun, GitRunner, Kind, RepoState};
use draggy_tools::skills::{self, ReadOptions, Roots, Skills};
use serde_json::{Map, Value, json};
use tracing::instrument::WithSubscriber;

const SUBCOMMANDS: [&str; 5] = ["--version", "rev-parse", "config", "status", "diff"];

#[tokio::test]
async fn tools_file_git_and_skill_fixtures_match_the_typescript_reference() {
    let names = files("tools").into_iter().filter(|name| {
        ["files-", "git-", "skills-"]
            .iter()
            .any(|prefix| name.starts_with(prefix))
    });
    let mut checked = 0;
    for file in names {
        for case in cases("tools", &file) {
            let name = case["name"].as_str().unwrap_or_default();
            let actual = run_case(&file, &case["input"]).await;
            assert_eq!(actual, case["expected"], "{file}: {name}");
            checked += 1;
        }
    }
    // A runner that matched no files would pass with nothing checked.
    assert!(checked > 100, "only {checked} fixture cases ran");
}

/// One case in a fresh temp folder: {base} in the input is that folder, and {base} is put back in the result.
async fn run_case(file: &str, input: &Value) -> Value {
    let dir = tempfile::tempdir().expect("temp dir");
    let base = fs::canonicalize(dir.path()).expect("real path");
    let text = base.to_string_lossy().into_owned();
    let input = fill(input, &text);

    let result = match file {
        "files-guard.json" => guard_case(&input, &base),
        "files-read-text.json" => read_text_case(&input, &base),
        "files-denied-names.json" => json!(fs_guard::is_denied_name(str_at(&input, "name"))),
        "files-collation.json" => json!(collation_sign(str_at(&input, "a"), str_at(&input, "b"))),
        "files-readable.json" => {
            json!(guard_with(&input["protected"]).is_readable(Path::new(str_at(&input, "path"))))
        }
        "files-checkpoint-hash.json" => json!(ops::content_hash(str_at(&input, "text").as_bytes())),
        "files-ops.json" | "files-search.json" | "files-revert.json" | "files-logs.json" => {
            ops_case(&input, &base)
        }
        "skills-files.json" => read_case(&input, &base),
        "skills-log.json" => skills_log_case(&input, &base),
        "skills-library.json" => library_case(),
        "git-porcelain.json" => {
            let tokens = strings(&input["tokens"]);
            to_value(git::parse_status(
                &tokens.join("\0"),
                str_at(&input, "prefix"),
            ))
        }
        "git-counts.json" => to_value(git::count_changes(&changes(&input["files"]))),
        "git-pathspec.json" => json!(git::to_pathspec(
            Path::new(str_at(&input, "root")),
            Path::new(str_at(&input, "absolute"))
        )),
        "git-status.json" => status_case(&input).await,
        "git-diff.json" => diff_case(&input).await,
        "skills-frontmatter.json" => to_value(skills::parse_skill(str_at(&input, "text"))),
        "skills-summary.json" => json!(skills::summarize(str_at(&input, "description"))),
        "skills-list.json" => list_case(&input, &base),
        "skills-read.json" => read_case(&input, &base),
        other => panic!("no runner for {other}"),
    };
    unfill(result, &text)
}

/// Replaces {base} in every string of a fixture value.
fn fill(value: &Value, base: &str) -> Value {
    match value {
        Value::String(text) => Value::String(text.replace("{base}", base)),
        Value::Array(items) => Value::Array(items.iter().map(|item| fill(item, base)).collect()),
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, item)| (key.clone(), fill(item, base)))
                .collect(),
        ),
        other => other.clone(),
    }
}

/// Puts the temp folder back as {base} in every string of a result.
fn unfill(value: Value, base: &str) -> Value {
    match value {
        Value::String(text) => Value::String(text.replace(base, "{base}")),
        Value::Array(items) => {
            Value::Array(items.into_iter().map(|item| unfill(item, base)).collect())
        }
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, item)| (key, unfill(item, base)))
                .collect(),
        ),
        other => other,
    }
}

fn str_at<'a>(input: &'a Value, key: &str) -> &'a str {
    input[key].as_str().unwrap_or_default()
}

fn flag(input: &Value, key: &str) -> bool {
    input[key].as_bool().unwrap_or(false)
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

/// The string entries of a JSON object, in key order.
fn entries(value: &Value) -> Vec<(String, String)> {
    value
        .as_object()
        .map(|map| {
            map.iter()
                .filter_map(|(key, item)| Some((key.clone(), item.as_str()?.to_owned())))
                .collect()
        })
        .unwrap_or_default()
}

fn to_value<T: serde::Serialize>(value: T) -> Value {
    serde_json::to_value(value).expect("fixture value serializes")
}

/// Creates a case's files, byte files, folders and links, in the order the TypeScript runner does.
fn make_tree(base: &Path, tree: &Value) {
    for dir in strings(&tree["dirs"]) {
        fs::create_dir_all(base.join(dir)).expect("folder");
    }
    for (rel, text) in entries(&tree["files"]) {
        write_file(&base.join(rel), text.as_bytes());
    }
    if let Some(byte_files) = tree["bytes"].as_object() {
        for (rel, bytes) in byte_files {
            let data: Vec<u8> = bytes
                .as_array()
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_u64)
                        .map(|byte| byte as u8)
                        .collect()
                })
                .unwrap_or_default();
            write_file(&base.join(rel), &data);
        }
    }
    for (rel, target) in entries(&tree["links"]) {
        let link = base.join(rel);
        fs::create_dir_all(link.parent().expect("link has a folder")).expect("folder");
        symlink(target, link).expect("link");
    }
    // Zero-filled files of a given length, sparse on disk, for the size limits.
    if let Some(sized) = tree["sized"].as_object() {
        for (rel, length) in sized {
            let path = base.join(rel);
            write_file(&path, &[]);
            let file = fs::OpenOptions::new()
                .write(true)
                .open(&path)
                .expect("file opens");
            file.set_len(length.as_u64().unwrap_or(0))
                .expect("file sizes");
        }
    }
    if let Some(long) = tree["long"].as_object() {
        for (rel, clip) in long {
            write_file(&base.join(rel), clip_text(clip).as_bytes());
        }
    }
    if let Some(numbered) = tree["numbered"].as_object() {
        for (dir, spec) in numbered {
            let count = spec["count"].as_u64().unwrap_or(0);
            let stem = str_at(spec, "stem");
            fs::create_dir_all(base.join(dir)).expect("folder");
            for index in 0..count {
                write_file(&base.join(dir).join(format!("{stem}{index:04}.txt")), &[]);
            }
        }
    }
}

/// Text a clip describes: its head, its fill repeated count times, then its tail.
fn clip_text(clip: &Value) -> String {
    let fill = str_at(clip, "fill").repeat(clip["count"].as_u64().unwrap_or(0) as usize);
    format!("{}{}{}", str_at(clip, "head"), fill, str_at(clip, "tail"))
}

/// The -1, 0 or 1 that `localeCompare` gives for two names.
fn collation_sign(a: &str, b: &str) -> i64 {
    match ops::locale_cmp(a, b) {
        std::cmp::Ordering::Less => -1,
        std::cmp::Ordering::Equal => 0,
        std::cmp::Ordering::Greater => 1,
    }
}

fn write_file(path: &Path, data: &[u8]) {
    fs::create_dir_all(path.parent().expect("file has a folder")).expect("folder");
    fs::write(path, data).expect("file writes");
}

fn guard_with(protected: &Value) -> Guard {
    Guard::new(strings(protected).into_iter().map(PathBuf::from))
}

fn guard_case(input: &Value, base: &Path) -> Value {
    make_tree(base, &input["tree"]);
    let roots: Vec<PathBuf> = strings(&input["roots"])
        .into_iter()
        .map(PathBuf::from)
        .collect();
    let options = ResolveOptions {
        must_exist: flag(&input["options"], "mustExist"),
        create_parents: flag(&input["options"], "createParents"),
    };
    match guard_with(&input["protected"]).resolve_within(
        &roots,
        str_at(input, "requested"),
        options,
    ) {
        Ok(path) => json!({ "ok": true, "path": path.to_string_lossy() }),
        Err(refusal) => json!({ "ok": false, "error": refusal.0 }),
    }
}

fn read_text_case(input: &Value, base: &Path) -> Value {
    make_tree(base, &input["tree"]);
    let limit = input["limit"].as_u64().unwrap_or(MAX_READ_BYTES);
    match fs_guard::read_text(Path::new(str_at(input, "file")), limit) {
        Ok(file) => json!({ "ok": true, "text": file.text, "bytes": file.bytes }),
        Err(ReadError::Refused(refusal)) => json!({ "ok": false, "error": refusal.0 }),
        Err(ReadError::Io(error)) => json!({ "ok": false, "error": error.to_string() }),
    }
}

/// A checkpoint store in memory: blobs by hash, rows by id from 1, as the fixture's fake storage keeps them.
/// Clones share the same contents, so a case can make a stored version go missing after the operations ran.
#[derive(Default, Clone)]
struct MemoryStore {
    blobs: Rc<RefCell<BTreeMap<String, Vec<u8>>>>,
    rows: Rc<RefCell<BTreeMap<i64, NewCheckpoint>>>,
    last_id: Rc<RefCell<i64>>,
}

impl MemoryStore {
    /// Forgets the stored earlier version of checkpoint `id`, as a store that has lost its blob would.
    fn lose_version(&self, id: i64) {
        let hash = self
            .rows
            .borrow()
            .get(&id)
            .and_then(|entry| entry.before_hash.clone());
        if let Some(hash) = hash {
            self.blobs.borrow_mut().remove(&hash);
        }
    }
}

impl CheckpointStore for MemoryStore {
    fn keep(&self, bytes: &[u8]) -> Result<String, StoreError> {
        let hash = ops::content_hash(bytes);
        self.blobs
            .borrow_mut()
            .entry(hash.clone())
            .or_insert_with(|| bytes.to_vec());
        Ok(hash)
    }

    fn read(&self, hash: &str) -> Option<Vec<u8>> {
        self.blobs.borrow().get(hash).cloned()
    }

    fn add(&self, entry: &NewCheckpoint) -> Result<i64, StoreError> {
        let mut last = self.last_id.borrow_mut();
        *last += 1;
        self.rows.borrow_mut().insert(*last, entry.clone());
        Ok(*last)
    }

    fn get(&self, id: i64) -> Result<Option<Checkpoint>, StoreError> {
        Ok(self.rows.borrow().get(&id).map(|entry| Checkpoint {
            id,
            entry: entry.clone(),
        }))
    }

    fn drop_checkpoint(&self, id: i64) -> Result<(), StoreError> {
        self.rows.borrow_mut().remove(&id);
        Ok(())
    }
}

/// Removes the file outright, as the fixture's trash does.
struct Discard;

impl Recycler for Discard {
    fn recycle(&self, path: &Path) -> io::Result<()> {
        fs::remove_file(path)
    }
}

fn ops_case(input: &Value, base: &Path) -> Value {
    let project = base.join("project");
    fs::create_dir_all(&project).expect("project folder");
    make_tree(base, &input["tree"]);

    // Workspace w1 is in reach until a `close` step takes its folder away, as the TypeScript runner does.
    let open = Rc::new(RefCell::new(BTreeSet::from(["w1".to_owned()])));
    let store = MemoryStore::default();
    let folder = project.clone();
    let reach = Rc::clone(&open);
    let api = FileOps::new(
        Guard::default(),
        store.clone(),
        Discard,
        move |workspace: &str| {
            if reach.borrow().contains(workspace) {
                vec![folder.clone()]
            } else {
                Vec::new()
            }
        },
    );

    let env = StepEnv {
        open: &open,
        store: &store,
    };
    let capture = LogCapture::new("files", &FILE_LINES);
    let mut results = Vec::new();
    let mut ids: Vec<Option<i64>> = Vec::new();
    let mut run = || {
        for step in input["ops"].as_array().into_iter().flatten() {
            let (outcome, id) = run_step(&api, step, &ids, &env);
            results.push(outcome);
            ids.push(id);
        }
    };
    if input["logs"].as_bool() == Some(true) {
        tracing::subscriber::with_default(capture.clone(), run);
    } else {
        run();
    }

    let mut value = json!({ "results": results });
    if input["state"].as_bool() != Some(false) {
        value["state"] = walk_state(&project, &project);
    }
    if input["logs"].as_bool() == Some(true) {
        value["logs"] = Value::Array(capture.lines());
    }
    value
}

/// The lines a file case is checked for: each operation's outcome, the checkpoint bookkeeping and a thrown failure.
const FILE_LINES: [&str; 5] = [
    "file op done",
    "file op refused",
    "file op failed",
    "checkpoint created",
    "checkpoint restored",
];

/// The git lines a case is checked for: the failures the reference logs at ERROR.
const GIT_LINES: [&str; 3] = ["status failed", "diff failed", "diff list failed"];

/// The skill lines a case is checked for: installs, removals and switches, each logged at INFO.
const SKILL_LINES: [&str; 3] = ["skill installed", "skill removed", "enabled skills changed"];

/// Records the INFO, WARN and ERROR events of one target with one of the given messages, as the TypeScript runner does.
/// The error an ERROR carries is not recorded: the reference passes it as its own argument, apart from the data.
#[derive(Clone)]
struct LogCapture {
    target: &'static str,
    messages: &'static [&'static str],
    lines: Arc<Mutex<Vec<Value>>>,
}

impl LogCapture {
    fn new(target: &'static str, messages: &'static [&'static str]) -> Self {
        Self {
            target,
            messages,
            lines: Arc::default(),
        }
    }

    fn lines(&self) -> Vec<Value> {
        self.lines.lock().expect("log lock").clone()
    }
}

impl tracing::Subscriber for LogCapture {
    fn enabled(&self, _: &tracing::Metadata<'_>) -> bool {
        true
    }

    fn new_span(&self, _: &tracing::span::Attributes<'_>) -> tracing::span::Id {
        tracing::span::Id::from_u64(1)
    }

    fn record(&self, _: &tracing::span::Id, _: &tracing::span::Record<'_>) {}

    fn record_follows_from(&self, _: &tracing::span::Id, _: &tracing::span::Id) {}

    fn event(&self, event: &tracing::Event<'_>) {
        let meta = event.metadata();
        let level = match *meta.level() {
            tracing::Level::INFO => "info",
            tracing::Level::WARN => "warn",
            tracing::Level::ERROR => "error",
            _ => return,
        };
        if meta.target() != self.target {
            return;
        }
        let mut fields = LineFields::default();
        event.record(&mut fields);
        let message = fields.0.remove("message").unwrap_or_default();
        fields.0.remove("error");
        if !self
            .messages
            .contains(&message.as_str().unwrap_or_default())
        {
            return;
        }
        self.lines
            .lock()
            .expect("log lock")
            .push(json!({ "level": level, "message": message, "data": Value::Object(fields.0) }));
    }

    fn enter(&self, _: &tracing::span::Id) {}

    fn exit(&self, _: &tracing::span::Id) {}
}

/// What a step can change beyond the folder: the workspaces still in reach, and the stored versions.
struct StepEnv<'a> {
    open: &'a RefCell<BTreeSet<String>>,
    store: &'a MemoryStore,
}

/// The fields of one event as JSON values, keyed by name.
#[derive(Default)]
struct LineFields(Map<String, Value>);

impl tracing::field::Visit for LineFields {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        self.0
            .insert(field.name().to_owned(), json!(format!("{value:?}")));
    }

    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        self.0.insert(field.name().to_owned(), json!(value));
    }

    fn record_u64(&mut self, field: &tracing::field::Field, value: u64) {
        self.0.insert(field.name().to_owned(), json!(value));
    }

    fn record_i64(&mut self, field: &tracing::field::Field, value: i64) {
        self.0.insert(field.name().to_owned(), json!(value));
    }
}

/// A refusal is the message the model reads; anything else is a failure of the disk or store, which the TypeScript runner
/// sees as a thrown error, so the case records that it threw.
fn failure(error: FileError) -> Value {
    match error {
        FileError::Refused(refusal) => json!({ "success": false, "error": refusal.0 }),
        _ => json!({ "success": false, "thrown": true }),
    }
}

fn lossy(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// One operation, normalized the way the TypeScript runner shapes it, with the checkpoint it recorded.
fn run_step<S, R, F>(
    api: &FileOps<S, R, F>,
    step: &Value,
    ids: &[Option<i64>],
    env: &StepEnv<'_>,
) -> (Value, Option<i64>)
where
    S: CheckpointStore,
    R: Recycler,
    F: Fn(&str) -> Vec<PathBuf>,
{
    let workspace = step["workspace"].as_str().unwrap_or("w1");
    let path = str_at(step, "path");
    let chat = step["chat"].as_str();
    match str_at(step, "call") {
        "list" => match api.list(workspace, path) {
            Ok(listing) => {
                let entries: Vec<Value> = listing
                    .entries
                    .iter()
                    .map(|entry| {
                        // A folder's own size is whatever the filesystem says (4096 on ext4, 96 on APFS), so the
                        // fixtures record the ext4 value and every runner reports it for folders.
                        let size = if entry.is_directory { 4096 } else { entry.size };
                        json!({ "name": entry.name, "isDirectory": entry.is_directory, "size": size })
                    })
                    .collect();
                (
                    json!({ "success": true, "entries": entries, "truncated": listing.truncated }),
                    None,
                )
            }
            Err(error) => (failure(error), None),
        },
        "read" => match api.read(workspace, path) {
            Ok(opened) => {
                let kind = match opened.kind {
                    ContentKind::Text => "text",
                    ContentKind::Image => "image",
                    ContentKind::Media => "media",
                };
                let value = json!({
                    "success": true,
                    "kind": kind,
                    "mime": opened.mime,
                    "dataUrl": opened.data_url,
                    "text": opened.text,
                    "bytes": opened.bytes,
                });
                (value, None)
            }
            Err(error) => (failure(error), None),
        },
        "search" => {
            let query = Query {
                name: str_at(step, "name").to_owned(),
                text: str_at(step, "text").to_owned(),
                limit: step["limit"].as_f64(),
            };
            match api.search(workspace, &query) {
                Ok(mut found) => {
                    if step["countOnly"].as_bool() == Some(true) {
                        let count = found.hits.len();
                        return (
                            json!({ "success": true, "count": count, "truncated": found.truncated }),
                            None,
                        );
                    }
                    found.hits.sort_by(|a, b| {
                        a.path
                            .to_string_lossy()
                            .cmp(&b.path.to_string_lossy())
                            .then(a.line.unwrap_or(0).cmp(&b.line.unwrap_or(0)))
                    });
                    let hits: Vec<Value> = found.hits.iter().map(hit_value).collect();
                    (
                        json!({ "success": true, "hits": hits, "truncated": found.truncated }),
                        None,
                    )
                }
                Err(error) => (failure(error), None),
            }
        }
        "locate" => match api.locate(workspace, path) {
            Ok(found) => (json!({ "success": true, "path": lossy(&found) }), None),
            Err(error) => (failure(error), None),
        },
        "write" => match api.write(workspace, path, str_at(step, "contents"), chat) {
            Ok(written) => (
                json!({
                    "success": true,
                    "path": lossy(&written.path),
                    "created": written.created,
                    "bytes": written.bytes,
                    "checkpointId": written.checkpoint_id,
                }),
                Some(written.checkpoint_id),
            ),
            Err(error) => (failure(error), None),
        },
        "edit" => {
            let expected = step["expected"].as_i64().unwrap_or(0);
            match api.edit(
                workspace,
                path,
                str_at(step, "find"),
                str_at(step, "replace"),
                expected,
                chat,
            ) {
                Ok(edited) => (
                    json!({
                        "success": true,
                        "path": lossy(&edited.path),
                        "checkpointId": edited.checkpoint_id,
                        "replaced": edited.replaced,
                        "before": edited.before,
                        "after": edited.after,
                        "bytes": edited.bytes,
                    }),
                    Some(edited.checkpoint_id),
                ),
                Err(error) => (failure(error), None),
            }
        }
        "move" => match api.move_path(workspace, str_at(step, "from"), str_at(step, "to"), chat) {
            Ok(moved) => (
                json!({
                    "success": true,
                    "path": lossy(&moved.path),
                    "from": lossy(&moved.from),
                    "checkpointId": moved.checkpoint_id,
                }),
                Some(moved.checkpoint_id),
            ),
            Err(error) => (failure(error), None),
        },
        "remove" => match api.remove(workspace, path, chat) {
            Ok(removed) => (
                json!({ "success": true, "path": lossy(&removed.path), "checkpointId": removed.checkpoint_id }),
                Some(removed.checkpoint_id),
            ),
            Err(error) => (failure(error), None),
        },
        "revert" => {
            // A step's own id wins; otherwise the checkpoint of the earlier op named by undo. Neither means no change.
            let id = step["id"]
                .as_i64()
                .or_else(|| {
                    let index = usize::try_from(step["undo"].as_u64()?).ok()?;
                    ids.get(index).copied().flatten()
                })
                .unwrap_or(-1);
            match api.revert(id) {
                Ok(reverted) => (
                    json!({
                        "success": true,
                        "path": lossy(&reverted.path),
                        "from": reverted.from.as_deref().map(lossy),
                        "workspaceId": reverted.workspace_id,
                    }),
                    None,
                ),
                Err(error) => (failure(error), None),
            }
        }
        "close" => {
            env.open.borrow_mut().remove(workspace);
            (json!({ "success": true }), None)
        }
        "lose_version" => {
            let id = step["id"].as_i64().unwrap_or_else(|| {
                usize::try_from(step["undo"].as_u64().unwrap_or(u64::MAX))
                    .ok()
                    .and_then(|index| ids.get(index).copied().flatten())
                    .unwrap_or(-1)
            });
            env.store.lose_version(id);
            (json!({ "success": true }), None)
        }
        other => panic!("no operation {other}"),
    }
}

fn hit_value(hit: &ops::Hit) -> Value {
    let mut value = Map::new();
    value.insert("path".into(), json!(lossy(&hit.path)));
    value.insert("name".into(), json!(hit.name));
    if let Some(line) = hit.line {
        value.insert("line".into(), json!(line));
    }
    if let Some(text) = &hit.text {
        value.insert("text".into(), json!(text));
    }
    Value::Object(value)
}

/// Every file under `dir`, keyed by its path relative to `root`, with its text.
fn walk_state(root: &Path, dir: &Path) -> Value {
    let mut state = BTreeMap::new();
    collect(root, dir, &mut state);
    json!(state)
}

/// Files longer than this are listed by their length, as the TypeScript runner lists them.
const STATE_TEXT_BYTES: usize = 4096;

fn collect(root: &Path, dir: &Path, state: &mut BTreeMap<String, String>) {
    for entry in fs::read_dir(dir).expect("folder reads") {
        let entry = entry.expect("entry reads");
        let path = entry.path();
        if entry.file_type().expect("file type").is_dir() {
            collect(root, &path, state);
        } else {
            let relative: Vec<String> = path
                .strip_prefix(root)
                .expect("inside the project")
                .components()
                .map(|part| part.as_os_str().to_string_lossy().into_owned())
                .collect();
            let data = fs::read(&path).expect("file reads");
            let text = if data.len() > STATE_TEXT_BYTES {
                format!("{} bytes", data.len())
            } else {
                String::from_utf8_lossy(&data).into_owned()
            };
            state.insert(relative.join("/"), text);
        }
    }
}

fn kind_named(text: &str) -> Kind {
    match text {
        "modified" => Kind::Modified,
        "added" => Kind::Added,
        "deleted" => Kind::Deleted,
        "renamed" => Kind::Renamed,
        "untracked" => Kind::Untracked,
        "conflicted" => Kind::Conflicted,
        other => panic!("no kind {other}"),
    }
}

fn changes(value: &Value) -> Vec<FileChange> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(|item| FileChange {
                    path: String::new(),
                    from: None,
                    kind: kind_named(str_at(item, "kind")),
                    staged: false,
                    unstaged: false,
                })
                .collect()
        })
        .unwrap_or_default()
}

fn skill_roots(base: &Path, project: bool) -> Roots {
    Roots {
        library: Some(base.join("library")),
        user: Some(base.join("userdata").join("skills")),
        project: project.then(|| base.join("project")),
    }
}

fn overrides_of(value: &Value) -> BTreeMap<String, bool> {
    value
        .as_object()
        .map(|map| {
            map.iter()
                .filter_map(|(id, switch)| Some((id.clone(), switch.as_bool()?)))
                .collect()
        })
        .unwrap_or_default()
}

fn list_case(input: &Value, base: &Path) -> Value {
    make_tree(base, &input["tree"]);
    let roots = skill_roots(base, flag(input, "project"));
    to_value(Skills::default().list(&roots, &overrides_of(&input["overrides"])))
}

fn read_case(input: &Value, base: &Path) -> Value {
    make_tree(base, &input["tree"]);
    let roots = skill_roots(base, flag(input, "project"));
    let options = ReadOptions {
        overrides: overrides_of(&input["overrides"]),
        enabled_only: flag(input, "enabledOnly"),
        file: input["file"].as_str().map(str::to_owned),
    };
    match Skills::default().read(&roots, str_at(input, "id"), &options) {
        Ok(read) => {
            let mut value = Map::new();
            value.insert("success".into(), json!(true));
            value.insert("skill".into(), to_value(read.skill));
            if let Some(file) = read.file {
                value.insert("file".into(), to_value(file));
            }
            Value::Object(value)
        }
        Err(error) => json!({ "success": false, "error": error.to_string() }),
    }
}

/// A git stand-in that answers from the case's responses and records each argv, space-joined, in order.
struct Scripted {
    responses: BTreeMap<String, Value>,
    calls: Arc<Mutex<Vec<String>>>,
}

impl GitRunner for Scripted {
    fn run(&self, args: &[String], _cwd: &Path) -> impl Future<Output = GitRun> + Send {
        let answer = self.answer(args);
        async move { answer }
    }
}

impl Scripted {
    fn answer(&self, args: &[String]) -> GitRun {
        self.calls.lock().expect("calls lock").push(args.join(" "));
        let sub = args
            .iter()
            .map(String::as_str)
            .find(|arg| SUBCOMMANDS.contains(arg));
        let listing = sub == Some("diff") && args.iter().any(|arg| arg == "--name-only");
        let key = if listing {
            Some("diff --name-only")
        } else {
            sub
        };
        let response = key
            .and_then(|key| self.responses.get(key))
            .or_else(|| sub.and_then(|sub| self.responses.get(sub)));

        let Some(response) = response else {
            return GitRun::default();
        };
        let stdout = match response["tokens"].as_array() {
            Some(tokens) => tokens
                .iter()
                .map(|token| format!("{}\0", token.as_str().unwrap_or_default()))
                .collect(),
            None if response["stdout"].is_object() => clip_text(&response["stdout"]),
            None => str_at(response, "stdout").to_owned(),
        };
        GitRun {
            code: response["code"].as_i64().unwrap_or(0) as i32,
            stdout,
            stderr: str_at(response, "stderr").to_owned(),
            missing: flag(response, "missing"),
        }
    }
}

fn scripted(responses: &Value, calls: &Arc<Mutex<Vec<String>>>) -> Scripted {
    Scripted {
        responses: responses
            .as_object()
            .map(|map| {
                map.iter()
                    .map(|(key, value)| (key.clone(), value.clone()))
                    .collect()
            })
            .unwrap_or_default(),
        calls: Arc::clone(calls),
    }
}

fn recorded(calls: &Arc<Mutex<Vec<String>>>) -> Value {
    json!(calls.lock().expect("calls lock").clone())
}

async fn status_case(input: &Value) -> Value {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let git = Git::with_runner(scripted(&input["responses"], &calls));
    let capture = LogCapture::new("files.git", &GIT_LINES);
    let state = git
        .status(Path::new(str_at(input, "root")))
        .with_subscriber(capture.clone())
        .await;
    let mut value = json!({ "result": status_value(state), "calls": recorded(&calls) });
    if flag(input, "logs") {
        value["logs"] = Value::Array(capture.lines());
    }
    value
}

fn status_value(state: Result<RepoState, GitError>) -> Value {
    match state {
        Ok(RepoState::NoGit) => json!({ "success": true, "available": false, "isRepo": false }),
        Ok(RepoState::NotRepo) => json!({ "success": true, "available": true, "isRepo": false }),
        Ok(RepoState::Repo { status, counts }) => {
            let mut value = Map::new();
            value.insert("success".into(), json!(true));
            value.insert("available".into(), json!(true));
            value.insert("isRepo".into(), json!(true));
            if let Value::Object(fields) = to_value(status) {
                value.extend(fields);
            }
            value.insert("counts".into(), to_value(counts));
            Value::Object(value)
        }
        Err(error) => {
            json!({ "success": false, "available": true, "isRepo": true, "error": error.to_string() })
        }
    }
}

async fn diff_case(input: &Value) -> Value {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let git = Git::with_runner(scripted(&input["responses"], &calls));
    let root = PathBuf::from(str_at(input, "root"));
    let denied = strings(&input["denied"]);
    let allow = |absolute: &Path| {
        !denied.iter().any(|name| {
            absolute
                .strip_prefix(&root)
                .is_ok_and(|relative| relative.to_string_lossy() == name.as_str())
        })
    };
    let capture = LogCapture::new("files.git", &GIT_LINES);
    let outcome = git
        .diff(
            &root,
            str_at(input, "relative"),
            flag(input, "staged"),
            allow,
        )
        .with_subscriber(capture.clone())
        .await;
    let result = match outcome {
        Ok(diff) => json!({
            "success": true,
            "diff": diff.diff,
            "truncated": diff.truncated,
            "staged": diff.staged,
            "files": diff.files,
            "skipped": diff.skipped,
        }),
        Err(error) => json!({ "success": false, "error": error.to_string() }),
    };
    let mut value = json!({ "result": result, "calls": recorded(&calls) });
    if flag(input, "logs") {
        value["logs"] = Value::Array(capture.lines());
    }
    value
}

/// The skills the shipped library lists, as the app lists them. Folder paths are left out: they differ per machine.
fn library_case() -> Value {
    let roots = Roots {
        library: Some(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../electron/skills-library"),
        ),
        user: None,
        project: None,
    };
    let listing = Skills::default().list(&roots, &BTreeMap::new());
    Value::Array(
        listing
            .iter()
            .map(|skill| {
                let mut value = to_value(skill);
                if let Some(map) = value.as_object_mut() {
                    map.remove("path");
                }
                value
            })
            .collect(),
    )
}

/// The skill layer over a folder of user skills, with the lines it logs. The first step sets the baseline, so its lines
/// are dropped: the reference keeps its last listing across cases. Expected: {results, logs}.
fn skills_log_case(input: &Value, base: &Path) -> Value {
    let roots = skill_roots(base, false);
    let skills = Skills::default();
    let capture = LogCapture::new("skills", &SKILL_LINES);
    let mut results = Vec::new();
    tracing::subscriber::with_default(capture.clone(), || {
        for (index, step) in input["steps"].as_array().into_iter().flatten().enumerate() {
            match str_at(step, "call") {
                "install" => {
                    write_file(
                        &base
                            .join("userdata/skills")
                            .join(str_at(step, "id"))
                            .join("SKILL.md"),
                        str_at(step, "text").as_bytes(),
                    );
                    results.push(json!({ "success": true }));
                }
                "remove" => {
                    let folder = base.join("userdata/skills").join(str_at(step, "id"));
                    fs::remove_dir_all(folder).expect("skill folder removed");
                    results.push(json!({ "success": true }));
                }
                _ => {
                    let listing = skills.list(&roots, &overrides_of(&step["overrides"]));
                    let rows: Vec<Value> = listing
                        .iter()
                        .map(|skill| json!({ "id": skill.id, "enabled": skill.enabled }))
                        .collect();
                    results.push(json!({ "skills": rows }));
                }
            }
            if index == 0 {
                capture.lines.lock().expect("log lock").clear();
            }
        }
    });
    json!({ "results": results, "logs": capture.lines() })
}
