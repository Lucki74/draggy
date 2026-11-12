//! The research library: finished runs with their sources, page snapshots and notes.
//! Table and column names match what Electron-era builds wrote, so a library is portable.

use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

use crate::{Storage, StorageError};

const DAY_MS: i64 = 24 * 60 * 60 * 1000;

/// Created on first use, not at open, so opening a database leaves the shared schema as it is.
const RESEARCH_SCHEMA: &str = r#"
  CREATE TABLE IF NOT EXISTS research_runs (
    id             TEXT PRIMARY KEY,
    workspace_id   TEXT,
    chat_id        TEXT,
    question       TEXT NOT NULL,
    depth          TEXT NOT NULL,
    status         TEXT NOT NULL,
    plan_json      TEXT NOT NULL,
    started_at     INTEGER NOT NULL,
    ended_at       INTEGER,
    budget_used    REAL NOT NULL DEFAULT 0,
    hosts_json     TEXT NOT NULL DEFAULT '[]',
    report_ref     TEXT
  );

  CREATE TABLE IF NOT EXISTS research_snapshots (
    hash          TEXT PRIMARY KEY,
    markdown      TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS research_sources (
    id            TEXT NOT NULL,
    run_id        TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    url           TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    title         TEXT NOT NULL DEFAULT '',
    site          TEXT,
    author        TEXT,
    published     TEXT,
    fetched_at    INTEGER,
    status        TEXT NOT NULL,
    snapshot_hash TEXT REFERENCES research_snapshots(hash),
    PRIMARY KEY (run_id, id)
  );

  CREATE TABLE IF NOT EXISTS research_notes (
    id           TEXT NOT NULL,
    run_id       TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    sub_question INTEGER NOT NULL,
    claim        TEXT NOT NULL,
    quote        TEXT NOT NULL,
    source_id    TEXT NOT NULL,
    confidence   TEXT NOT NULL,
    verified     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (run_id, id)
  );

  CREATE INDEX IF NOT EXISTS research_runs_by_start ON research_runs(started_at DESC);

  CREATE VIRTUAL TABLE IF NOT EXISTS research_search
    USING fts5(text, run_id UNINDEXED, kind UNINDEXED, ref UNINDEXED);
"#;

fn ensure_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(RESEARCH_SCHEMA)
}

