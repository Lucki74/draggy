//! Runs the shared storage fixtures (`shared/fixtures/storage/*.json`) against draggy-storage. The vitest
//! runner reads the same files, so a case that fails here has drifted from electron/storage.cjs.

use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use draggy_storage::onboarding::{self, PlanInput, Reading, Readings, Record};
use draggy_storage::{Chat, CheckpointInput, MetricInput, Storage, StorageError, Workspace};
use draggy_testkit::{cases, files, fixtures_root};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value, json};

type Failure = String;

#[test]
fn storage_fixtures_match_the_reference() {
    let mut failures = Vec::new();
    let mut ran = 0;
    for file in files("storage") {
        for case in cases("storage", &file) {
            let name = case["name"].as_str().unwrap_or("<unnamed>");
            // The 1.2.7 reader only runs in the vitest runner; this runner checks Rust against the same file.
            if case["input"]["reader"] == "legacy" {
                continue;
            }
            ran += 1;
            match run_case(&case["input"]) {
                Ok(actual) => {
                    if let Err(detail) = check("", &actual, &case["expected"]) {
                        failures.push(format!("{file} :: {name}: {detail}"));
                    }
                }
                Err(error) => failures.push(format!("{file} :: {name}: {error}")),
            }
        }
    }
    assert!(
        failures.is_empty(),
        "{} storage fixture case(s) failed:\n{}",
        failures.len(),
        failures.join("\n")
    );
    assert!(
        ran > 40,
        "only {ran} storage cases ran; the fixture files did not load"
    );
}

