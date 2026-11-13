//! The library database: sources, files, passages with embeddings, and the keyword index.

use std::collections::HashMap;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, Result, params};
use serde_json::{Value, json};

use super::chunk::{Chunk, Fused, Matrix, from_blob, to_search_query};

pub const DEFAULT_WORKSPACE: &str = "default";
pub const DEFAULT_EMBED_MODEL: &str = "nomic-embed-text";
pub const MAX_INDEXED_CHUNKS: i64 = 60000;

const SCHEMA: &str = "
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS library_sources (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    path         TEXT NOT NULL UNIQUE,
    added_at     INTEGER NOT NULL,
    workspace_id TEXT
  );

  CREATE TABLE IF NOT EXISTS library_files (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id  INTEGER NOT NULL REFERENCES library_sources(id) ON DELETE CASCADE,
    path       TEXT NOT NULL UNIQUE,
    mtime      INTEGER NOT NULL,
    size       INTEGER NOT NULL,
    chunks     INTEGER NOT NULL DEFAULT 0,
    indexed_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS library_chunks (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id   INTEGER NOT NULL REFERENCES library_files(id) ON DELETE CASCADE,
    position  INTEGER NOT NULL,
    heading   TEXT NOT NULL DEFAULT '',
    text      TEXT NOT NULL,
    embedding BLOB NOT NULL
  );

  CREATE INDEX IF NOT EXISTS chunks_by_file ON library_chunks(file_id);

  CREATE TABLE IF NOT EXISTS library_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS library_search
    USING fts5(text, chunk_id UNINDEXED, source_id UNINDEXED);
";

/// The stored file row the indexer compares a disk file against.
pub struct FileRow {
    pub id: i64,
    pub mtime: i64,
    pub size: i64,
    pub chunks: i64,
}

/// A passage found by search, with the cosine score when the vector arm found it.
pub struct Hit {
    pub id: i64,
    pub heading: String,
    pub text: String,
    pub path: String,
    pub source_id: i64,
    pub score: f64,
}

pub struct Store {
    conn: Connection,
    matrix: Option<Matrix>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_millis() as i64)
}

fn round4(value: f64) -> f64 {
    (value * 10000.0).round() / 10000.0
}

