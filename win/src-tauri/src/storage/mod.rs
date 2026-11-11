//! The chat database and what lives beside it, opened once at startup and shared through `AppState`.

pub mod backfill;
pub mod checkpoints;
pub mod onboarding;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use draggy_diagnostics::Diagnostics;
use draggy_storage::Storage;

/// A chat folder id: ASCII word characters and dashes, as electron/main.cjs `chatDirPath` accepts.
pub fn is_chat_id(id: &str) -> bool {
    (1..=128).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub struct Db {
    storage: Option<Arc<Storage>>,
    data_dir: PathBuf,
    show_setup: AtomicBool,
}

impl Db {
    /// Opens the database, recovers unrecorded metric turns and decides whether setup shows. A database
    /// that will not open is logged and every call is then refused, as the Electron build does.
    pub fn open(data_dir: &Path, diag: &Diagnostics) -> Self {
        let storage = match Storage::open(data_dir) {
            Ok(storage) => Some(Arc::new(storage)),
            Err(error) => {
                diag.error(
                    "storage",
                    &format!("chat database failed to open: {error}"),
                    None,
                );
                None
            }
        };
        if let Some(storage) = &storage {
            backfill::backfill_metrics(storage, data_dir, diag);
        }
        let show = storage
            .as_deref()
            .is_some_and(|storage| onboarding::decide(storage, data_dir, diag));
        Self {
            storage,
            data_dir: data_dir.to_path_buf(),
            show_setup: AtomicBool::new(show),
        }
    }

    /// The open database, or None when it never opened or has been closed.
    pub fn handle(&self) -> Option<Arc<Storage>> {
        self.storage
            .as_ref()
            .filter(|storage| !storage.is_closed())
            .cloned()
    }

    pub fn close(&self) {
        if let Some(storage) = &self.storage {
            storage.close();
        }
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn chats_root(&self) -> PathBuf {
        self.data_dir.join("chats")
    }

    /// The folder for one chat's files, or None for an id that could escape the chats folder.
    pub fn chat_dir(&self, id: &str) -> Option<PathBuf> {
        is_chat_id(id).then(|| self.chats_root().join(id))
    }

    pub fn show_setup(&self) -> bool {
        self.show_setup.load(Ordering::SeqCst)
    }

    pub fn set_show_setup(&self, show: bool) {
        self.show_setup.store(show, Ordering::SeqCst);
    }
}

#[cfg(test)]
pub(crate) fn test_diag(dir: &Path) -> Diagnostics {
    Diagnostics::open(
        dir.join("logs"),
        draggy_diagnostics::Config::from_env(|_| None, "test", 1, true, None),
        Arc::new(draggy_diagnostics::SystemClock::default()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_ids_are_ascii_words_and_dashes() {
        assert!(is_chat_id("chat-1_a"));
        assert!(!is_chat_id(""));
        assert!(!is_chat_id("../x"));
        assert!(!is_chat_id("a b"));
        assert!(!is_chat_id("\u{e9}"));
        assert!(!is_chat_id(&"a".repeat(129)));
        assert!(is_chat_id(&"a".repeat(128)));
    }

    #[test]
    fn chat_dir_is_under_the_chats_root() {
        let dir = tempfile::tempdir().expect("tempdir");
        let diag = test_diag(dir.path());
        let db = Db::open(dir.path(), &diag);
        assert_eq!(db.chat_dir("c1"), Some(dir.path().join("chats").join("c1")));
        assert_eq!(db.chat_dir("../c1"), None);
        db.close();
        assert!(db.handle().is_none());
    }
}
