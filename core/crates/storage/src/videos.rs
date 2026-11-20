//! Video files live beside the other blobs, but a chat attachment holds only a small `draggy-video:` reference to them.
//! The `video_index` row marks a stored video and later holds its segment index.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

use crate::blobs::{blob_path, read_blob};
use crate::js::now_millis;
use crate::{Storage, StorageError};

/// The prefix of a video attachment's content; JSON with the file's `hash` follows.
pub const VIDEO_REF_PREFIX: &str = "draggy-video:";
/// A video imported but never sent is kept this long, so a chat being written does not lose it to a GC.
const UNREFERENCED_GRACE_MS: i64 = 24 * 60 * 60 * 1000;

static INCOMING: AtomicU64 = AtomicU64::new(0);

/// A stored index and the algorithm version that built it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredVideoIndex {
    pub version: i64,
    pub json: String,
}

fn is_hash(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// Copies `reader` into the blob folder while hashing it, so a large video is never held in memory.
fn store_stream(
    conn: &Connection,
    blob_dir: &Path,
    reader: &mut dyn Read,
) -> Result<(String, u64), StorageError> {
    let nanos = now_millis();
    let temp = blob_dir.join(format!(
        "incoming-{nanos}-{}",
        INCOMING.fetch_add(1, Ordering::Relaxed)
    ));
    let copied = (|| {
        let mut out = File::create(&temp)?;
        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; 1 << 20];
        let mut total = 0u64;
        loop {
            let count = reader.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
            out.write_all(&buffer[..count])?;
            total += count as u64;
        }
        out.sync_all()?;
        Ok::<_, std::io::Error>((hex::encode(hasher.finalize()), total))
    })();
    let (hash, total) = match copied {
        Ok(done) => done,
        Err(error) => {
            let _ = fs::remove_file(&temp);
            return Err(error.into());
        }
    };
    let target = blob_path(blob_dir, &hash);
    if target.exists() {
        fs::remove_file(&temp)?;
    } else {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(&temp, &target)?;
    }
    conn.prepare_cached(
        "INSERT OR IGNORE INTO video_index (hash, version, json, created_at) VALUES (?1, 0, NULL, ?2)",
    )?
    .execute(params![hash, now_millis()])?;
    Ok((hash, total))
}

