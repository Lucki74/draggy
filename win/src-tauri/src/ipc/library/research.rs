//! The research tables, kept in library.db beside the library index, in the layout Electron-era builds wrote.
//! Runs and sources travel as the renderer's camelCase JSON; the SQL here matches that module.

use draggy_storage::{hash_text, to_match};
use rusqlite::{Connection, OptionalExtension, Result, Row, Transaction, params};
use serde_json::{Map, Value, json};

/// Schema of the Electron-era library.db, kept verbatim so both builds read the same file.
pub const SCHEMA: &str = "
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
";

const SUMMARY_SQL: &str = "SELECT r.*,
  (SELECT COUNT(*) FROM research_sources s WHERE s.run_id = r.id AND s.status = 'read') AS source_count,
  (SELECT COUNT(*) FROM research_notes n WHERE n.run_id = r.id) AS note_count
  FROM research_runs r";

pub fn init(conn: &Connection) -> Result<()> {
    conn.execute_batch(SCHEMA)
}

fn summary(row: &Row<'_>) -> Result<Value> {
    Ok(json!({
        "id": row.get::<_, String>("id")?,
        "workspaceId": row.get::<_, Option<String>>("workspace_id")?,
        "chatId": row.get::<_, Option<String>>("chat_id")?,
        "question": row.get::<_, String>("question")?,
        "depth": row.get::<_, String>("depth")?,
        "status": row.get::<_, String>("status")?,
        "startedAt": row.get::<_, i64>("started_at")?,
        "endedAt": row.get::<_, Option<i64>>("ended_at")?,
        "sourceCount": row.get::<_, i64>("source_count")?,
        "noteCount": row.get::<_, i64>("note_count")?,
    }))
}

/// Runs newest first, for one workspace or all of them.
pub fn list_runs(conn: &Connection, workspace: Option<&str>, limit: i64) -> Result<Vec<Value>> {
    let rows = match workspace {
        Some(id) => conn
            .prepare(&format!(
                "{SUMMARY_SQL} WHERE r.workspace_id = ?1 ORDER BY r.started_at DESC LIMIT ?2"
            ))?
            .query_map(params![id, limit], summary)?
            .collect::<Result<Vec<_>>>()?,
        None => conn
            .prepare(&format!(
                "{SUMMARY_SQL} ORDER BY r.started_at DESC LIMIT ?1"
            ))?
            .query_map([limit], summary)?
            .collect::<Result<Vec<_>>>()?,
    };
    Ok(rows)
}

