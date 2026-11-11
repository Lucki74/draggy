//! Checkpoint bytes on disk and the `CheckpointStore` the file tools use. Ports electron/checkpoints.cjs:
//! content addressed, so ten edits keep only the distinct versions.

use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use draggy_storage::{Checkpoint as Row, CheckpointInput, Storage};
use draggy_tools::files::{
    Action, Checkpoint, CheckpointStore, NewCheckpoint, Recycler, StoreError, content_hash,
};

fn is_hash(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit())
}

pub struct BlobStore {
    dir: PathBuf,
}

impl BlobStore {
    pub fn new(user_data: &Path) -> Self {
        Self {
            dir: user_data.join("checkpoints"),
        }
    }

    fn blob_path(&self, hash: &str) -> PathBuf {
        self.dir.join(&hash[..2]).join(hash)
    }

    /// Stores the bytes and returns their hash.
    pub fn keep(&self, bytes: &[u8]) -> io::Result<String> {
        let hash = content_hash(bytes);
        let target = self.blob_path(&hash);
        if !target.exists() {
            if let Some(shard) = target.parent() {
                fs::create_dir_all(shard)?;
            }
            // Written beside the blob and renamed in, so a crash never leaves half a file under a whole hash.
            let partial = target.with_extension(format!("{}.tmp", std::process::id()));
            fs::write(&partial, bytes)?;
            fs::rename(&partial, &target)?;
        }
        Ok(hash)
    }

    /// The bytes back, or None when they are gone or no longer match their name.
    pub fn read(&self, hash: &str) -> Option<Vec<u8>> {
        if !is_hash(hash) {
            return None;
        }
        let bytes = fs::read(self.blob_path(hash)).ok()?;
        (content_hash(&bytes) == hash).then_some(bytes)
    }

    /// Deletes every blob no checkpoint row names and returns how many went.
    pub fn collect(&self, used: &HashSet<String>) -> usize {
        let Ok(shards) = fs::read_dir(&self.dir) else {
            return 0;
        };
        let mut removed = 0;
        for shard in shards.flatten() {
            // A stray file at the top is not a shard.
            let Ok(entries) = fs::read_dir(shard.path()) else {
                continue;
            };
            for entry in entries.flatten() {
                let name = entry.file_name();
                if used.contains(name.to_string_lossy().as_ref()) {
                    continue;
                }
                if fs::remove_file(entry.path()).is_ok() {
                    removed += 1;
                }
            }
        }
        removed
    }
}

/// Checkpoint rows in the database, their bytes in the blob store.
pub struct Store {
    storage: Arc<Storage>,
    blobs: BlobStore,
}

impl Store {
    pub fn new(storage: Arc<Storage>, user_data: &Path) -> Self {
        Self {
            storage,
            blobs: BlobStore::new(user_data),
        }
    }
}

fn failed(error: impl std::fmt::Display) -> StoreError {
    StoreError(error.to_string())
}

fn action_of(name: &str) -> Result<Action, StoreError> {
    match name {
        "write" => Ok(Action::Write),
        "move" => Ok(Action::Move),
        "delete" => Ok(Action::Delete),
        other => Err(failed(format!("unknown checkpoint action {other}"))),
    }
}

fn checkpoint_from(row: Row) -> Result<Checkpoint, StoreError> {
    Ok(Checkpoint {
        id: row.id,
        entry: NewCheckpoint {
            workspace_id: row.workspace_id,
            chat_id: row.chat_id,
            path: PathBuf::from(row.path),
            action: action_of(&row.action)?,
            detail: row.detail,
            before_hash: row.before_hash,
            after_hash: row.after_hash,
        },
    })
}

impl CheckpointStore for Store {
    fn keep(&self, bytes: &[u8]) -> Result<String, StoreError> {
        self.blobs.keep(bytes).map_err(failed)
    }

    fn read(&self, hash: &str) -> Option<Vec<u8>> {
        self.blobs.read(hash)
    }

