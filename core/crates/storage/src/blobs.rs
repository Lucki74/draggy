//! Attachment bodies live in files named by their SHA-256, so the same image pasted twice is stored once.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, params};
use sha2::{Digest, Sha256};

use crate::{Storage, StorageError};

pub(crate) fn blob_path(blob_dir: &Path, hash: &str) -> PathBuf {
    blob_dir.join(hash.get(..2).unwrap_or(hash)).join(hash)
}

/// Stores `content` under its hash, writing the file only if it is missing, and records the row.
pub(crate) fn write_blob(
    conn: &Connection,
    blob_dir: &Path,
    content: &str,
) -> Result<String, StorageError> {
    let hash = hex::encode(Sha256::digest(content.as_bytes()));
    let target = blob_path(blob_dir, &hash);
    if !target.exists() {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&target, content)?;
    }
    conn.prepare_cached("INSERT OR IGNORE INTO blobs (hash, bytes) VALUES (?1, ?2)")?
        .execute(params![
            hash,
            i64::try_from(content.len()).unwrap_or(i64::MAX)
        ])?;
    Ok(hash)
}

/// The text of a blob. A missing file reads as empty: losing one attachment should not fail the chat.
pub(crate) fn read_blob(blob_dir: &Path, hash: &str) -> String {
    match fs::read(blob_path(blob_dir, hash)) {
        Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
        Err(error) => {
            tracing::debug!(target: "storage.blobs", error = %error, "blob unreadable, reads as empty");
            String::new()
        }
    }
}

/// Deletes blob files and rows no attachment references any more. A file that will not delete does not stop the rest.
pub(crate) fn collect_garbage(conn: &Connection, blob_dir: &Path) -> Result<usize, StorageError> {
    let orphans: Vec<String> = {
        let mut statement = conn.prepare(
            "SELECT hash FROM blobs WHERE hash NOT IN (SELECT blob_hash FROM attachments)",
        )?;
        statement
            .query_map([], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };

    for hash in &orphans {
        if let Err(error) = remove_if_present(&blob_path(blob_dir, hash)) {
            tracing::warn!(target: "storage.blobs", error = %error, "could not remove an orphaned blob");
        }
        conn.execute("DELETE FROM blobs WHERE hash = ?1", [hash])?;
    }
    Ok(orphans.len())
}

fn remove_if_present(path: &Path) -> std::io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

impl Storage {
    /// Removes blobs that no attachment points to any more, returning how many were removed.
    pub fn collect_garbage(&self) -> Result<usize, StorageError> {
        self.write("collectGarbage", |conn| {
            collect_garbage(conn, &self.blob_dir)
        })
    }
}