/// The getRun shape: the summary plus the parsed plan, the sources and notes without page text.
pub fn get_run(conn: &Connection, id: &str) -> Result<Option<Value>> {
    let Some(mut run) = conn
        .query_row(&format!("{SUMMARY_SQL} WHERE r.id = ?1"), [id], summary)
        .optional()?
    else {
        return Ok(None);
    };
    let (plan_json, budget, hosts_json, report_ref): (String, f64, String, Option<String>) = conn
        .query_row(
        "SELECT plan_json, budget_used, hosts_json, report_ref FROM research_runs WHERE id = ?1",
        [id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    let sources = conn
        .prepare("SELECT * FROM research_sources WHERE run_id = ?1 ORDER BY rowid")?
        .query_map([id], |s| {
            Ok(json!({
                "id": s.get::<_, String>("id")?,
                "url": s.get::<_, String>("url")?,
                "canonicalUrl": s.get::<_, String>("canonical_url")?,
                "title": s.get::<_, String>("title")?,
                "site": s.get::<_, Option<String>>("site")?,
                "author": s.get::<_, Option<String>>("author")?,
                "published": s.get::<_, Option<String>>("published")?,
                "fetchedAt": s.get::<_, Option<i64>>("fetched_at")?,
                "status": s.get::<_, String>("status")?,
                "snapshotHash": s.get::<_, Option<String>>("snapshot_hash")?,
            }))
        })?
        .collect::<Result<Vec<_>>>()?;
    let notes = conn
        .prepare("SELECT * FROM research_notes WHERE run_id = ?1 ORDER BY rowid")?
        .query_map([id], |n| {
            Ok(json!({
                "id": n.get::<_, String>("id")?,
                "subQuestion": n.get::<_, i64>("sub_question")?,
                "claim": n.get::<_, String>("claim")?,
                "quote": n.get::<_, String>("quote")?,
                "sourceId": n.get::<_, String>("source_id")?,
                "confidence": n.get::<_, String>("confidence")?,
                "verified": n.get::<_, i64>("verified")? == 1,
            }))
        })?
        .collect::<Result<Vec<_>>>()?;
    let extra = Map::from_iter([
        (
            "plan".to_owned(),
            serde_json::from_str(&plan_json).unwrap_or(Value::Null),
        ),
        ("budgetUsed".to_owned(), json!(budget)),
        (
            "contactedHosts".to_owned(),
            serde_json::from_str(&hosts_json).unwrap_or_else(|_| json!([])),
        ),
        ("reportRef".to_owned(), json!(report_ref)),
        ("sources".to_owned(), Value::Array(sources)),
        ("notes".to_owned(), Value::Array(notes)),
    ]);
    if let Value::Object(map) = &mut run {
        map.extend(extra);
    }
    Ok(Some(run))
}

/// Writes a whole run in one transaction, replacing an earlier save of the same run.
pub fn save_run(conn: &mut Connection, run: &Value) -> Result<()> {
    let tx = conn.transaction()?;
    remove_run_rows(&tx, &text(run, "id"))?;
    insert_run(&tx, run)?;
    tx.commit()
}

/// Removes a run and any snapshot nothing points at any more.
pub fn remove_run(conn: &mut Connection, id: &str) -> Result<()> {
    let tx = conn.transaction()?;
    remove_run_rows(&tx, id)?;
    prune_snapshots(&tx)?;
    tx.commit()
}

fn remove_run_rows(tx: &Transaction<'_>, id: &str) -> Result<()> {
    tx.execute("DELETE FROM research_search WHERE run_id = ?1", [id])?;
    tx.execute("DELETE FROM research_notes WHERE run_id = ?1", [id])?;
    tx.execute("DELETE FROM research_sources WHERE run_id = ?1", [id])?;
    tx.execute("DELETE FROM research_runs WHERE id = ?1", [id])?;
    Ok(())
}

fn prune_snapshots(tx: &Transaction<'_>) -> Result<()> {
    tx.execute(
        "DELETE FROM research_snapshots WHERE hash NOT IN (SELECT snapshot_hash FROM research_sources WHERE snapshot_hash IS NOT NULL)",
        [],
    )?;
    Ok(())
}

fn insert_run(tx: &Transaction<'_>, run: &Value) -> Result<()> {
    let plan = run.get("plan").cloned().unwrap_or(Value::Null);
    let question = text(&plan, "question");
    let sub_questions = list_text(plan.get("subQuestions"));
    tx.execute(
        "INSERT INTO research_runs
         (id, workspace_id, chat_id, question, depth, status, plan_json, started_at, ended_at, budget_used, hosts_json, report_ref)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            text(run, "id"),
            opt_text(run.get("workspaceId")),
            opt_text(run.get("chatId")),
            question,
            text(&plan, "depth"),
            text(run, "status"),
            plan.to_string(),
            int(run, "startedAt").unwrap_or(0),
            int(run, "endedAt"),
            run.get("budgetUsed").and_then(Value::as_f64).unwrap_or(0.0),
            run.get("contactedHosts").cloned().unwrap_or_else(|| json!([])).to_string(),
            opt_text(run.get("reportRef")),
        ],
    )?;
    let run_id = text(run, "id");
    add_search(
        tx,
        &format!("{question}\n{}", sub_questions.join("\n")),
        &run_id,
        "run",
        &run_id,
    )?;
    for source in items(run.get("sources")) {
        let page = text(source, "text");
        let hash = if page.is_empty() {
            opt_text(source.get("snapshotHash"))
        } else {
            let metadata = match source.get("metadata") {
                None | Some(Value::Null) => "{}".to_owned(),
                Some(other) => other.to_string(),
            };
            Some(save_snapshot(tx, &page, &metadata)?)
        };
        let canonical = [
            text(source, "canonicalUrl"),
            text(source, "key"),
            text(source, "url"),
        ]
        .into_iter()
        .find(|candidate| !candidate.is_empty())
        .unwrap_or_default();
        let source_id = text(source, "id");
        tx.execute(
            "INSERT INTO research_sources
             (id, run_id, url, canonical_url, title, site, author, published, fetched_at, status, snapshot_hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                source_id,
                run_id,
                text(source, "url"),
                canonical,
                text(source, "title"),
                opt_text(source.get("site")),
                opt_text(source.get("author")),
                opt_text(source.get("published")),
                int(source, "fetchedAt"),
                text(source, "status"),
                hash,
            ],
        )?;
        if !page.is_empty() {
            add_search(tx, &page, &run_id, "source", &source_id)?;
        }
    }
    for note in items(run.get("notes")) {
        let note_id = text(note, "id");
        tx.execute(
            "INSERT INTO research_notes
             (id, run_id, sub_question, claim, quote, source_id, confidence, verified)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                note_id,
                run_id,
                int(note, "subQuestion").unwrap_or(0),
                text(note, "claim"),
                text(note, "quote"),
                text(note, "sourceId"),
                text(note, "confidence"),
                i64::from(
                    note.get("verified")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                ),
            ],
        )?;
        add_search(
            tx,
            &format!("{}\n{}", text(note, "claim"), text(note, "quote")),
            &run_id,
            "note",
            &note_id,
        )?;
    }
    Ok(())
}

/// Saves page text once per distinct content. Returns the hash the source row points at.
fn save_snapshot(tx: &Transaction<'_>, markdown: &str, metadata: &str) -> Result<String> {
    let hash = hash_text(markdown);
    tx.execute(
        "INSERT OR IGNORE INTO research_snapshots (hash, markdown, metadata_json) VALUES (?1, ?2, ?3)",
        params![hash, markdown, metadata],
    )?;
    Ok(hash)
}

