//! The rollback proof and the drift guard for `rust-written.db` (plan section 8 and 9). The committed file
//! must match a fresh regeneration row for row, and both readers must agree on what it holds.

#[allow(dead_code)]
#[path = "../examples/write_fixture_db.rs"]
mod write_fixture_db;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use draggy_storage::{Chat, Storage};
use draggy_testkit::{cases, fixtures_root};
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;

/// The tables the logical dump compares. The workspace times are masked: the default workspace is stamped
/// with the time of the open that created it, so no two runs agree on them.
const TABLES: [&str; 9] = [
    "workspaces",
    "chats",
    "messages",
    "attachments",
    "blobs",
    "kv",
    "checkpoints",
    "metrics",
    "message_search",
];

#[test]
fn a_fresh_regeneration_has_the_committed_logical_dump() {
    let out = tempfile::tempdir().expect("temp dir");
    write_fixture_db::write_dataset(out.path()).expect("the example writes its dataset");

    // The committed file is copied first: a read-only open of a WAL database leaves -wal and -shm behind.
    let scratch = tempfile::tempdir().expect("temp dir");
    let copy = scratch.path().join("rust-written.db");
    fs::copy(committed_db(), &copy).expect("copy the committed database");

    let fresh = logical_dump(&out.path().join("rust-written.db"));
    let committed = logical_dump(&copy);

    assert_eq!(
        fresh, committed,
        "rust-written.db no longer matches a fresh regeneration. Run \
         `cargo run -p draggy-storage --example write_fixture_db` and regenerate rust-written.expected.json"
    );
}

#[test]
fn rust_reads_the_committed_file_the_way_the_1_2_7_reader_does() {
    let work = tempfile::tempdir().expect("temp dir");
    fs::copy(committed_db(), work.path().join("draggy.db")).expect("copy the committed database");
    copy_dir(&committed_blobs(), &work.path().join("blobs")).expect("copy the blob folder");

    let store = Storage::open(work.path()).expect("the committed database opens");
    let chats: Vec<Value> = store
        .load_chats()
        .expect("chats load")
        .iter()
        .map(legacy_shape)
        .collect();

    let expected = cases("storage", "rust-written.expected.json");
    let loaded = expected
        .iter()
        .find(|case| case["name"] == "1.2.7 loads the chats the Rust core wrote")
        .expect("the 1.2.7 case is in the fixture");
    assert_eq!(Value::Array(chats), loaded["expected"][0]);
}

/// Only the fields the 1.2.7 reader returns, so the comparison is with what that reader shows.
fn legacy_shape(chat: &Chat) -> Value {
    let mut value = serde_json::to_value(chat).expect("a chat serialises");
    if let Value::Object(map) = &mut value {
        map.retain(|key, _| {
            matches!(
                key.as_str(),
                "id" | "title"
                    | "updatedAt"
                    | "isOutOfContext"
                    | "isGenerating"
                    | "compaction"
                    | "messages"
            )
        });
    }
    value
}

/// Every row of every compared table, rendered cell by cell and sorted, so row order and row ids do not
/// matter beyond what the rows contain.
fn logical_dump(path: &Path) -> BTreeMap<String, Vec<String>> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .expect("open for reading");
    let mut dump = BTreeMap::new();
    for table in TABLES {
        let mut statement = conn
            .prepare(&format!("SELECT * FROM {table}"))
            .expect("table exists");
        let columns: Vec<String> = statement
            .column_names()
            .iter()
            .map(|name| (*name).to_string())
            .collect();
        let mut rows: Vec<String> = statement
            .query_map([], |row| {
                let mut cells = Vec::new();
                for (index, column) in columns.iter().enumerate() {
                    let cell = match row.get_ref(index)? {
                        ValueRef::Null => "null".to_string(),
                        ValueRef::Integer(_) if is_masked(table, column) => "<time>".to_string(),
                        ValueRef::Integer(value) => value.to_string(),
                        ValueRef::Real(value) => value.to_string(),
                        ValueRef::Text(bytes) => format!("{:?}", String::from_utf8_lossy(bytes)),
                        ValueRef::Blob(bytes) => format!("blob:{}", bytes.len()),
                    };
                    cells.push(format!("{column}={cell}"));
                }
                Ok(cells.join("|"))
            })
            .expect("rows read")
            .collect::<rusqlite::Result<Vec<String>>>()
            .expect("rows collect");
        rows.sort();
        dump.insert(table.to_string(), rows);
    }
    dump
}

fn is_masked(table: &str, column: &str) -> bool {
    table == "workspaces" && (column == "created_at" || column == "updated_at")
}

fn committed_db() -> PathBuf {
    fixtures_root().join("storage").join("rust-written.db")
}

fn committed_blobs() -> PathBuf {
    fixtures_root().join("storage").join("rust-written-blobs")
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