fn run_case(input: &Value) -> Result<Value, Failure> {
    if let Some(function) = input.get("fn").and_then(Value::as_str) {
        let args = input
            .get("args")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        return run_pure(function, &args);
    }

    let dir = tempfile::tempdir().map_err(text)?;
    if let Some(database) = input.get("database") {
        materialise(database, dir.path())?;
    }
    let mut store = Some(open(dir.path())?);
    let mut results = Vec::new();
    for entry in input["ops"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
    {
        let call = entry["call"].as_str().unwrap_or_default();
        let args = entry
            .get("args")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        results.push(run_op(&mut store, dir.path(), call, &args)?);
    }
    Ok(Value::Array(results))
}

/// The onboarding decisions. A throw in the reference is `{"error": message}`.
fn run_pure(function: &str, args: &[Value]) -> Result<Value, Failure> {
    match function {
        "planOnboarding" => {
            let input: PlanInput = arg(args, 0)?;
            to_json(onboarding::plan_onboarding(&input))
        }
        "collectInputs" => {
            let spec = args.first().cloned().unwrap_or(Value::Null);
            let readings = Readings {
                raw: text_reading(&spec["readRaw"]),
                settings: text_reading(&spec["readSettings"]),
                model_count: number_reading(&spec["countModels"]),
                chat_count: number_reading(&spec["countChats"]),
                forced: spec["forced"].as_bool().unwrap_or(false),
            };
            to_json(onboarding::collect_inputs(readings))
        }
        "readRecord" => to_json(onboarding::read_record(
            args.first().and_then(Value::as_str),
        )),
        "recordOnStart" => {
            let existing: Option<Record> = arg(args, 0)?;
            to_json(onboarding::record_on_start(
                existing.as_ref(),
                &text_arg(args, 1),
            ))
        }
        "doneRecord" => {
            let path = text_arg(args, 0);
            let now = text_arg(args, 1);
            let started = args.get(2).and_then(Value::as_str);
            match onboarding::done_record(&path, &now, started) {
                Ok(record) => to_json(record),
                Err(error) => Ok(json!({"error": error.to_string()})),
            }
        }
        "inProgressRecord" => to_json(onboarding::in_progress_record(&text_arg(args, 0))),
        other => Err(format!("unknown fn {other}")),
    }
}

/// A read that is `{"throws": ...}` failed; any other value is what the read returned. Non-text reads as none.
fn text_reading(spec: &Value) -> Reading<Option<String>> {
    if is_throw(spec) {
        Reading::Failed
    } else {
        Reading::Read(spec.as_str().map(str::to_string))
    }
}

/// A count read: a number is the count; anything else is not a number, which the decision reads as one.
fn number_reading(spec: &Value) -> Reading<Option<f64>> {
    if is_throw(spec) {
        Reading::Failed
    } else {
        Reading::Read(spec.as_f64())
    }
}

fn is_throw(spec: &Value) -> bool {
    spec.as_object()
        .is_some_and(|map| map.contains_key("throws"))
}

fn open(dir: &Path) -> Result<Storage, Failure> {
    Storage::open(dir).map_err(text)
}

/// Copies a fixture database into `dir` the way the vitest runner does, with its blob folder when there is one.
fn materialise(database: &Value, dir: &Path) -> Result<(), Failure> {
    let target = dir.join("draggy.db");
    if let Some(statements) = database.get("sql").and_then(Value::as_array) {
        let script: Vec<&str> = statements.iter().filter_map(Value::as_str).collect();
        let conn = Connection::open(&target).map_err(text)?;
        conn.execute_batch(&script.join(";\n")).map_err(text)?;
    }
    if let Some(file) = database.get("file").and_then(Value::as_str) {
        let source = fixtures_root().join("storage").join(file);
        fs::copy(&source, &target).map_err(text)?;
        let stem = file.trim_end_matches(".db");
        let blobs = fixtures_root()
            .join("storage")
            .join(format!("{stem}-blobs"));
        if blobs.is_dir() {
            copy_dir(&blobs, &dir.join("blobs")).map_err(text)?;
        }
    }
    if let Some(garbage) = database.get("garbage").and_then(Value::as_str) {
        fs::write(&target, garbage).map_err(text)?;
    }
    Ok(())
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// Runs one op. The pseudo-ops are the runner's own, shared with the vitest runner.
fn run_op(
    store: &mut Option<Storage>,
    root: &Path,
    call: &str,
    args: &[Value],
) -> Result<Value, Failure> {
    match call {
        "reopen" => {
            *store = None;
            *store = Some(open(root)?);
            Ok(Value::Null)
        }
        "close" => {
            if let Some(storage) = store.as_ref() {
                storage.close();
            }
            Ok(Value::Null)
        }
        "scribble" => {
            scribble(root, args).map_err(text)?;
            Ok(Value::Null)
        }
        "quarantined" => {
            let count = fs::read_dir(root)
                .map_err(text)?
                .filter_map(Result::ok)
                .filter(|entry| entry.file_name().to_string_lossy().contains(".corrupt-"))
                .count();
            Ok(json!(count))
        }
        "blobFiles" => Ok(json!(list_files(&root.join("blobs"), "").map_err(text)?)),
        "deleteBlobFiles" => {
            delete_blob_files(root).map_err(text)?;
            Ok(Value::Null)
        }
        "sql" => {
            let statements: Vec<&str> = args
                .first()
                .and_then(Value::as_array)
                .map(|items| items.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default();
            let conn = Connection::open(root.join("draggy.db")).map_err(text)?;
            conn.execute_batch(&statements.join(";\n")).map_err(text)?;
            Ok(Value::Null)
        }
        "query" => {
            // Raw rows from a second, read-only connection, as stored: text, whole and real numbers, and null.
            let sql = args.first().and_then(Value::as_str).unwrap_or_default();
            let conn = Connection::open_with_flags(
                root.join("draggy.db"),
                OpenFlags::SQLITE_OPEN_READ_ONLY,
            )
            .map_err(text)?;
            let mut statement = conn.prepare(sql).map_err(text)?;
            let columns = statement.column_count();
            let rows = statement
                .query_map([], |row| {
                    (0..columns)
                        .map(|index| Ok(raw_value(row.get_ref(index)?)))
                        .collect::<rusqlite::Result<Vec<Value>>>()
                })
                .map_err(text)?
                .collect::<rusqlite::Result<Vec<Vec<Value>>>>()
                .map_err(text)?;
            Ok(Value::Array(rows.into_iter().map(Value::Array).collect()))
        }
        "schema" => schema_dump(root),
        "payloadDepths" => {
            let storage = store.as_ref().ok_or("storage is closed")?;
            let chats = storage.load_chats().map_err(text)?;
            let mut out = Vec::new();
            for chat in chats {
                let mut messages = Vec::new();
                for message in chat.messages.iter().flatten() {
                    let value = to_json(message)?;
                    messages.push(json!({
                        "id": value["id"],
                        "role": value["role"],
                        "content": value["content"],
                        "depth": depth_of(&value),
                    }));
                }
                out.push(json!({"id": chat.id, "messages": messages}));
            }
            Ok(Value::Array(out))
        }
        _ => {
            let storage = store.as_ref().ok_or("storage is closed")?;
            storage_call(storage, call, args)
        }
    }
}

/// A stored cell as JSON. Text is kept as text, and a blob has no JSON form, so it reads as null.
fn raw_value(cell: rusqlite::types::ValueRef<'_>) -> Value {
    use rusqlite::types::ValueRef;
    match cell {
        ValueRef::Null | ValueRef::Blob(_) => Value::Null,
        ValueRef::Integer(whole) => json!(whole),
        ValueRef::Real(real) => json!(real),
        ValueRef::Text(bytes) => Value::String(String::from_utf8_lossy(bytes).into_owned()),
    }
}

/// Nesting depth of a JSON value: a scalar is zero, and an array or object is one more than its deepest child.
fn depth_of(value: &Value) -> usize {
    match value {
        Value::Array(items) => 1 + items.iter().map(depth_of).max().unwrap_or(0),
        Value::Object(map) => 1 + map.values().map(depth_of).max().unwrap_or(0),
        _ => 0,
    }
}

/// Overwrites `length` bytes from `offset` in the database file with `byte`, stopping at the end of the file.
fn scribble(root: &Path, args: &[Value]) -> std::io::Result<()> {
    let from = int_arg(args, 0).unwrap_or(0).max(0) as usize;
    let length = int_arg(args, 1).unwrap_or(0).max(0) as usize;
    let byte = int_arg(args, 2).unwrap_or(0) as u8;
    let file = root.join("draggy.db");
    let mut bytes = fs::read(&file)?;
    for slot in bytes.iter_mut().skip(from).take(length) {
        *slot = byte;
    }
    fs::write(file, bytes)
}

/// Every file under `root`, as a sorted path relative to it with "/" separators. Empty when the folder is missing.
fn list_files(root: &Path, prefix: &str) -> std::io::Result<Vec<String>> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut found = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.file_type()?.is_dir() {
            found.extend(list_files(&entry.path(), &format!("{prefix}{name}/"))?);
        } else {
            found.push(format!("{prefix}{name}"));
        }
    }
    found.sort();
    Ok(found)
}

/// Empties the blob folder, leaving the folder itself, so the rows still point at files that are gone.
fn delete_blob_files(root: &Path) -> std::io::Result<()> {
    let blobs = root.join("blobs");
    match fs::remove_dir_all(&blobs) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    fs::create_dir_all(blobs)
}

/// `sqlite_master` with whitespace collapsed, plus user_version: the reference's `schemaDump`.
fn schema_dump(root: &Path) -> Result<Value, Failure> {
    let conn =
        Connection::open_with_flags(root.join("draggy.db"), OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(text)?;
    let mut statement = conn
        .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name")
        .map_err(text)?;
    let objects = statement
        .query_map([], |row| {
            let sql: Option<String> = row.get(3)?;
            Ok(json!({
                "type": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "tableName": row.get::<_, String>(2)?,
                "sql": sql.map(|sql| sql.split_whitespace().collect::<Vec<_>>().join(" ")),
            }))
        })
        .map_err(text)?
        .collect::<rusqlite::Result<Vec<Value>>>()
        .map_err(text)?;
    let user_version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(text)?;
    Ok(json!({"objects": objects, "userVersion": user_version}))
}

/// The reference's text when a call is refused because the database is closed.
const CLOSED: &str = "The chat database is not open.";

/// What a call answers once the database is closed, as the reference's `whenOpen` fallbacks do.
fn closed_answer(call: &str) -> Value {
    match call {
        "deleteWorkspace" => json!({"success": false, "error": CLOSED, "deleted": 0}),
        "clearMetrics" => json!({"success": false, "error": CLOSED, "removed": 0}),
        "importSessions" => json!({"success": false, "error": CLOSED, "imported": 0}),
        "getWorkspace" | "getCheckpoint" | "getValue" | "stats" => Value::Null,
        "collectGarbage" => json!(0),
        "listWorkspaces" | "listCheckpoints" | "checkpointHashes" | "loadChats"
        | "loadChatSummaries" | "searchChats" | "listMetrics" => json!([]),
        _ => json!({"success": false, "error": CLOSED}),
    }
}

/// A call's answer when the crate raised an error. A refused write is the reference's `{success: false}`;
/// any other failure is the reference's throw, recorded as `{"threw": true}`.
fn answer(call: &str, result: Result<Value, StorageError>) -> Value {
    match result {
        Ok(value) => value,
        Err(StorageError::Closed) => closed_answer(call),
        Err(StorageError::MetricModelMissing) => json!({"success": false}),
        Err(error @ (StorageError::WorkspaceIdMissing | StorageError::DefaultWorkspace)) => {
            json!({"success": false, "error": error.to_string()})
        }
        Err(_) => threw(),
    }
}

fn threw() -> Value {
    json!({"threw": true})
}

/// The storage API, called the way the reference's exports are. Arguments are read the way the reference reads
/// them: `String(x)`, `x || ""`, `Number(x)` and object property reads on whatever was sent.
fn storage_call(storage: &Storage, call: &str, args: &[Value]) -> Result<Value, Failure> {
    let result = match call {
        "listWorkspaces" => storage.list_workspaces().map(to_value),
        "getWorkspace" => storage.get_workspace(&falsy_or_text(args, 0)).map(to_value),
        "saveWorkspace" => {
            // A value that is not an object has no properties, so it reads as an empty workspace.
            let workspace = match args.first() {
                Some(value @ Value::Object(_)) => {
                    serde_json::from_value::<Workspace>(value.clone()).map_err(text)?
                }
                _ => Workspace::default(),
            };
            storage
                .save_workspace(&workspace)
                .map(|saved| json!({"success": true, "workspace": to_value(saved)}))
        }
        "deleteWorkspace" => storage
            .delete_workspace(&string_arg(args, 0))
            .map(|deleted| json!({"success": true, "deleted": deleted})),
        "saveChat" => {
            // A session that is not an object, or has an id that cannot be bound, makes the reference throw.
            let Ok(chat) = arg::<Chat>(args, 0) else {
                return Ok(threw());
            };
            storage.save_chat(&chat).map(|()| json!({"success": true}))
        }
        "loadChats" => storage.load_chats().map(to_value),
        "loadChatSummaries" => storage.load_chat_summaries().map(to_value),
        "deleteChat" => storage
            .delete_chat(&string_arg(args, 0))
            .map(|()| json!({"success": true})),
        "clearChats" => storage.clear_chats().map(|()| json!({"success": true})),
        "searchChats" => return to_json(storage.search_chats(&falsy_or_text(args, 0))),
        "getValue" => storage.get_value(&string_arg(args, 0)).map(to_value),
        "setValue" => storage
            .set_value(&string_arg(args, 0), &string_arg(args, 1))
            .map(|()| json!({"success": true})),
        "importSessions" => {
            // Each entry is read by the crate from the raw value; a list that is not one makes the reference throw.
            let sessions: Vec<Value> = match args.first() {
                None | Some(Value::Null) => Vec::new(),
                Some(Value::Array(items)) => items.clone(),
                Some(Value::String(text)) => {
                    text.chars().map(|c| Value::String(c.to_string())).collect()
                }
                Some(_) => return Ok(threw()),
            };
            let imported = storage.import_sessions(&sessions);
            if storage.is_closed() {
                return Ok(closed_answer(call));
            }
            return Ok(json!({"success": true, "imported": imported}));
        }
        "stats" => storage.stats().map(to_value),
        "collectGarbage" => storage.collect_garbage().map(|count| json!(count)),
        "recordMetric" => {
            // A row that is not an object has no fields to read, so the reference refuses it.
            let Some(Value::Object(_)) = args.first() else {
                return Ok(json!({"success": false}));
            };
            let metric: MetricInput = arg(args, 0)?;
            storage
                .record_metric(&metric)
                .map(|()| json!({"success": true}))
        }
        "listMetrics" => storage.list_metrics(number_arg(args, 0)).map(to_value),
        "clearMetrics" => storage
            .clear_metrics()
            .map(|removed| json!({"success": true, "removed": removed})),
        "addCheckpoint" => {
            // Null has no properties and throws; any other non-object reads every field as undefined.
            let entry = match args.first() {
                Some(Value::Null) => return Ok(threw()),
                Some(value @ Value::Object(_)) => {
                    match serde_json::from_value::<CheckpointInput>(value.clone()) {
                        Ok(entry) => entry,
                        // A field the reference would throw on, such as a hash that cannot be bound, refuses the record.
                        Err(_) => return Ok(threw()),
                    }
                }
                _ => CheckpointInput::default(),
            };
            storage
                .add_checkpoint(&entry)
                .map(|id| json!({"success": true, "id": id}))
        }
        "getCheckpoint" => storage.get_checkpoint(integer_arg(args, 0)).map(to_value),
        "listCheckpoints" => {
            // The limit is `Number(limit) || 100`: a missing, blank or zero limit means the default.
            let limit = match number_arg(args, 1) {
                n if n.is_nan() || n == 0.0 => 0,
                n => n as i64,
            };
            storage
                .list_checkpoints(&string_arg(args, 0), limit)
                .map(to_value)
        }
        "dropCheckpoint" => storage
            .drop_checkpoint(integer_arg(args, 0))
            .map(|()| json!({"success": true})),
        "checkpointHashes" => storage.checkpoint_hashes().map(to_value),
        other => return Err(format!("unknown call {other}")),
    };
    Ok(answer(call, result))
}

/// A value the crate returns, as the reference's JSON would show it.
fn to_value<T: Serialize>(value: T) -> Value {
    serde_json::to_value(value).unwrap_or(Value::Null)
}

/// `String(value)` for an argument. A missing argument is `undefined`, null is `null`, and a list joins its items.
fn string_arg(args: &[Value], index: usize) -> String {
    match args.get(index) {
        None => "undefined".to_string(),
        Some(value) => js_string(value),
    }
}

/// `String(value || "")`: a falsy argument is the empty string, anything else is its text.
fn falsy_or_text(args: &[Value], index: usize) -> String {
    match args.get(index) {
        Some(value) if truthy(value) => js_string(value),
        _ => String::new(),
    }
}

fn js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => number.to_string(),
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .map(|item| {
                if item.is_null() {
                    String::new()
                } else {
                    js_string(item)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".to_string(),
    }
}

fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// `Number(value)` for an argument: null and blank text are zero, and text is parsed; anything else is NaN.
fn number_arg(args: &[Value], index: usize) -> f64 {
    match args.get(index) {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(flag)) => f64::from(u8::from(*flag)),
        Some(Value::Number(number)) => number.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(text)) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                0.0
            } else {
                trimmed.parse::<f64>().unwrap_or(f64::NAN)
            }
        }
        Some(_) => f64::NAN,
    }
}