fn add_search(
    tx: &Transaction<'_>,
    body: &str,
    run_id: &str,
    kind: &str,
    reference: &str,
) -> Result<()> {
    tx.execute(
        "INSERT INTO research_search (text, run_id, kind, ref) VALUES (?1, ?2, ?3, ?4)",
        params![body, run_id, kind, reference],
    )?;
    Ok(())
}

/// Full-text search over run questions, notes and saved pages, best matches first.
pub fn search(
    conn: &Connection,
    query: &str,
    run_id: Option<&str>,
    limit: i64,
) -> Result<Vec<Value>> {
    let matched = to_match(query);
    if matched.is_empty() {
        return Ok(Vec::new());
    }
    let rows = conn
        .prepare(
            "SELECT run_id, kind, ref, snippet(research_search, 0, '', '', '…', 24) AS snippet
             FROM research_search WHERE research_search MATCH ?1 AND (?2 IS NULL OR run_id = ?2)
             ORDER BY rank LIMIT ?3",
        )?
        .query_map(params![matched, run_id, limit], |row| {
            Ok(json!({
                "runId": row.get::<_, String>(0)?,
                "kind": row.get::<_, String>(1)?,
                "ref": row.get::<_, String>(2)?,
                "snippet": row.get::<_, String>(3)?,
            }))
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(rows)
}

fn items(value: Option<&Value>) -> Vec<&Value> {
    value
        .and_then(Value::as_array)
        .map(|list| list.iter().collect())
        .unwrap_or_default()
}

fn list_text(value: Option<&Value>) -> Vec<String> {
    items(value)
        .into_iter()
        .map(|item| plain(Some(item)).unwrap_or_default())
        .collect()
}

fn plain(value: Option<&Value>) -> Option<String> {
    match value {
        None | Some(Value::Null) => None,
        Some(Value::String(text)) => Some(text.clone()),
        Some(other) => Some(other.to_string()),
    }
}

fn opt_text(value: Option<&Value>) -> Option<String> {
    plain(value).filter(|text| !text.is_empty())
}

fn text(value: &Value, key: &str) -> String {
    plain(value.get(key)).unwrap_or_default()
}

fn int(value: &Value, key: &str) -> Option<i64> {
    value
        .get(key)
        .and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|n| n as i64)))
}

// TODO(research-retention): applyRetention is not ported; it runs outside these handlers.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_is_empty_for_fresh_schema() {
        let conn = Connection::open_in_memory().expect("open");
        init(&conn).expect("schema");
        assert!(list_runs(&conn, None, 100).expect("list").is_empty());
    }

    #[test]
    fn save_search_get_and_remove_round_trip() {
        let mut conn = Connection::open_in_memory().expect("open");
        init(&conn).expect("schema");
        let run = json!({
            "id": "r1", "workspaceId": "default", "status": "done",
            "startedAt": 1000, "budgetUsed": 0.5, "contactedHosts": ["example.org"],
            "plan": { "question": "why is the sky blue", "depth": "quick", "subQuestions": ["rayleigh"] },
            "sources": [{
                "id": "s1", "url": "https://example.org/sky", "canonicalUrl": "https://example.org/sky",
                "title": "Sky", "status": "read", "text": "Rayleigh scattering explains it.",
                "metadata": { "lang": "en" }
            }],
            "notes": [{ "id": "n1", "subQuestion": 0, "claim": "scatter", "quote": "Rayleigh",
                "sourceId": "s1", "confidence": "high", "verified": true }]
        });
        save_run(&mut conn, &run).expect("save");
        let listed = list_runs(&conn, Some("default"), 10).expect("list");
        assert_eq!(listed[0]["sourceCount"], 1);
        let got = get_run(&conn, "r1").expect("get").expect("present");
        assert_eq!(got["plan"]["depth"], "quick");
        assert!(got["sources"][0].get("text").is_none());
        let hits = search(&conn, "rayleigh", None, 5).expect("search");
        assert_eq!(hits[0]["runId"], "r1");
        remove_run(&mut conn, "r1").expect("remove");
        assert!(get_run(&conn, "r1").expect("get").is_none());
    }

    /// DDL and a run row as electron/researchLibrary.cjs writes them into library.db.
    #[test]
    fn lists_runs_from_an_electron_written_library_db() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.db");
        {
            let conn = Connection::open(&path).expect("open");
            conn.execute_batch(SCHEMA).expect("electron schema");
            conn.execute(
                "INSERT INTO research_runs (id, workspace_id, chat_id, question, depth, status, plan_json,
                 started_at, ended_at, budget_used, hosts_json, report_ref)
                 VALUES ('e1', 'default', NULL, 'q', 'deep', 'done', '{\"question\":\"q\"}', 5, 9, 0.25, '[]', NULL)",
                [],
            )
            .expect("insert");
        }
        let store = super::super::store::Store::open(&path).expect("store opens");
        let runs = list_runs(store.conn(), None, 100).expect("list");
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0]["id"], "e1");
        assert_eq!(runs[0]["depth"], "deep");
    }
}