/// Hashes named by video attachments that are still in some chat.
fn referenced_videos(conn: &Connection, blob_dir: &Path) -> Result<Vec<String>, StorageError> {
    let refs: Vec<String> = {
        let mut statement =
            conn.prepare("SELECT DISTINCT blob_hash FROM attachments WHERE type LIKE 'video/%'")?;
        statement
            .query_map([], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    Ok(refs
        .iter()
        .filter_map(|blob| video_hash_of(&read_blob(blob_dir, blob)))
        .collect())
}

/// The file hash inside a `draggy-video:` reference.
pub fn video_hash_of(content: &str) -> Option<String> {
    let json = content.strip_prefix(VIDEO_REF_PREFIX)?;
    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    let hash = value.get("hash")?.as_str()?;
    is_hash(hash).then(|| hash.to_owned())
}

/// Removes videos no attachment references once their grace period is over, with their index rows.
pub(crate) fn collect_video_garbage(
    conn: &Connection,
    blob_dir: &Path,
) -> Result<usize, StorageError> {
    let keep = referenced_videos(conn, blob_dir)?;
    let cutoff = now_millis() - UNREFERENCED_GRACE_MS;
    let stale: Vec<String> = {
        let mut statement = conn.prepare("SELECT hash FROM video_index WHERE created_at < ?1")?;
        statement
            .query_map([cutoff], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut removed = 0;
    for hash in stale.iter().filter(|hash| !keep.contains(hash)) {
        match fs::remove_file(blob_path(blob_dir, hash)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                tracing::warn!(target: "storage.videos", error = %error, "could not remove an orphaned video");
                continue;
            }
        }
        conn.execute("DELETE FROM video_index WHERE hash = ?1", [hash])?;
        removed += 1;
    }
    Ok(removed)
}

impl Storage {
    /// Copies a video file into the blob store and returns its hash and size.
    pub fn import_video(&self, source: &Path) -> Result<(String, u64), StorageError> {
        let mut file = File::open(source)?;
        self.write("importVideo", |conn| {
            store_stream(conn, &self.blob_dir, &mut file)
        })
    }

    /// The same for bytes that came without a path, such as a paste.
    pub fn import_video_bytes(&self, bytes: &[u8]) -> Result<(String, u64), StorageError> {
        let mut reader = bytes;
        self.write("importVideoBytes", |conn| {
            store_stream(conn, &self.blob_dir, &mut reader)
        })
    }

    /// Where a stored video lives, or nothing when the hash is unknown or its file is gone.
    pub fn video_path(&self, hash: &str) -> Result<Option<PathBuf>, StorageError> {
        if !is_hash(hash) {
            return Ok(None);
        }
        let conn = self.lock()?;
        let known = conn
            .prepare_cached("SELECT 1 FROM video_index WHERE hash = ?1")?
            .query_row([hash], |_| Ok(()))
            .optional()?
            .is_some();
        let path = blob_path(&self.blob_dir, hash);
        Ok((known && path.is_file()).then_some(path))
    }

    pub fn get_video_index(&self, hash: &str) -> Result<Option<StoredVideoIndex>, StorageError> {
        let conn = self.lock()?;
        let row = conn
            .prepare_cached(
                "SELECT version, json FROM video_index WHERE hash = ?1 AND json IS NOT NULL",
            )?
            .query_row([hash], |row| {
                Ok(StoredVideoIndex {
                    version: row.get(0)?,
                    json: row.get(1)?,
                })
            })
            .optional()?;
        Ok(row)
    }

    pub fn put_video_index(
        &self,
        hash: &str,
        version: i64,
        json: &str,
    ) -> Result<(), StorageError> {
        self.write("putVideoIndex", |conn| {
            conn.prepare_cached(
                "INSERT INTO video_index (hash, version, json, created_at) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(hash) DO UPDATE SET version = excluded.version, json = excluded.json",
            )?
            .execute(params![hash, version, json, now_millis()])?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blobs::write_blob;

    fn attach(storage: &Storage, hash: &str) {
        let conn = storage.lock().expect("open");
        conn.execute_batch(
            "INSERT INTO chats (id, title, updated_at) VALUES ('c', 't', 0);
             INSERT INTO messages (id, chat_id, position, role, payload) VALUES ('m', 'c', 0, 'user', '{}');",
        )
        .expect("chat");
        let content = format!("{VIDEO_REF_PREFIX}{{\"hash\":\"{hash}\"}}");
        let blob = write_blob(&conn, &storage.blob_dir, &content).expect("ref");
        conn.execute(
            "INSERT INTO attachments (message_row_id, position, name, type, blob_hash)
             VALUES ((SELECT row_id FROM messages), 0, 'a.mp4', 'video/mp4', ?1)",
            [blob],
        )
        .expect("attachment");
    }

    fn backdate(storage: &Storage) {
        let conn = storage.lock().expect("open");
        conn.execute("UPDATE video_index SET created_at = 0", [])
            .expect("backdates");
    }

    #[test]
    fn stores_indexes_and_collects_videos() {
        let dir = tempfile::tempdir().expect("temp");
        let storage = Storage::open(dir.path()).expect("opens");
        let (kept, size) = storage.import_video_bytes(b"kept video").expect("imports");
        assert_eq!(size, 10);
        let (dropped, _) = storage
            .import_video_bytes(b"dropped video")
            .expect("imports");
        let (fresh, _) = storage.import_video_bytes(b"fresh video").expect("imports");
        assert!(storage.video_path(&kept).expect("path").is_some());

        storage
            .put_video_index(&kept, 1, "{\"segments\":[]}")
            .expect("puts");
        let stored = storage.get_video_index(&kept).expect("gets").expect("row");
        assert_eq!(stored.version, 1);
        assert!(storage.get_video_index(&dropped).expect("gets").is_none());

        attach(&storage, &kept);
        backdate(&storage);
        let (_, _) = storage.import_video_bytes(b"fresh video").expect("again");
        {
            let conn = storage.lock().expect("open");
            conn.execute(
                "UPDATE video_index SET created_at = ?1 WHERE hash = ?2",
                params![now_millis(), fresh],
            )
            .expect("refresh");
        }
        storage.collect_garbage().expect("collects");
        assert!(storage.video_path(&kept).expect("path").is_some());
        assert!(storage.get_video_index(&kept).expect("gets").is_some());
        assert!(storage.video_path(&dropped).expect("path").is_none());
        assert!(!blob_path(&storage.blob_dir, &dropped).exists());
        assert!(storage.video_path(&fresh).expect("path").is_some());
    }

    #[test]
    fn reads_the_hash_from_a_reference() {
        let hash = "a".repeat(64);
        let content = format!("{VIDEO_REF_PREFIX}{{\"kind\":\"video\",\"hash\":\"{hash}\"}}");
        assert_eq!(video_hash_of(&content), Some(hash));
        assert_eq!(video_hash_of("draggy-video:{\"hash\":\"../x\"}"), None);
        assert_eq!(video_hash_of("data:video/mp4;base64,AAAA"), None);
    }
}