/// A string argument, with numbers written as their text the way the reference's `String(value)` does.
fn text_arg(args: &[Value], index: usize) -> String {
    match args.get(index) {
        Some(Value::String(value)) => value.clone(),
        Some(Value::Number(value)) => value.to_string(),
        _ => String::new(),
    }
}

fn int_arg(args: &[Value], index: usize) -> Option<i64> {
    args.get(index).and_then(Value::as_i64)
}

/// An id argument that is a whole number. Anything else matches no row, as an unmatchable number does in the reference.
fn integer_arg(args: &[Value], index: usize) -> i64 {
    let number = number_arg(args, index);
    if number.is_finite() && number.fract() == 0.0 && number.abs() < 9.0e15 {
        number as i64
    } else {
        0
    }
}

/// The reference parses a stored tools column at any depth. The fixture files cannot hold a value this deep
/// (testkit parses them with serde_json's default limit), so this checks the read directly.
#[test]
fn a_stored_tools_column_nested_past_the_serde_limit_reads_back() {
    let dir = tempfile::tempdir().expect("temp dir");
    let store = Storage::open(dir.path()).expect("the store opens");
    let nested = format!("{}{}", "[".repeat(200), "]".repeat(200));
    let conn = Connection::open(dir.path().join("draggy.db")).expect("a second connection");
    conn.execute(
        "INSERT INTO metrics (recorded_at, model, tools) VALUES (1000, 'm', ?1)",
        [nested.as_str()],
    )
    .expect("the row is written");

    let metrics = store.list_metrics(0.0).expect("the metrics list");
    let mut depth = 0;
    let mut value = &metrics[0].tools;
    while let Some(items) = value.as_array() {
        depth += 1;
        match items.first() {
            Some(first) => value = first,
            None => break,
        }
    }
    assert_eq!(depth, 200, "every level of the stored column is read back");
}

