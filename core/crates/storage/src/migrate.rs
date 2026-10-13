//! The schema version kept in the kv table, and the one-off rebuild of the 1.x messages table.

use rusqlite::{Connection, OptionalExtension, params};

use crate::js::number_from_str;
use crate::{SCHEMA_VERSION, StorageError};

/// The version on disk, read the way the Electron build reads it. None when the row is missing.
pub(crate) fn schema_version(conn: &Connection) -> Result<Option<f64>, StorageError> {
    let stored: Option<String> = conn
        .query_row(
            "SELECT value FROM kv WHERE key = ?1",
            ["schema_version"],
            |row| row.get(0),
        )
        .optional()?;
    Ok(stored.map(|text| number_from_str(&text)))
}

pub(crate) fn record_schema_version(conn: &Connection, version: i64) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params!["schema_version", version.to_string()],
    )
}

/// Brings a database from an older version up to date. Only the 1.x messages table needs a rebuild;
/// every other older database already has the columns it needs and only gets the version recorded.
pub(crate) fn migrate(conn: &mut Connection) -> Result<(), StorageError> {
    let Some(version) = schema_version(conn)? else {
        record_schema_version(conn, SCHEMA_VERSION)?;
        return Ok(());
    };
    if version >= SCHEMA_VERSION as f64 {
        return Ok(());
    }
    if !has_legacy_message_table(conn)? {
        record_schema_version(conn, SCHEMA_VERSION)?;
        return Ok(());
    }

    tracing::info!(target: "storage.migrate", from = version, to = SCHEMA_VERSION, "migrating chat database");
    // Rebuilding a table with foreign keys on would cascade-delete the rows being copied.
    conn.execute_batch("PRAGMA foreign_keys = OFF")?;
    let outcome = rebuild_messages(conn);
    if let Err(error) = &outcome {
        tracing::error!(target: "storage.migrate", error = %error, "migration failed");
    }
    conn.execute_batch("PRAGMA foreign_keys = ON")?;
    outcome?;
    tracing::info!(target: "storage.migrate", "migration complete");
    Ok(())
}

fn rebuild_messages(conn: &mut Connection) -> Result<(), StorageError> {
    let tx = conn.transaction()?;
    tx.execute_batch(REBUILD_MESSAGES)?;
    record_schema_version(&tx, SCHEMA_VERSION)?;
    tx.commit()?;
    Ok(())
}

pub(crate) fn column_names(conn: &Connection, table: &str) -> rusqlite::Result<Vec<String>> {
    let mut statement = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(names)
}

/// A 1.x messages table is keyed by id alone, so it has no `row_id` column.
fn has_legacy_message_table(conn: &Connection) -> rusqlite::Result<bool> {
    let columns = column_names(conn, "messages")?;
    Ok(!columns.is_empty() && !columns.iter().any(|name| name == "row_id"))
}

/// Adds a column once. Kept out of `migrate` because a column every version can ignore needs no version of its own.
pub(crate) fn ensure_column(
    conn: &Connection,
    table: &str,
    name: &str,
    definition: &str,
) -> Result<bool, StorageError> {
    if column_names(conn, table)?
        .iter()
        .any(|column| column == name)
    {
        return Ok(false);
    }
    conn.execute_batch(&format!(
        "ALTER TABLE {table} ADD COLUMN {name} {definition}"
    ))?;
    tracing::info!(target: "storage.migrate", table, column = name, "added column");
    Ok(true)
}

/// Copies the 1.x rows into the keyed-by-chat table. Message ids may repeat across chats after this.
const REBUILD_MESSAGES: &str = r#"
      CREATE TABLE messages_next (
        row_id   INTEGER PRIMARY KEY AUTOINCREMENT,
        id       TEXT NOT NULL,
        chat_id  TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        role     TEXT NOT NULL,
        payload  TEXT NOT NULL,
        UNIQUE (chat_id, id)
      );

      INSERT INTO messages_next (id, chat_id, position, role, payload)
        SELECT id, chat_id, position, role, payload FROM messages;

      CREATE TABLE attachments_next (
        message_row_id INTEGER NOT NULL REFERENCES messages_next(row_id) ON DELETE CASCADE,
        position       INTEGER NOT NULL,
        name           TEXT NOT NULL,
        type           TEXT NOT NULL,
        blob_hash      TEXT NOT NULL,
        PRIMARY KEY (message_row_id, position)
      );

      INSERT INTO attachments_next (message_row_id, position, name, type, blob_hash)
        SELECT m.row_id, a.position, a.name, a.type, a.blob_hash
        FROM attachments a JOIN messages_next m ON m.id = a.message_id;

      DROP TABLE attachments;
      DROP TABLE messages;
      ALTER TABLE messages_next RENAME TO messages;
      ALTER TABLE attachments_next RENAME TO attachments;

      CREATE INDEX IF NOT EXISTS messages_by_chat ON messages(chat_id, position);
      CREATE INDEX IF NOT EXISTS attachments_by_blob ON attachments(blob_hash);
    "#;
