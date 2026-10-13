//! draggy-storage: chats, blobs, workspaces, checkpoints, statistics and settings in the Electron build's SQLite file.
//! Schema changes are additive, so the last Electron release can still open a database this crate wrote.

mod blobs;
mod chats;
mod checkpoints;
mod js;
mod kv;
mod metrics;
mod migrate;
pub mod onboarding;
mod recovery;
mod schema;
mod workspaces;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};

use rusqlite::Connection;

pub use chats::{Attachment, Chat, ChatSummary, Message, SearchHit, Stats};
pub use checkpoints::{Checkpoint, CheckpointInput};
pub use metrics::{Metric, MetricInput};
pub use schema::SCHEMA_VERSION;
pub use workspaces::{DEFAULT_WORKSPACE_ID, Workspace, WorkspaceKind};

/// A failed call. The messages of the two refusals are the ones the Electron build returns.
#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("database error: {0}")]
    Sql(#[from] rusqlite::Error),
    #[error("file error: {0}")]
    Io(#[from] std::io::Error),
    #[error("stored JSON could not be read: {0}")]
    Json(#[from] serde_json::Error),
    #[error("A workspace needs an id.")]
    WorkspaceIdMissing,
    #[error("The default workspace cannot be removed.")]
    DefaultWorkspace,
    #[error("A turn needs a model.")]
    MetricModelMissing,
    #[error("A message needs a role.")]
    MessageRoleMissing,
    #[error("A message role must be text or a number.")]
    MessageRoleInvalid,
    #[error("A chat needs a list of messages.")]
    MessagesMissing,
    /// The reference's refusal once the database is closed; the window sees it as a refused or empty answer.
    #[error("The chat database is not open.")]
    Closed,
}

/// An open database. Methods take `&self`; calls are serialised on one connection, as in the Electron build.
pub struct Storage {
    conn: Mutex<Connection>,
    blob_dir: PathBuf,
    closed: AtomicBool,
}

/// An existing database after the open steps, before the usability verdict decides whether to keep it.
struct Opened {
    conn: Connection,
    schema_before: Option<f64>,
    usable: bool,
}

impl Storage {
    /// Opens `draggy.db` under `user_data`, creating it if needed. A damaged file is set aside as
    /// `draggy.db.corrupt-<time>` and a fresh one is started with whatever could be rescued from it.
    pub fn open(user_data: &Path) -> Result<Self, StorageError> {
        let db_path = user_data.join("draggy.db");
        let blob_dir = user_data.join("blobs");
        std::fs::create_dir_all(&blob_dir)?;

        let (conn, schema_before, rebuilt) = match open_existing(&db_path) {
            Ok(Opened {
                conn,
                schema_before,
                usable: true,
            }) => (conn, schema_before, false),
            Ok(Opened { conn, .. }) => {
                drop(conn);
                (recovery::rebuild(&db_path)?, None, true)
            }
            Err(error) => {
                tracing::warn!(target: "storage.open", error = %error, "could not open the database");
                (recovery::rebuild(&db_path)?, None, true)
            }
        };

        let migrated =
            !rebuilt && schema_before.is_some_and(|version| version < SCHEMA_VERSION as f64);
        // After either path: a rebuilt database has the tables but no rows, and a rescued chat has no workspace.
        if let Err(error) = workspaces::ensure_default(&conn) {
            tracing::error!(target: "storage.open", error = %error, "could not prepare the default workspace");
        }
        let version = migrate::schema_version(&conn).ok().flatten();
        tracing::info!(target: "storage.open", schema_version = ?version, migrated, "storage opened");

        Ok(Self {
            conn: Mutex::new(conn),
            blob_dir,
            closed: AtomicBool::new(false),
        })
    }

    /// Closes the database and releases its file. Every later call is refused with `StorageError::Closed`,
    /// since a save from the window can still arrive once quitting has begun.
    pub fn close(&self) {
        let mut conn = self.conn.lock().unwrap_or_else(PoisonError::into_inner);
        self.closed.store(true, Ordering::SeqCst);
        if let Ok(placeholder) = Connection::open_in_memory() {
            drop(std::mem::replace(&mut *conn, placeholder));
        }
    }

    /// Whether `close` has run. Calls made after it never reach the connection.
    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }

    /// Refuses a call once closed, before any argument is checked, as the reference's closed answer comes first.
    fn ensure_open(&self) -> Result<(), StorageError> {
        self.lock().map(drop)
    }

    /// The connection, refused once closed. The flag is read under the lock, so a call that waited on a
    /// closing one cannot reach the placeholder connection that replaces it.
    fn lock(&self) -> Result<MutexGuard<'_, Connection>, StorageError> {
        let conn = self.conn.lock().unwrap_or_else(PoisonError::into_inner);
        if self.closed.load(Ordering::SeqCst) {
            return Err(StorageError::Closed);
        }
        Ok(conn)
    }

    /// Runs one write on the connection. A failure is logged once with its operation, then returned, as the
    /// reference's write wrapper logs and rethrows.
    fn write<T>(
        &self,
        op: &str,
        run: impl FnOnce(&mut Connection) -> Result<T, StorageError>,
    ) -> Result<T, StorageError> {
        let mut conn = self.lock()?;
        let result = run(&mut conn);
        if let Err(error) = &result {
            tracing::error!(target: "storage.write", op, code = error_code(error), error = %error, "write failed");
        }
        result
    }
}

/// The SQLite code behind a failed statement, or nothing for a failure that is not from SQLite.
fn error_code(error: &StorageError) -> String {
    match error {
        StorageError::Sql(rusqlite::Error::SqliteFailure(failure, _)) => {
            format!("{:?}", failure.code)
        }
        _ => String::new(),
    }
}

fn open_existing(db_path: &Path) -> Result<Opened, StorageError> {
    let mut conn = Connection::open(db_path)?;
    conn.execute_batch(schema::SCHEMA)?;
    let schema_before = migrate::schema_version(&conn)?;
    migrate::migrate(&mut conn)?;
    migrate::ensure_column(&conn, "chats", "compaction", "TEXT")?;
    migrate::ensure_column(&conn, "chats", "workspace_id", "TEXT")?;
    migrate::ensure_column(&conn, "chats", "plan", "TEXT")?;
    migrate::ensure_column(&conn, "workspaces", "grants", "TEXT")?;
    let usable = recovery::is_usable(&conn);
    Ok(Opened {
        conn,
        schema_before,
        usable,
    })
}