/// Matches `expected` against `actual`. Every field must match exactly, except two stamps: `{"$any": "number"}`
/// is a finite number above zero, and `{"$any": "now"}` is a number within ten minutes of the clock.
fn check(path: &str, actual: &Value, expected: &Value) -> Result<(), Failure> {
    if let Value::Object(map) = expected
        && map.len() == 1
        && let Some(stamp) = map.get("$any")
    {
        return if stamp_matches(stamp, actual) {
            Ok(())
        } else {
            Err(format!("{path}: expected $any {stamp}, got {actual}"))
        };
    }
    match (actual, expected) {
        (Value::Number(a), Value::Number(e)) => {
            if a.as_f64() == e.as_f64() {
                Ok(())
            } else {
                Err(format!("{path}: expected {e}, got {a}"))
            }
        }
        (Value::Array(a), Value::Array(e)) => {
            if a.len() != e.len() {
                return Err(format!(
                    "{path}: expected {} items, got {}",
                    e.len(),
                    a.len()
                ));
            }
            for (index, (x, y)) in a.iter().zip(e).enumerate() {
                check(&format!("{path}[{index}]"), x, y)?;
            }
            Ok(())
        }
        (Value::Object(a), Value::Object(e)) => check_object(path, a, e),
        _ => {
            if actual == expected {
                Ok(())
            } else {
                Err(format!("{path}: expected {expected}, got {actual}"))
            }
        }
    }
}