/// A source to save. `text` becomes a snapshot; without it `snapshot_hash` is kept as given.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SourceSave {
    pub id: String,
    pub url: String,
    pub canonical_url: String,
    pub title: String,
    pub site: Option<String>,
    pub author: Option<String>,
    pub published: Option<String>,
    pub fetched_at: Option<i64>,
    pub status: String,
    pub text: Option<String>,
    pub metadata_json: Option<String>,
    pub snapshot_hash: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct NoteSave {
    pub id: String,
    pub sub_question: i64,
    pub claim: String,
    pub quote: String,
    pub source_id: String,
    pub confidence: String,
    pub verified: bool,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct RunSave {
    pub id: String,
    pub workspace_id: Option<String>,
    pub chat_id: Option<String>,
    pub question: String,
    pub depth: String,
    pub status: String,
    pub plan_json: String,
    /// Sub-question texts, indexed for search next to the question.
    pub sub_questions: Vec<String>,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub budget_used: f64,
    pub hosts_json: String,
    pub report_ref: Option<String>,
    pub sources: Vec<SourceSave>,
    pub notes: Vec<NoteSave>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RunSummary {
    pub id: String,
    pub workspace_id: Option<String>,
    pub chat_id: Option<String>,
    pub question: String,
    pub depth: String,
    pub status: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub source_count: i64,
    pub note_count: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SavedRun {
    pub summary: RunSummary,
    pub plan_json: String,
    pub budget_used: f64,
    pub hosts_json: String,
    pub report_ref: Option<String>,
    pub sources: Vec<SourceSave>,
    pub notes: Vec<NoteSave>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RunHit {
    pub run_id: String,
    /// `run`, `source` or `note`.
    pub kind: String,
    pub reference: String,
    pub snippet: String,
}

/// SHA-256 of the page text, hex, the key a snapshot is stored under.
pub fn hash_text(text: &str) -> String {
    hex::encode(Sha256::digest(text.as_bytes()))
}

/// Words become quoted FTS5 terms, so user text with operators or quotes cannot break the query.
pub fn to_match(query: &str) -> String {
    query
        .split_whitespace()
        .map(|word| word.replace('"', ""))
        .filter(|word| !word.is_empty())
        .map(|word| format!("\"{word}\""))
        .collect::<Vec<_>>()
        .join(" OR ")
}

/// Days a retention setting keeps runs for: `90` and `30`; anything else keeps them forever.
pub fn retention_days(setting: &str) -> Option<u32> {
    match setting {
        "90" => Some(90),
        "30" => Some(30),
        _ => None,
    }
}

fn save_snapshot(conn: &Connection, text: &str, metadata: &str) -> Result<String, StorageError> {
    let hash = hash_text(text);
    conn.execute(
        "INSERT OR IGNORE INTO research_snapshots (hash, markdown, metadata_json) VALUES (?1, ?2, ?3)",
        params![hash, text, metadata],
    )?;
    Ok(hash)
}

fn remove_run_rows(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    for sql in [
        "DELETE FROM research_search WHERE run_id = ?1",
        "DELETE FROM research_notes WHERE run_id = ?1",
        "DELETE FROM research_sources WHERE run_id = ?1",
        "DELETE FROM research_runs WHERE id = ?1",
    ] {
        conn.execute(sql, [id])?;
    }
    Ok(())
}

/// Snapshots nothing points at any more, left behind by removed runs.
fn prune_snapshots(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM research_snapshots WHERE hash NOT IN (SELECT snapshot_hash FROM research_sources WHERE snapshot_hash IS NOT NULL)",
        [],
    )?;
    Ok(())
}

fn insert_run(conn: &Connection, run: &RunSave) -> Result<(), StorageError> {
    remove_run_rows(conn, &run.id)?;
    conn.execute(
        "INSERT INTO research_runs
         (id, workspace_id, chat_id, question, depth, status, plan_json, started_at, ended_at, budget_used, hosts_json, report_ref)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            run.id,
            run.workspace_id,
            run.chat_id,
            run.question,
            run.depth,
            run.status,
            run.plan_json,
            run.started_at,
            run.ended_at,
            run.budget_used,
            run.hosts_json,
            run.report_ref
        ],
    )?;
    let add_search = |text: &str, kind: &str, reference: &str| {
        conn.execute(
            "INSERT INTO research_search (text, run_id, kind, ref) VALUES (?1, ?2, ?3, ?4)",
            params![text, run.id, kind, reference],
        )
    };
    add_search(
        &format!("{}\n{}", run.question, run.sub_questions.join("\n")),
        "run",
        &run.id,
    )?;
    for source in &run.sources {
        let hash = match source.text.as_deref().filter(|text| !text.is_empty()) {
            Some(text) => Some(save_snapshot(
                conn,
                text,
                source.metadata_json.as_deref().unwrap_or("{}"),
            )?),
            None => source.snapshot_hash.clone(),
        };
        conn.execute(
            "INSERT INTO research_sources
             (id, run_id, url, canonical_url, title, site, author, published, fetched_at, status, snapshot_hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                source.id,
                run.id,
                source.url,
                source.canonical_url,
                source.title,
                source.site,
                source.author,
                source.published,
                source.fetched_at,
                source.status,
                hash
            ],
        )?;
        if let Some(text) = source.text.as_deref().filter(|text| !text.is_empty()) {
            add_search(text, "source", &source.id)?;
        }
    }
    for note in &run.notes {
        conn.execute(
            "INSERT INTO research_notes (id, run_id, sub_question, claim, quote, source_id, confidence, verified)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                note.id,
                run.id,
                note.sub_question,
                note.claim,
                note.quote,
                note.source_id,
                note.confidence,
                i64::from(note.verified)
            ],
        )?;
        add_search(&format!("{}\n{}", note.claim, note.quote), "note", &note.id)?;
    }
    Ok(())
}

const SUMMARY_SQL: &str = "SELECT r.id, r.workspace_id, r.chat_id, r.question, r.depth, r.status, r.started_at, r.ended_at,
  (SELECT COUNT(*) FROM research_sources s WHERE s.run_id = r.id AND s.status = 'read'),
  (SELECT COUNT(*) FROM research_notes n WHERE n.run_id = r.id)
  FROM research_runs r";

fn summary_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RunSummary> {
    Ok(RunSummary {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        chat_id: row.get(2)?,
        question: row.get(3)?,
        depth: row.get(4)?,
        status: row.get(5)?,
        started_at: row.get(6)?,
        ended_at: row.get(7)?,
        source_count: row.get(8)?,
        note_count: row.get(9)?,
    })
}

impl Storage {
    /// Saves a whole run in one transaction, replacing an earlier save of the same run.
    pub fn save_research_run(&self, run: &RunSave) -> Result<(), StorageError> {
        self.write("saveResearchRun", |conn| {
            ensure_schema(conn)?;
            let tx = conn.transaction()?;
            insert_run(&tx, run)?;
            tx.commit()?;
            Ok(())
        })
    }

    pub fn research_snapshot(&self, hash: &str) -> Result<Option<(String, String)>, StorageError> {
        let conn = self.lock()?;
        ensure_schema(&conn)?;
        Ok(conn
            .query_row(
                "SELECT markdown, metadata_json FROM research_snapshots WHERE hash = ?1",
                [hash],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?)
    }

    /// Runs newest first, for one workspace or all.
    pub fn list_research_runs(
        &self,
        workspace_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<RunSummary>, StorageError> {
        let conn = self.lock()?;
        ensure_schema(&conn)?;
        let limit = i64::try_from(limit).unwrap_or(i64::MAX);
        let rows = match workspace_id {
            Some(id) => conn
                .prepare(&format!(
                    "{SUMMARY_SQL} WHERE r.workspace_id = ?1 ORDER BY r.started_at DESC LIMIT ?2"
                ))?
                .query_map(params![id, limit], summary_row)?
                .collect::<Result<Vec<_>, _>>()?,
            None => conn
                .prepare(&format!(
                    "{SUMMARY_SQL} ORDER BY r.started_at DESC LIMIT ?1"
                ))?
                .query_map([limit], summary_row)?
                .collect::<Result<Vec<_>, _>>()?,
        };
        Ok(rows)
    }

    pub fn get_research_run(&self, id: &str) -> Result<Option<SavedRun>, StorageError> {
        let conn = self.lock()?;
        ensure_schema(&conn)?;
        let Some(summary) = conn
            .query_row(&format!("{SUMMARY_SQL} WHERE r.id = ?1"), [id], summary_row)
            .optional()?
        else {
            return Ok(None);
        };
        let (plan_json, budget_used, hosts_json, report_ref) = conn.query_row(
            "SELECT plan_json, budget_used, hosts_json, report_ref FROM research_runs WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
        let sources = conn
            .prepare(
                "SELECT id, url, canonical_url, title, site, author, published, fetched_at, status, snapshot_hash
                 FROM research_sources WHERE run_id = ?1 ORDER BY rowid",
            )?
            .query_map([id], |row| {
                Ok(SourceSave {
                    id: row.get(0)?,
                    url: row.get(1)?,
                    canonical_url: row.get(2)?,
                    title: row.get(3)?,
                    site: row.get(4)?,
                    author: row.get(5)?,
                    published: row.get(6)?,
                    fetched_at: row.get(7)?,
                    status: row.get(8)?,
                    snapshot_hash: row.get(9)?,
                    ..SourceSave::default()
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let notes = conn
            .prepare(
                "SELECT id, sub_question, claim, quote, source_id, confidence, verified
                 FROM research_notes WHERE run_id = ?1 ORDER BY rowid",
            )?
            .query_map([id], |row| {
                Ok(NoteSave {
                    id: row.get(0)?,
                    sub_question: row.get(1)?,
                    claim: row.get(2)?,
                    quote: row.get(3)?,
                    source_id: row.get(4)?,
                    confidence: row.get(5)?,
                    verified: row.get::<_, i64>(6)? == 1,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Some(SavedRun {
            summary,
            plan_json,
            budget_used,
            hosts_json,
            report_ref,
            sources,
            notes,
        }))
    }

    pub fn remove_research_run(&self, id: &str) -> Result<(), StorageError> {
        self.write("removeResearchRun", |conn| {
            ensure_schema(conn)?;
            let tx = conn.transaction()?;
            remove_run_rows(&tx, id)?;
            prune_snapshots(&tx)?;
            tx.commit()?;
            Ok(())
        })
    }

    /// Full-text search over run questions, notes and saved pages, best matches first.
    pub fn search_research(
        &self,
        query: &str,
        run_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<RunHit>, StorageError> {
        let matched = to_match(query);
        if matched.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.lock()?;
        ensure_schema(&conn)?;
        let limit = i64::try_from(limit).unwrap_or(i64::MAX);
        let map = |row: &rusqlite::Row<'_>| {
            Ok(RunHit {
                run_id: row.get(0)?,
                kind: row.get(1)?,
                reference: row.get(2)?,
                snippet: row.get(3)?,
            })
        };
        let base = "SELECT run_id, kind, ref, snippet(research_search, 0, '', '', '\u{2026}', 24) FROM research_search WHERE research_search MATCH ?1";
        let hits = match run_id {
            Some(id) => conn
                .prepare(&format!("{base} AND run_id = ?2 ORDER BY rank LIMIT ?3"))?
                .query_map(params![matched, id, limit], map)?
                .collect::<Result<Vec<_>, _>>()?,
            None => conn
                .prepare(&format!("{base} ORDER BY rank LIMIT ?2"))?
                .query_map(params![matched, limit], map)?
                .collect::<Result<Vec<_>, _>>()?,
        };
        Ok(hits)
    }

    /// Drops runs older than the retention days, then their orphaned snapshots. Returns how many runs went.
    pub fn apply_research_retention(
        &self,
        days: Option<u32>,
        now_ms: i64,
    ) -> Result<usize, StorageError> {
        let Some(days) = days.filter(|days| *days > 0) else {
            return Ok(0);
        };
        self.write("applyResearchRetention", |conn| {
            let cutoff = now_ms - i64::from(days) * DAY_MS;
            ensure_schema(conn)?;
            let tx = conn.transaction()?;
            let old = tx
                .prepare("SELECT id FROM research_runs WHERE started_at < ?1")?
                .query_map([cutoff], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            for id in &old {
                remove_run_rows(&tx, id)?;
            }
            prune_snapshots(&tx)?;
            tx.commit()?;
            Ok(old.len())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, Storage) {
        let dir = tempfile::tempdir().expect("temp dir");
        let storage = Storage::open(dir.path()).expect("open");
        (dir, storage)
    }

    fn run(id: &str, started: i64, text: &str) -> RunSave {
        RunSave {
            id: id.into(),
            question: "Why is the sky blue".into(),
            depth: "quick".into(),
            status: "done".into(),
            plan_json: "{}".into(),
            sub_questions: vec!["scattering".into()],
            started_at: started,
            hosts_json: "[]".into(),
            sources: vec![SourceSave {
                id: "s1".into(),
                url: "https://a.test/x".into(),
                canonical_url: "a.test/x".into(),
                status: "read".into(),
                text: Some(text.into()),
                ..SourceSave::default()
            }],
            notes: vec![NoteSave {
                id: "n1".into(),
                sub_question: 1,
                claim: "Rayleigh scattering".into(),
                quote: "Short waves scatter more".into(),
                source_id: "s1".into(),
                confidence: "confirmed".into(),
                verified: true,
            }],
            ..RunSave::default()
        }
    }

    #[test]
    fn saves_and_reads_back_with_a_snapshot_hash() {
        let (_dir, storage) = store();
        storage
            .save_research_run(&run("r1", 10, "page text"))
            .unwrap();
        let saved = storage.get_research_run("r1").unwrap().expect("run");
        assert_eq!(saved.summary.source_count, 1);
        assert_eq!(saved.notes[0].claim, "Rayleigh scattering");
        let hash = saved.sources[0].snapshot_hash.clone().expect("hash");
        assert_eq!(hash, hash_text("page text"));
        assert_eq!(
            storage.research_snapshot(&hash).unwrap().unwrap().0,
            "page text"
        );
    }

    #[test]
    fn search_finds_notes_and_survives_operators() {
        let (_dir, storage) = store();
        storage
            .save_research_run(&run("r1", 10, "page text"))
            .unwrap();
        let hits = storage
            .search_research("scattering AND \"", Some("r1"), 5)
            .unwrap();
        assert!(
            hits.iter()
                .any(|hit| hit.kind == "note" && hit.reference == "n1")
        );
    }

    #[test]
    fn retention_drops_old_runs_and_orphan_snapshots() {
        let (_dir, storage) = store();
        let now = 100 * DAY_MS;
        storage
            .save_research_run(&run("old", now - 40 * DAY_MS, "old page"))
            .unwrap();
        storage
            .save_research_run(&run("new", now - DAY_MS, "new page"))
            .unwrap();
        assert_eq!(storage.apply_research_retention(None, now).unwrap(), 0);
        assert_eq!(storage.apply_research_retention(Some(30), now).unwrap(), 1);
        assert!(storage.get_research_run("old").unwrap().is_none());
        assert!(
            storage
                .research_snapshot(&hash_text("old page"))
                .unwrap()
                .is_none()
        );
        assert!(
            storage
                .research_snapshot(&hash_text("new page"))
                .unwrap()
                .is_some()
        );
    }
}
