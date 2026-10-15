//! Key-value settings. Values are text; the Electron build stores JSON in them and so does this crate.

use rusqlite::{OptionalExtension, params};

use crate::{Storage, StorageError};

impl Storage {
    pub fn get_value(&self, key: &str) -> Result<Option<String>, StorageError> {
        let conn = self.lock()?;
        conn.query_row("SELECT value FROM kv WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .optional()
        .map_err(StorageError::from)
    }

    pub fn set_value(&self, key: &str, value: &str) -> Result<(), StorageError> {
        self.write("setValue", |conn| {
            conn.execute(
                "INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )?;
            Ok(())
        })
    }
}
