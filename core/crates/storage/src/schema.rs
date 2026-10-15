//! The schema, copied from electron/storage.cjs so both apps create and read the same file.
//! Changes here must be additive: the last Electron release has to keep opening the database.

/// The version the kv row `schema_version` records. The Electron build reads that row, not `PRAGMA user_version`.
pub const SCHEMA_VERSION: i64 = 4;

/// Idempotent: every statement is `IF NOT EXISTS`, so running it on an open database changes nothing.
pub(crate) const SCHEMA: &str = r#"
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS workspaces (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    kind            TEXT NOT NULL DEFAULT 'chat',
    root_path       TEXT,
    permission_mode TEXT NOT NULL DEFAULT 'ask',
    settings        TEXT,
    grants          TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chats (
    id                TEXT PRIMARY KEY,
    title             TEXT NOT NULL,
    updated_at        INTEGER NOT NULL,
    is_out_of_context INTEGER NOT NULL DEFAULT 0,
    compaction        TEXT,
    workspace_id      TEXT,
    plan              TEXT
  );

  CREATE TABLE IF NOT EXISTS messages (
    row_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    id       TEXT NOT NULL,
    chat_id  TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    role     TEXT NOT NULL,
    payload  TEXT NOT NULL,
    UNIQUE (chat_id, id)
  );

  CREATE INDEX IF NOT EXISTS messages_by_chat ON messages(chat_id, position);

  CREATE TABLE IF NOT EXISTS attachments (
    message_row_id INTEGER NOT NULL REFERENCES messages(row_id) ON DELETE CASCADE,
    position       INTEGER NOT NULL,
    name           TEXT NOT NULL,
    type           TEXT NOT NULL,
    blob_hash      TEXT NOT NULL,
    PRIMARY KEY (message_row_id, position)
  );

  CREATE INDEX IF NOT EXISTS attachments_by_blob ON attachments(blob_hash);

  CREATE TABLE IF NOT EXISTS blobs (
    hash  TEXT PRIMARY KEY,
    bytes INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS checkpoints (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    chat_id      TEXT,
    path         TEXT NOT NULL,
    action       TEXT NOT NULL,
    detail       TEXT,
    before_hash  TEXT,
    after_hash   TEXT,
    created_at   INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS checkpoints_by_workspace
    ON checkpoints(workspace_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS metrics (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_at     INTEGER NOT NULL,
    workspace_id    TEXT,
    chat_id         TEXT,
    model           TEXT NOT NULL,
    prompt_tokens   INTEGER NOT NULL DEFAULT 0,
    response_tokens INTEGER NOT NULL DEFAULT 0,
    response_ms     REAL NOT NULL DEFAULT 0,
    first_token_ms  REAL,
    load_ms         REAL NOT NULL DEFAULT 0,
    task_ms         REAL NOT NULL DEFAULT 0,
    loops           INTEGER NOT NULL DEFAULT 1,
    tools           TEXT
  );

  CREATE INDEX IF NOT EXISTS metrics_by_time ON metrics(recorded_at DESC);

  CREATE VIRTUAL TABLE IF NOT EXISTS message_search
    USING fts5(chat_id UNINDEXED, message_id UNINDEXED, body);
"#;