fn stamp_matches(stamp: &Value, actual: &Value) -> bool {
    let Some(number) = actual.as_f64().filter(|number| number.is_finite()) else {
        return false;
    };
    match stamp.as_str() {
        Some("number") => number > 0.0,
        Some("now") => (number - now_millis()).abs() <= TEN_MINUTES_MS,
        _ => false,
    }
}

const TEN_MINUTES_MS: f64 = 600_000.0;

fn now_millis() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |elapsed| elapsed.as_millis() as f64)
}

fn check_object(
    path: &str,
    actual: &Map<String, Value>,
    expected: &Map<String, Value>,
) -> Result<(), Failure> {
    if actual.len() != expected.len() {
        let extra: Vec<&String> = actual
            .keys()
            .filter(|key| !expected.contains_key(*key))
            .collect();
        return Err(format!(
            "{path}: keys differ, extra {extra:?}, expected {:?}",
            expected.keys().collect::<Vec<_>>()
        ));
    }
    for (key, value) in expected {
        match actual.get(key) {
            Some(found) => check(&format!("{path}.{key}"), found, value)?,
            None => return Err(format!("{path}: missing key {key}")),
        }
    }
    Ok(())
}

fn arg<T: DeserializeOwned>(args: &[Value], index: usize) -> Result<T, Failure> {
    let value = args.get(index).cloned().unwrap_or(Value::Null);
    serde_json::from_value(value).map_err(|error| format!("argument {index}: {error}"))
}

fn to_json<T: Serialize>(value: T) -> Result<Value, Failure> {
    serde_json::to_value(value).map_err(text)
}

fn text<E: std::fmt::Display>(error: E) -> Failure {
    error.to_string()
}