    fn add(&self, entry: &NewCheckpoint) -> Result<i64, StoreError> {
        self.storage
            .add_checkpoint(&CheckpointInput {
                workspace_id: Some(entry.workspace_id.clone()),
                chat_id: entry.chat_id.clone(),
                path: entry.path.to_string_lossy().into_owned(),
                action: Some(entry.action.as_str().to_owned()),
                detail: entry.detail.clone(),
                before_hash: entry.before_hash.clone(),
                after_hash: entry.after_hash.clone(),
                created_at: 0.0,
            })
            .map_err(failed)
    }

    fn get(&self, id: i64) -> Result<Option<Checkpoint>, StoreError> {
        self.storage
            .get_checkpoint(id)
            .map_err(failed)?
            .map(checkpoint_from)
            .transpose()
    }

    fn drop_checkpoint(&self, id: i64) -> Result<(), StoreError> {
        self.storage.drop_checkpoint(id).map_err(failed)
    }
}

/// Sends a file to the Windows recycle bin so a deletion can be taken back.
pub struct RecycleBin;

impl Recycler for RecycleBin {
    fn recycle(&self, path: &Path) -> io::Result<()> {
        trash::delete(path).map_err(|error| io::Error::other(error.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, BlobStore) {
        let dir = tempfile::tempdir().expect("tempdir");
        let blobs = BlobStore::new(dir.path());
        (dir, blobs)
    }

    #[test]
    fn keeps_content_and_reads_it_back_exactly() {
        let (_dir, blobs) = store();
        let bytes = [0u8, 255, 10, 13, 128];
        let hash = blobs.keep(&bytes).expect("keep");
        assert_eq!(blobs.read(&hash).as_deref(), Some(&bytes[..]));
        assert_eq!(blobs.keep(&bytes).expect("again"), hash);
    }

    #[test]
    fn leaves_no_partial_file_behind() {
        let (dir, blobs) = store();
        let hash = blobs.keep(b"hello").expect("keep");
        let shard = dir.path().join("checkpoints").join(&hash[..2]);
        let names: Vec<_> = fs::read_dir(shard)
            .expect("shard")
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec![hash]);
    }

    #[test]
    fn refuses_a_blob_that_no_longer_matches_its_hash() {
        let (_dir, blobs) = store();
        let hash = blobs.keep(b"original").expect("keep");
        fs::write(blobs.blob_path(&hash), b"tampered").expect("tamper");
        assert_eq!(blobs.read(&hash), None);
    }

    #[test]
    fn an_unknown_or_malformed_hash_reads_as_none() {
        let (_dir, blobs) = store();
        assert_eq!(blobs.read(&"0".repeat(64)), None);
        assert_eq!(blobs.read("../../etc"), None);
        assert_eq!(blobs.read(""), None);
    }

    #[test]
    fn collects_only_unreferenced_blobs() {
        let (_dir, blobs) = store();
        let used = blobs.keep(b"used").expect("keep");
        let spare = blobs.keep(b"spare").expect("keep");
        let removed = blobs.collect(&HashSet::from([used.clone()]));
        assert_eq!(removed, 1);
        assert!(blobs.read(&used).is_some());
        assert!(blobs.read(&spare).is_none());
    }

    #[test]
    fn skips_a_stray_file_at_the_store_top() {
        let (dir, blobs) = store();
        let used = blobs.keep(b"used").expect("keep");
        fs::write(dir.path().join("checkpoints").join("stray.txt"), b"x").expect("stray");
        assert_eq!(blobs.collect(&HashSet::from([used])), 0);
    }

    #[test]
    fn the_store_round_trips_a_checkpoint_row() {
        let dir = tempfile::tempdir().expect("tempdir");
        let storage = Arc::new(Storage::open(dir.path()).expect("open"));
        let store = Store::new(storage, dir.path());
        let before = store.keep(b"old").expect("keep");
        let id = store
            .add(&NewCheckpoint {
                workspace_id: "default".into(),
                chat_id: Some("c1".into()),
                path: PathBuf::from("a.txt"),
                action: Action::Write,
                detail: None,
                before_hash: Some(before.clone()),
                after_hash: None,
            })
            .expect("add");
        let got = store.get(id).expect("get").expect("row");
        assert_eq!(got.entry.action, Action::Write);
        assert_eq!(got.entry.before_hash, Some(before));
        store.drop_checkpoint(id).expect("drop");
        assert!(store.get(id).expect("get").is_none());
    }
}
