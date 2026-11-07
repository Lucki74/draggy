// The research library: finished runs with their sources, page snapshots and notes.
// It shares the library database so snapshots can later join the chunk and embedding index.
const crypto = require("crypto");

const SCHEMA = `
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
`;

const RETENTION_DAYS = { forever: null, "90": 90, "30": 30 };
const DAY_MS = 24 * 60 * 60 * 1000;

let db = null;

function init(database) {
  db = database;
  db.exec(SCHEMA);
}

function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/** Saves page text once per distinct content. Returns the hash the source row points at. */
function saveSnapshot(markdown, metadata = {}) {
  const hash = hashText(markdown);
  db.prepare("INSERT OR IGNORE INTO research_snapshots (hash, markdown, metadata_json) VALUES (?, ?, ?)")
    .run(hash, markdown, JSON.stringify(metadata));
  return hash;
}

function snapshot(hash) {
  const row = db.prepare("SELECT markdown, metadata_json FROM research_snapshots WHERE hash = ?").get(hash);
  return row ? { markdown: row.markdown, metadata: JSON.parse(row.metadata_json) } : null;
}

const str = (value) => (value === undefined || value === null ? null : String(value));

/** Writes a whole run in one transaction, replacing an earlier save of the same run. */
function saveRun(run) {
  db.exec("BEGIN");
  try {
    removeRunRows(run.id);
    db.prepare(`INSERT INTO research_runs
      (id, workspace_id, chat_id, question, depth, status, plan_json, started_at, ended_at, budget_used, hosts_json, report_ref)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      String(run.id), str(run.workspaceId), str(run.chatId), String(run.plan.question), String(run.plan.depth),
      String(run.status), JSON.stringify(run.plan), Number(run.startedAt), run.endedAt ? Number(run.endedAt) : null,
      Number(run.budgetUsed ?? 0), JSON.stringify(run.contactedHosts ?? []), str(run.reportRef),
    );
    const addSearch = db.prepare("INSERT INTO research_search (text, run_id, kind, ref) VALUES (?, ?, ?, ?)");
    addSearch.run(`${run.plan.question}\n${(run.plan.subQuestions ?? []).join("\n")}`, run.id, "run", run.id);
    const addSource = db.prepare(`INSERT INTO research_sources
      (id, run_id, url, canonical_url, title, site, author, published, fetched_at, status, snapshot_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const source of run.sources ?? []) {
      const hash = source.text ? saveSnapshot(source.text, source.metadata ?? {}) : str(source.snapshotHash);
      addSource.run(
        String(source.id), run.id, String(source.url), String(source.canonicalUrl ?? source.key ?? source.url),
        String(source.title ?? ""), str(source.site), str(source.author), str(source.published),
        source.fetchedAt ? Number(source.fetchedAt) : null, String(source.status), hash,
      );
      if (source.text) addSearch.run(String(source.text), run.id, "source", String(source.id));
    }
    const addNote = db.prepare(`INSERT INTO research_notes
      (id, run_id, sub_question, claim, quote, source_id, confidence, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const note of run.notes ?? []) {
      addNote.run(
        String(note.id), run.id, Number(note.subQuestion), String(note.claim), String(note.quote),
        String(note.sourceId), String(note.confidence), note.verified ? 1 : 0,
      );
      addSearch.run(`${note.claim}\n${note.quote}`, run.id, "note", String(note.id));
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function removeRunRows(id) {
  db.prepare("DELETE FROM research_search WHERE run_id = ?").run(id);
  db.prepare("DELETE FROM research_notes WHERE run_id = ?").run(id);
  db.prepare("DELETE FROM research_sources WHERE run_id = ?").run(id);
  db.prepare("DELETE FROM research_runs WHERE id = ?").run(id);
}

/** Snapshots nothing points at any more, left behind by removed runs. */
function pruneSnapshots() {
  db.prepare("DELETE FROM research_snapshots WHERE hash NOT IN (SELECT snapshot_hash FROM research_sources WHERE snapshot_hash IS NOT NULL)").run();
}

function removeRun(id) {
  db.exec("BEGIN");
  try {
    removeRunRows(String(id));
    pruneSnapshots();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function summaryRow(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    chatId: row.chat_id,
    question: row.question,
    depth: row.depth,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    sourceCount: row.source_count,
    noteCount: row.note_count,
  };
}

const SUMMARY_SQL = `SELECT r.*,
  (SELECT COUNT(*) FROM research_sources s WHERE s.run_id = r.id AND s.status = 'read') AS source_count,
  (SELECT COUNT(*) FROM research_notes n WHERE n.run_id = r.id) AS note_count
  FROM research_runs r`;

function listRuns(workspaceId, limit = 100) {
  const rows = workspaceId
    ? db.prepare(`${SUMMARY_SQL} WHERE r.workspace_id = ? ORDER BY r.started_at DESC LIMIT ?`).all(String(workspaceId), limit)
    : db.prepare(`${SUMMARY_SQL} ORDER BY r.started_at DESC LIMIT ?`).all(limit);
  return rows.map(summaryRow);
}

function getRun(id) {
  const row = db.prepare(`${SUMMARY_SQL} WHERE r.id = ?`).get(String(id));
  if (!row) return null;
  const sources = db.prepare("SELECT * FROM research_sources WHERE run_id = ? ORDER BY rowid").all(row.id).map((source) => ({
    id: source.id,
    url: source.url,
    canonicalUrl: source.canonical_url,
    title: source.title,
    site: source.site,
    author: source.author,
    published: source.published,
    fetchedAt: source.fetched_at,
    status: source.status,
    snapshotHash: source.snapshot_hash,
  }));
  const notes = db.prepare("SELECT * FROM research_notes WHERE run_id = ? ORDER BY rowid").all(row.id).map((note) => ({
    id: note.id,
    subQuestion: note.sub_question,
    claim: note.claim,
    quote: note.quote,
    sourceId: note.source_id,
    confidence: note.confidence,
    verified: note.verified === 1,
  }));
  return {
    ...summaryRow(row),
    plan: JSON.parse(row.plan_json),
    budgetUsed: row.budget_used,
    contactedHosts: JSON.parse(row.hosts_json),
    reportRef: row.report_ref,
    sources,
    notes,
  };
}

/** Words become quoted FTS5 terms, so user text with operators or quotes cannot break the query. */
function toMatch(query) {
  const words = String(query).split(/\s+/).map((word) => word.replace(/"/g, "")).filter(Boolean);
  return words.map((word) => `"${word}"`).join(" OR ");
}

/** Full-text search over run questions, notes and saved pages, best matches first. */
function searchRuns(query, options = {}) {
  const match = toMatch(query);
  if (!match) return [];
  const limit = Number(options.limit ?? 20);
  const rows = options.runId
    ? db.prepare(`SELECT run_id, kind, ref, snippet(research_search, 0, '', '', '…', 24) AS snippet
        FROM research_search WHERE research_search MATCH ? AND run_id = ? ORDER BY rank LIMIT ?`).all(match, String(options.runId), limit)
    : db.prepare(`SELECT run_id, kind, ref, snippet(research_search, 0, '', '', '…', 24) AS snippet
        FROM research_search WHERE research_search MATCH ? ORDER BY rank LIMIT ?`).all(match, limit);
  return rows.map((row) => ({ runId: row.run_id, kind: row.kind, ref: row.ref, snippet: row.snippet }));
}

/** Drops runs older than the retention setting. Returns how many went. */
function applyRetention(setting, now = Date.now()) {
  const days = RETENTION_DAYS[String(setting)] ?? null;
  if (!days) return 0;
  const old = db.prepare("SELECT id FROM research_runs WHERE started_at < ?").all(now - days * DAY_MS);
  for (const row of old) removeRun(row.id);
  return old.length;
}

module.exports = {
  init,
  saveRun,
  saveSnapshot,
  snapshot,
  listRuns,
  getRun,
  removeRun,
  searchRuns,
  applyRetention,
  hashText,
  toMatch,
};