fn basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Deletes a file's keyword rows, then the file (chunks go by cascade).
fn remove_file_rows(conn: &Connection, file_id: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM library_search WHERE chunk_id IN (SELECT id FROM library_chunks WHERE file_id = ?1)",
        params![file_id],
    )?;
    conn.execute("DELETE FROM library_files WHERE id = ?1", params![file_id])?;
    Ok(())
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        Self::init(Connection::open(path)?)
    }

    #[cfg(test)]
    pub fn open_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    /// The shared connection, for the research tables that live beside the index.
    pub(crate) fn conn(&self) -> &Connection {
        &self.conn
    }

    pub(crate) fn conn_mut(&mut self) -> &mut Connection {
        &mut self.conn
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.execute_batch(SCHEMA)?;
        let started = std::time::Instant::now();
        if let Err(error) = super::research::init(&conn) {
            tracing::error!(target: super::research::SCOPE, error = %error, "schema setup failed");
            return Err(error);
        }
        tracing::debug!(
            target: super::research::SCOPE,
            dur_ms = started.elapsed().as_millis() as u64,
            "schema ready"
        );
        let store = Self { conn, matrix: None };
        store.conn.execute(
            "UPDATE library_sources SET workspace_id = ?1 WHERE workspace_id IS NULL",
            params![DEFAULT_WORKSPACE],
        )?;
        store.conn.execute(
            "DELETE FROM library_search WHERE chunk_id NOT IN (SELECT id FROM library_chunks)",
            [],
        )?;
        store.conn.execute(
            "INSERT INTO library_search (chunk_id, source_id, text)
             SELECT c.id, f.source_id,
                    CASE WHEN c.heading <> '' THEN c.heading || ' ' || c.text ELSE c.text END
             FROM library_chunks c
             JOIN library_files f ON f.id = c.file_id
             WHERE c.id NOT IN (SELECT chunk_id FROM library_search)",
            [],
        )?;
        Ok(store)
    }

    pub fn meta(&self, key: &str) -> Result<Option<String>> {
        self.conn
            .query_row(
                "SELECT value FROM library_meta WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO library_meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn ensure_source(&self, path: &str, workspace: &str) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO library_sources (path, added_at, workspace_id) VALUES (?1, ?2, ?3)
             ON CONFLICT(path) DO NOTHING",
            params![path, now_ms(), workspace],
        )?;
        self.conn.query_row(
            "SELECT id FROM library_sources WHERE path = ?1",
            params![path],
            |row| row.get(0),
        )
    }

    pub fn existing_files(&self, source_id: i64) -> Result<HashMap<String, FileRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, mtime, size, chunks FROM library_files WHERE source_id = ?1",
        )?;
        let rows = stmt.query_map(params![source_id], |row| {
            Ok((
                row.get::<_, String>(1)?,
                FileRow {
                    id: row.get(0)?,
                    mtime: row.get(2)?,
                    size: row.get(3)?,
                    chunks: row.get(4)?,
                },
            ))
        })?;
        rows.collect()
    }

    pub fn total_chunks(&self) -> Result<i64> {
        self.conn
            .query_row("SELECT COUNT(*) FROM library_chunks", [], |row| row.get(0))
    }

    /// Replaces a file's rows with the new passages and their vectors, in one transaction.
    #[allow(clippy::too_many_arguments)]
    pub fn write_file(
        &mut self,
        source_id: i64,
        path: &str,
        mtime: i64,
        size: i64,
        chunks: &[Chunk],
        vectors: &[Vec<f32>],
        existing: Option<i64>,
    ) -> Result<()> {
        let tx = self.conn.transaction()?;
        if let Some(old) = existing {
            remove_file_rows(&tx, old)?;
        }
        tx.execute(
            "INSERT INTO library_files (source_id, path, mtime, size, chunks, indexed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![source_id, path, mtime, size, chunks.len() as i64, now_ms()],
        )?;
        let file_id = tx.last_insert_rowid();
        for (position, (chunk, vector)) in chunks.iter().zip(vectors).enumerate() {
            tx.execute(
                "INSERT INTO library_chunks (file_id, position, heading, text, embedding)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    file_id,
                    position as i64,
                    chunk.heading,
                    chunk.text,
                    super::chunk::to_blob(vector)
                ],
            )?;
            let chunk_id = tx.last_insert_rowid();
            // The heading goes in with the body so a passage under "Payment terms" matches those words.
            let searchable = if chunk.heading.is_empty() {
                chunk.text.clone()
            } else {
                format!("{} {}", chunk.heading, chunk.text)
            };
            tx.execute(
                "INSERT INTO library_search (chunk_id, source_id, text) VALUES (?1, ?2, ?3)",
                params![chunk_id, source_id, searchable],
            )?;
        }
        tx.commit()?;
        self.matrix = None;
        Ok(())
    }

    pub fn drop_file(&mut self, file_id: i64) -> Result<()> {
        remove_file_rows(&self.conn, file_id)?;
        self.matrix = None;
        Ok(())
    }

    pub fn list_sources(&self, workspace: Option<&str>) -> Result<Vec<Value>> {
        let filter = match workspace {
            None | Some("") => "",
            Some(DEFAULT_WORKSPACE) => "WHERE s.workspace_id = ?1 OR s.workspace_id IS NULL",
            Some(_) => "WHERE s.workspace_id = ?1",
        };
        let sql = format!(
            "SELECT s.id, s.path, s.added_at, s.workspace_id,
                    (SELECT COUNT(*) FROM library_files f WHERE f.source_id = s.id) AS files,
                    (SELECT COALESCE(SUM(f.chunks), 0) FROM library_files f WHERE f.source_id = s.id) AS chunks
             FROM library_sources s {filter} ORDER BY s.added_at ASC"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let map = |row: &rusqlite::Row| -> Result<Value> {
            let workspace_id: Option<String> = row.get(3)?;
            Ok(json!({
                "id": row.get::<_, i64>(0)?,
                "path": row.get::<_, String>(1)?,
                "addedAt": row.get::<_, i64>(2)?,
                "workspaceId": workspace_id.filter(|w| !w.is_empty()).unwrap_or_else(|| DEFAULT_WORKSPACE.to_owned()),
                "files": row.get::<_, i64>(4)?,
                "chunks": row.get::<_, i64>(5)?,
            }))
        };
        let rows = match workspace {
            None | Some("") => stmt.query_map([], map)?,
            Some(wanted) => stmt.query_map(params![wanted], map)?,
        };
        rows.collect()
    }

    pub fn stats(&self, ceiling: i64) -> Result<Value> {
        let count = |sql: &str| -> Result<i64> { self.conn.query_row(sql, [], |row| row.get(0)) };
        Ok(json!({
            "sources": count("SELECT COUNT(*) FROM library_sources")?,
            "files": count("SELECT COUNT(*) FROM library_files")?,
            "chunks": self.total_chunks()?,
            "embedModel": self.meta("embed_model")?.unwrap_or_else(|| DEFAULT_EMBED_MODEL.to_owned()),
            "ceiling": ceiling,
        }))
    }

    pub fn remove_source(&mut self, id: i64) -> Result<()> {
        self.conn.execute(
            "DELETE FROM library_search WHERE source_id = ?1",
            params![id],
        )?;
        self.conn
            .execute("DELETE FROM library_sources WHERE id = ?1", params![id])?;
        self.matrix = None;
        Ok(())
    }

    pub fn clear(&mut self) -> Result<()> {
        self.conn
            .execute_batch("DELETE FROM library_search; DELETE FROM library_sources;")?;
        self.matrix = None;
        Ok(())
    }

    /// The sources a workspace may search: Chat's own and pre-workspace ones, or a project's own.
    pub fn scope_ids(&self, workspace: &str) -> Result<Vec<i64>> {
        let (sql, wanted) = if workspace.is_empty() || workspace == DEFAULT_WORKSPACE {
            (
                "SELECT id FROM library_sources WHERE workspace_id = ?1 OR workspace_id IS NULL",
                DEFAULT_WORKSPACE,
            )
        } else {
            (
                "SELECT id FROM library_sources WHERE workspace_id = ?1",
                workspace,
            )
        };
        let mut stmt = self.conn.prepare(sql)?;
        let ids = stmt.query_map(params![wanted], |row| row.get(0))?;
        ids.collect()
    }

    /// Finds a source by folder name or path. An ambiguous name matches nothing.
    pub fn resolve_source(&self, name: &str) -> Result<Option<i64>> {
        let wanted = name.trim().to_lowercase();
        if wanted.is_empty() {
            return Ok(None);
        }
        let mut stmt = self.conn.prepare("SELECT id, path FROM library_sources")?;
        let rows: Vec<(i64, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<_>>()?;
        let matches: Vec<i64> = rows
            .into_iter()
            .filter(|(_, path)| {
                let full = path.to_lowercase();
                full == wanted || basename(&full).contains(&wanted) || full.contains(&wanted)
            })
            .map(|(id, _)| id)
            .collect();
        Ok(if matches.len() == 1 {
            Some(matches[0])
        } else {
            None
        })
    }

    /// The matrix of every vector, built on first use after a write. Rows of another width are skipped.
    pub fn matrix(&mut self) -> Result<&Matrix> {
        if self.matrix.is_none() {
            let built = self.build_matrix()?;
            self.matrix = Some(built);
        }
        match &self.matrix {
            Some(matrix) => Ok(matrix),
            None => unreachable!("matrix was just built"),
        }
    }

    fn build_matrix(&self) -> Result<Matrix> {
        let mut stmt = self.conn.prepare(
            "SELECT c.id, c.embedding, f.source_id
             FROM library_chunks c JOIN library_files f ON f.id = c.file_id
             ORDER BY c.id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Vec<u8>>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;
        let mut matrix = Matrix::default();
        for row in rows {
            let (id, blob, source) = row?;
            let vector = from_blob(&blob);
            if matrix.dim == 0 {
                matrix.dim = vector.len();
            }
            if vector.len() != matrix.dim {
                continue;
            }
            matrix.data.extend_from_slice(&vector);
            matrix.ids.push(id);
            matrix.sources.push(source);
        }
        Ok(matrix)
    }

    /// Keyword hits best first. A query the keyword arm cannot run returns nothing rather than failing.
    pub fn keyword_candidates(&self, term: &str, source: Option<i64>, depth: usize) -> Vec<i64> {
        let Some(query) = to_search_query(term) else {
            return Vec::new();
        };
        let depth = depth as i64;
        let found = self.run_keyword(&query, source, depth);
        found.unwrap_or_default()
    }

    fn run_keyword(&self, query: &str, source: Option<i64>, depth: i64) -> Result<Vec<i64>> {
        let mut stmt = self.conn.prepare(
            "SELECT chunk_id FROM library_search
             WHERE library_search MATCH ?1 AND (?2 IS NULL OR source_id = ?2)
             ORDER BY rank LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![query, source, depth], |row| row.get(0))?;
        rows.collect()
    }

    /// Fetches the passages for fused results, scored as the reader sees them (cosine when known).
    pub fn hydrate(&self, ranked: &[Fused]) -> Result<Vec<Hit>> {
        let mut stmt = self.conn.prepare(
            "SELECT c.id, c.heading, c.text, f.path, f.source_id
             FROM library_chunks c JOIN library_files f ON f.id = c.file_id
             WHERE c.id = ?1",
        )?;
        let mut hits = Vec::new();
        for entry in ranked {
            let row = stmt
                .query_row(params![entry.id], |row| {
                    Ok(Hit {
                        id: row.get(0)?,
                        heading: row.get(1)?,
                        text: row.get(2)?,
                        path: row.get(3)?,
                        source_id: row.get(4)?,
                        score: 0.0,
                    })
                })
                .optional()?;
            if let Some(mut hit) = row {
                hit.score = round4(entry.similarity.unwrap_or(entry.score));
                hits.push(hit);
            }
        }
        Ok(hits)
    }
}

impl Hit {
    pub fn to_json(&self) -> Value {
        json!({
            "id": self.id,
            "heading": self.heading,
            "text": self.text,
            "path": self.path,
            "sourceId": self.source_id,
            "name": basename(&self.path),
            "score": self.score,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_written_file_is_found_by_keyword_and_removed_with_its_source() {
        let mut store = Store::open_memory().expect("open");
        let source = store
            .ensure_source("C:/docs", DEFAULT_WORKSPACE)
            .expect("source");
        let chunks = vec![Chunk {
            heading: "Payment terms".to_owned(),
            text: "Net thirty days.".to_owned(),
        }];
        store
            .write_file(
                source,
                "C:/docs/a.md",
                1,
                10,
                &chunks,
                &[vec![1.0, 0.0]],
                None,
            )
            .expect("write");
        assert_eq!(store.total_chunks().expect("count"), 1);
        assert_eq!(
            store.keyword_candidates("payment", Some(source), 5).len(),
            1
        );
        assert_eq!(store.matrix().expect("matrix").dim, 2);
        store.remove_source(source).expect("remove");
        assert_eq!(store.total_chunks().expect("count"), 0);
        assert!(store.list_sources(None).expect("list").is_empty());
    }

    #[test]
    fn a_project_scope_does_not_see_chat_sources() {
        let store = Store::open_memory().expect("open");
        store
            .ensure_source("C:/chat", DEFAULT_WORKSPACE)
            .expect("chat");
        store.ensure_source("C:/proj", "project-1").expect("proj");
        assert_eq!(store.scope_ids("project-1").expect("scope").len(), 1);
        assert_eq!(store.scope_ids("default").expect("scope").len(), 1);
    }
}
