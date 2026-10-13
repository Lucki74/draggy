//! Checkpoints: a record of each file Draggy changed, with the hashes of its content before and after.

use rusqlite::{OptionalExtension, Row, params};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

use crate::js::{
    de_number, de_optional_text, de_text, is_truthy, now_millis, ser_number, sqlite_real_text,
};
use crate::workspaces::DEFAULT_WORKSPACE_ID;
use crate::{Storage, StorageError};

/// The most checkpoints a listing returns unless asked for fewer.
const DEFAULT_LIMIT: i64 = 100;

/// What to record. Fields the reference defaults (`||`) are optional here, so the default applies only to a
/// missing or falsy value, as it does there.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointInput {
    #[serde(default, deserialize_with = "de_optional_text")]
    pub workspace_id: Option<String>,
    #[serde(default, deserialize_with = "de_optional_text")]
    pub chat_id: Option<String>,
    #[serde(default, deserialize_with = "de_text")]
    pub path: String,
    #[serde(default, deserialize_with = "de_optional_text")]
    pub action: Option<String>,
    #[serde(default, deserialize_with = "de_optional_text")]
    pub detail: Option<String>,
    #[serde(default, deserialize_with = "de_hash")]
    pub before_hash: Option<String>,
    #[serde(default, deserialize_with = "de_hash")]
    pub after_hash: Option<String>,
    #[serde(default, deserialize_with = "de_number")]
    pub created_at: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub id: i64,
    pub workspace_id: String,
    pub chat_id: Option<String>,
    pub path: String,
    pub action: String,
    pub detail: Option<String>,
    pub before_hash: Option<String>,
    pub after_hash: Option<String>,
    #[serde(serialize_with = "ser_number")]
    pub created_at: f64,
}

const COLUMNS: &str =
    "id, workspace_id, chat_id, path, action, detail, before_hash, after_hash, created_at";

impl Storage {
    /// Records a change and returns the checkpoint's id.
    pub fn add_checkpoint(&self, entry: &CheckpointInput) -> Result<i64, StorageError> {
        let workspace_id = entry
            .workspace_id
            .as_deref()
            .unwrap_or(DEFAULT_WORKSPACE_ID);
        let action = entry.action.as_deref().unwrap_or("write");
        let created_at = if entry.created_at.is_nan() || entry.created_at == 0.0 {
            now_millis() as f64
        } else {
            entry.created_at
        };

        self.write("addCheckpoint", |conn| {
            conn.prepare_cached(
                "INSERT INTO checkpoints (workspace_id, chat_id, path, action, detail, before_hash, after_hash, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )?
            .execute(params![
                workspace_id,
                entry.chat_id,
                entry.path,
                action,
                entry.detail,
                entry.before_hash,
                entry.after_hash,
                created_at
            ])?;
            Ok(conn.last_insert_rowid())
        })
    }

    pub fn get_checkpoint(&self, id: i64) -> Result<Option<Checkpoint>, StorageError> {
        let conn = self.lock()?;
        conn.query_row(
            &format!("SELECT {COLUMNS} FROM checkpoints WHERE id = ?1"),
            [id],
            checkpoint_from_row,
        )
        .optional()
        .map_err(StorageError::from)
    }

    /// Newest first, then by id. A limit of zero means the default.
    pub fn list_checkpoints(
        &self,
        workspace_id: &str,
        limit: i64,
    ) -> Result<Vec<Checkpoint>, StorageError> {
        let limit = if limit == 0 { DEFAULT_LIMIT } else { limit };
        let conn = self.lock()?;
        let mut statement = conn.prepare_cached(&format!(
            "SELECT {COLUMNS} FROM checkpoints WHERE workspace_id = ?1
             ORDER BY created_at DESC, id DESC LIMIT ?2"
        ))?;
        let rows = statement
            .query_map(params![workspace_id, limit], checkpoint_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn drop_checkpoint(&self, id: i64) -> Result<(), StorageError> {
        self.write("dropCheckpoint", |conn| {
            conn.execute("DELETE FROM checkpoints WHERE id = ?1", [id])?;
            Ok(())
        })
    }

    /// Every blob hash a checkpoint still points at, for the store's own cleanup. Each hash appears once.
    pub fn checkpoint_hashes(&self) -> Result<Vec<String>, StorageError> {
        let conn = self.lock()?;
        let mut statement = conn.prepare_cached(
            "SELECT before_hash AS hash FROM checkpoints WHERE before_hash IS NOT NULL
             UNION SELECT after_hash FROM checkpoints WHERE after_hash IS NOT NULL",
        )?;
        let hashes = statement
            .query_map([], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(hashes)
    }
}

/// A hash the way the reference binds it: a falsy value is none, text is kept, and a number is stored as
/// its REAL text. Anything else cannot be bound, so the record is refused.
fn de_hash<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    let value = Value::deserialize(deserializer)?;
    if !is_truthy(&value) {
        return Ok(None);
    }
    match value {
        Value::String(text) => Ok(Some(text)),
        Value::Number(number) => Ok(number.as_f64().map(sqlite_real_text)),
        _ => Err(serde::de::Error::custom("a hash must be text or a number")),
    }
}

fn checkpoint_from_row(row: &Row<'_>) -> rusqlite::Result<Checkpoint> {
    Ok(Checkpoint {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        chat_id: row
            .get::<_, Option<String>>(2)?
            .filter(|text| !text.is_empty()),
        path: row.get(3)?,
        action: row.get(4)?,
        detail: row
            .get::<_, Option<String>>(5)?
            .filter(|text| !text.is_empty()),
        before_hash: row
            .get::<_, Option<String>>(6)?
            .filter(|text| !text.is_empty()),
        after_hash: row
            .get::<_, Option<String>>(7)?
            .filter(|text| !text.is_empty()),
        created_at: row.get(8)?,
    })
}
