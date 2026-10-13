//! Checks a database before it is trusted, and rebuilds one that is damaged. The damaged file is kept aside.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension};

use crate::js::{iso_timestamp, now_millis, utf16_prefix};
use crate::{SCHEMA_VERSION, StorageError, migrate, schema};

/// A quick integrity walk, then the three reads that fail on a damaged index or key-value table.
/// Without these every save would fail for good, with nothing shown to the user.
pub(crate) fn is_usable(conn: &Connection) -> bool {
    // quick_check walks the page structure, which a bare SELECT does not, so it sees damage a probe would miss.
    match conn.query_row("PRAGMA quick_check(1)", [], |row| row.get::<_, String>(0)) {
        Ok(verdict) if verdict.eq_ignore_ascii_case("ok") => {}
        Ok(verdict) => {
            tracing::warn!(target: "storage.recover", verdict = %utf16_prefix(&verdict, 200), "quick_check reported a problem");
            return false;
        }
        Err(error) => {
            tracing::warn!(target: "storage.recover", error = %error, "database is not usable");
            return false;
        }
    }

    let probes = [
        "SELECT value FROM kv WHERE key = 'schema_version'",
        "SELECT COUNT(*) FROM message_search",
        "SELECT COUNT(*) FROM chats",
    ];
    for probe in probes {
        let outcome: rusqlite::Result<Option<()>> =
            conn.query_row(probe, [], |_| Ok(())).optional();
        if let Err(error) = outcome {
            tracing::warn!(target: "storage.recover", error = %error, "database is not usable");
            return false;
        }
    }
    true
}

/// The tables a rescue copies, with the columns it copies. Chats skip the workspace column, which a
/// damaged database may predate, so every rescued chat lands in the default workspace.
const RESCUED: [(&str, &str); 5] = [
    (
        "workspaces",
        "id, name, kind, root_path, permission_mode, settings, created_at, updated_at",
    ),
    ("chats", "id, title, updated_at, is_out_of_context"),
    // TS quirk: attachments keep their old message_row_id, which only matches when no message row was skipped.
    ("messages", "id, chat_id, position, role, payload"),
    (
        "attachments",
        "message_row_id, position, name, type, blob_hash",
    ),
    ("blobs", "hash, bytes"),
];

/// Copies what the damaged file still holds into `conn`. Returns the row count across the copied tables.
// TS quirk: the search index is not copied or rebuilt, so rescued chats stay unsearchable until saved again.
pub(crate) fn salvage(conn: &Connection, damaged: &Path) -> usize {
    let path = damaged.to_string_lossy();
    if let Err(error) = conn.execute("ATTACH DATABASE ?1 AS damaged", [path.as_ref()]) {
        tracing::warn!(target: "storage.recover", error = %error, "could not attach the damaged database");
        return 0;
    }

    let mut rescued = 0;
    for (table, columns) in RESCUED {
        let copy = format!(
            "INSERT OR IGNORE INTO {table} ({columns}) SELECT {columns} FROM damaged.{table}"
        );
        let count = conn.execute_batch(&copy).and_then(|()| {
            conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get::<_, i64>(0)
            })
        });
        match count {
            Ok(total) => rescued += usize::try_from(total).unwrap_or(0),
            Err(error) => {
                tracing::warn!(target: "storage.recover", table, error = %error, "could not rescue a table")
            }
        }
    }

    if let Err(error) = conn.execute_batch("DETACH DATABASE damaged") {
        tracing::debug!(target: "storage.recover", error = %error, "detach after rescue failed");
    }
    rescued
}

/// Moves the damaged file and its journal aside, starts a fresh database, and copies in what it can rescue.
/// The caller must drop its own connection first.
pub(crate) fn rebuild(db_path: &Path) -> Result<Connection, StorageError> {
    let stamp = iso_timestamp(now_millis()).replace([':', '.'], "-");
    let quarantine = with_suffix(db_path, &format!(".corrupt-{stamp}"));

    for suffix in ["", "-wal", "-shm"] {
        let from = with_suffix(db_path, suffix);
        if !from.exists() {
            continue;
        }
        let to = with_suffix(&quarantine, suffix);
        if let Err(move_error) = fs::rename(&from, &to) {
            remove_unmovable(&from, &move_error);
        }
    }
    tracing::warn!(target: "storage.recover", file = %file_name(&quarantine), "quarantined the damaged database");

    let conn = Connection::open(db_path)?;
    conn.execute_batch(schema::SCHEMA)?;
    let rescued = if quarantine.exists() {
        salvage(&conn, &quarantine)
    } else {
        0
    };
    if let Err(error) = migrate::record_schema_version(&conn, SCHEMA_VERSION) {
        tracing::debug!(target: "storage.recover", error = %error, "fresh database already at the current schema");
    }
    tracing::info!(target: "storage.recover", rescued, "rebuilt the database");
    Ok(conn)
}

/// A damaged file that cannot be moved is removed instead; if that fails too, the error is logged and the rebuild goes on.
fn remove_unmovable(from: &Path, move_error: &std::io::Error) {
    if let Err(error) = fs::remove_file(from) {
        tracing::error!(
            target: "storage.recover",
            file = %file_name(from),
            error = %error,
            cause = %move_error,
            "could not move or remove a damaged database file"
        );
    }
}

/// `path` with `suffix` appended to the file name, keeping the bytes of a non-UTF-8 name intact.
fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}
