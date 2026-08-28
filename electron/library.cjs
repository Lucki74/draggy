const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { log } = require("./logger.cjs");
const { extractText, DOCUMENT_TEXT_LIMIT } = require("./documents.cjs");

const OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_EMBED_MODEL = "nomic-embed-text";

const CHUNK_TARGET_CHARS = 1200;
const CHUNK_OVERLAP_CHARS = 150;
const CHUNK_MIN_CHARS = 80;
const CHUNK_TITLED_MIN_CHARS = 20;
const EMBED_BATCH = 16;

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_CHUNKS_PER_FILE = 400;
const MAX_INDEXED_CHUNKS = 60000;

const OFFICE_EXTENSIONS = new Set([".docx", ".pptx", ".xlsx"]);

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".rst", ".log", ".csv", ".tsv", ".json",
  ".yaml", ".yml", ".xml", ".toml", ".ini", ".cfg", ".conf", ".tex",
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".html", ".htm", ".css",
  ".scss", ".vue", ".svelte", ".py", ".rb", ".go", ".rs", ".java", ".kt",
  ".swift", ".c", ".h", ".cpp", ".cc", ".hpp", ".cs", ".php", ".lua",
  ".r", ".pl", ".dart", ".scala", ".sh", ".sql", ".graphql",
]);

const SKIP_DIRECTORIES = new Set([
  "node_modules", ".git", ".svn", ".hg", "dist", "build", "out", "target",
  "__pycache__", ".venv", "venv", ".next", ".nuxt", ".cache", "vendor",
  "Library", "AppData", "$RECYCLE.BIN", "System Volume Information",
]);

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS library_sources (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    path     TEXT NOT NULL UNIQUE,
    added_at INTEGER NOT NULL
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
`;

let db = null;
let matrixCache = null;

function init(userDataPath) {
  db = new DatabaseSync(path.join(userDataPath, "library.db"));
  db.exec(SCHEMA);
  log.info("library", "index opened");
}

function invalidateCache() {
  matrixCache = null;
}

function meta(key, fallback = null) {
  const row = db.prepare("SELECT value FROM library_meta WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

function setMeta(key, value) {
  db.prepare(
    "INSERT INTO library_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, String(value));
}

function splitParagraphs(text) {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

const EXPLICIT_HEADING_RE = /^(#{1,6}\s+\S.*|--- Slide \d+ ---|--- Sheet: .*?---)\s*$/;

function looksLikeTitle(line) {
  return (
    line.length > 0 &&
    line.length < 80 &&
    /^[A-Z0-9]/.test(line) &&
    !/[.!?,;:]$/.test(line)
  );
}

function headingText(line) {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^---\s*/, "")
    .replace(/\s*---$/, "")
    .replace(/^Sheet:\s*/i, "")
    .trim();
}

function splitLeadingHeading(block) {
  const newline = block.indexOf("\n");
  const firstLine = (newline === -1 ? block : block.slice(0, newline)).trim();
  const rest = newline === -1 ? "" : block.slice(newline + 1).trim();

  if (EXPLICIT_HEADING_RE.test(firstLine)) {
    return { heading: headingText(firstLine), body: rest };
  }

  if (newline === -1 && looksLikeTitle(firstLine)) {
    return { heading: headingText(firstLine), body: firstLine };
  }

  return null;
}

function chunkText(text) {
  const blocks = splitParagraphs(String(text || ""));
  const chunks = [];

  let heading = "";
  let buffer = "";

  const flush = () => {
    const body = buffer.trim();
    buffer = "";
    if (!body) return;

    const worthKeeping =
      body.length >= CHUNK_MIN_CHARS ||
      (heading !== "" && body.length >= CHUNK_TITLED_MIN_CHARS);

    if (worthKeeping) chunks.push({ heading, text: body });
  };

  const append = (piece) => {
    if (!piece) return;
    buffer += (buffer ? "\n\n" : "") + piece;
  };

  for (const block of blocks) {
    let body = block;

    const split = splitLeadingHeading(block);
    if (split) {
      flush();
      heading = split.heading;
      body = split.body;
      if (!body) continue;
    }

    if (buffer.length + body.length + 2 > CHUNK_TARGET_CHARS && buffer) {
      const tail = buffer.slice(-CHUNK_OVERLAP_CHARS);
      flush();
      buffer = tail.includes(" ") ? tail.slice(tail.indexOf(" ") + 1) : "";
    }

    if (body.length > CHUNK_TARGET_CHARS) {
      flush();
      const stride = CHUNK_TARGET_CHARS - CHUNK_OVERLAP_CHARS;
      for (let offset = 0; offset < body.length; offset += stride) {
        const slice = body.slice(offset, offset + CHUNK_TARGET_CHARS).trim();
        if (slice.length >= CHUNK_MIN_CHARS) chunks.push({ heading, text: slice });
        if (chunks.length >= MAX_CHUNKS_PER_FILE) return chunks;
      }
      continue;
    }

    append(body);
    if (chunks.length >= MAX_CHUNKS_PER_FILE) return chunks;
  }

  flush();
  return chunks.slice(0, MAX_CHUNKS_PER_FILE);
}

function normalise(vector) {
  let total = 0;
  for (let i = 0; i < vector.length; i++) total += vector[i] * vector[i];
  const magnitude = Math.sqrt(total);
  if (magnitude === 0) return vector;

  const unit = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) unit[i] = vector[i] / magnitude;
  return unit;
}

async function embed(model, inputs) {
  const response = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: inputs }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Embedding failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  const body = await response.json();
  const vectors = body?.embeddings;
  if (!Array.isArray(vectors) || vectors.length !== inputs.length) {
    throw new Error("Embedding model returned an unexpected shape");
  }

  return vectors.map((values) => normalise(Float32Array.from(values)));
}

function toBlob(vector) {
  return new Uint8Array(vector.buffer.slice(0));
}

function fromBlob(blob) {
  const bytes = Uint8Array.from(blob);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

function eligible(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(extension) || OFFICE_EXTENSIONS.has(extension);
}

function walk(root, collected = [], depth = 0) {
  if (depth > 12) return collected;

  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return collected;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env") continue;
    const full = path.join(root, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      walk(full, collected, depth + 1);
      continue;
    }

    if (!entry.isFile() || !eligible(full)) continue;

    try {
      const stat = fs.statSync(full);
      if (stat.size > MAX_FILE_BYTES || stat.size === 0) continue;
      collected.push({ path: full, mtime: Math.floor(stat.mtimeMs), size: stat.size });
    } catch {
      /* an unreadable file is simply skipped */
    }
  }

  return collected;
}

async function readFileText(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (OFFICE_EXTENSIONS.has(extension)) {
    const buffer = fs.readFileSync(filePath);
    const text = await extractText(filePath, buffer);
    return text.slice(0, DOCUMENT_TEXT_LIMIT);
  }

  return fs.readFileSync(filePath, "utf8").slice(0, DOCUMENT_TEXT_LIMIT);
}

function totalChunks() {
  return db.prepare("SELECT COUNT(*) AS n FROM library_chunks").get().n;
}

async function indexFile(sourceId, file, model, existing) {
  if (existing && existing.mtime === file.mtime && existing.size === file.size) {
    return { skipped: true, chunks: existing.chunks };
  }

  const text = await readFileText(file.path);
  const chunks = chunkText(text);

  if (chunks.length === 0) {
    if (existing) db.prepare("DELETE FROM library_files WHERE id = ?").run(existing.id);
    return { skipped: false, chunks: 0 };
  }

  const vectors = [];
  for (let offset = 0; offset < chunks.length; offset += EMBED_BATCH) {
    const batch = chunks.slice(offset, offset + EMBED_BATCH);
    const embedded = await embed(
      model,
      batch.map((chunk) => (chunk.heading ? `${chunk.heading}\n\n${chunk.text}` : chunk.text)),
    );
    vectors.push(...embedded);
  }

  db.exec("BEGIN");
  try {
    if (existing) db.prepare("DELETE FROM library_files WHERE id = ?").run(existing.id);

    db.prepare(
      "INSERT INTO library_files (source_id, path, mtime, size, chunks, indexed_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(sourceId, file.path, file.mtime, file.size, chunks.length, Date.now());

    const fileId = db.prepare("SELECT id FROM library_files WHERE path = ?").get(file.path).id;
    const insert = db.prepare(
      "INSERT INTO library_chunks (file_id, position, heading, text, embedding) VALUES (?, ?, ?, ?, ?)",
    );

    chunks.forEach((chunk, index) => {
      insert.run(fileId, index, chunk.heading, chunk.text, toBlob(vectors[index]));
    });

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  invalidateCache();
  return { skipped: false, chunks: chunks.length };
}

async function indexSource(sourcePath, model, onProgress) {
  const resolved = path.resolve(sourcePath);
  if (!fs.existsSync(resolved)) {
    return { success: false, error: "That folder no longer exists." };
  }

  db.prepare(
    "INSERT INTO library_sources (path, added_at) VALUES (?, ?) ON CONFLICT(path) DO NOTHING",
  ).run(resolved, Date.now());

  const sourceId = db.prepare("SELECT id FROM library_sources WHERE path = ?").get(resolved).id;
  const files = walk(resolved);

  const existingRows = db
    .prepare("SELECT id, path, mtime, size, chunks FROM library_files WHERE source_id = ?")
    .all(sourceId);
  const existing = new Map(existingRows.map((row) => [row.path, row]));
  const seen = new Set();

  let indexed = 0;
  let skipped = 0;
  let failed = 0;
  let chunks = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    seen.add(file.path);

    if (totalChunks() >= MAX_INDEXED_CHUNKS) {
      log.warn("library", "chunk ceiling reached, stopping index run");
      break;
    }

    onProgress?.({
      phase: "indexing",
      current: i + 1,
      total: files.length,
      file: path.basename(file.path),
    });

    try {
      const result = await indexFile(sourceId, file, model, existing.get(file.path));
      if (result.skipped) skipped++;
      else indexed++;
      chunks += result.chunks;
    } catch (error) {
      failed++;
      log.warn("library", `failed to index ${file.path}: ${error.message}`);
      if (/Embedding failed|unexpected shape|fetch failed/i.test(error.message) && failed > 3) {
        return {
          success: false,
          error: `Embedding stopped: ${error.message}`,
          indexed,
          skipped,
          failed,
        };
      }
    }
  }

  for (const [filePath, row] of existing) {
    if (!seen.has(filePath)) {
      db.prepare("DELETE FROM library_files WHERE id = ?").run(row.id);
      invalidateCache();
    }
  }

  onProgress?.({ phase: "done", current: files.length, total: files.length, file: "" });

  return { success: true, indexed, skipped, failed, chunks, files: files.length };
}

function buildMatrix() {
  if (matrixCache) return matrixCache;

  const rows = db
    .prepare(
      `SELECT c.id, c.heading, c.text, c.embedding, f.path
       FROM library_chunks c JOIN library_files f ON f.id = c.file_id`,
    )
    .all();

  if (rows.length === 0) {
    matrixCache = { vectors: [], entries: [] };
    return matrixCache;
  }

  matrixCache = {
    vectors: rows.map((row) => fromBlob(row.embedding)),
    entries: rows.map((row) => ({
      id: row.id,
      heading: row.heading,
      text: row.text,
      path: row.path,
    })),
  };

  return matrixCache;
}

function dot(a, b) {
  const length = Math.min(a.length, b.length);
  let total = 0;
  for (let i = 0; i < length; i++) total += a[i] * b[i];
  return total;
}

function rankChunks(queryVector, vectors, entries, limit) {
  const scored = [];
  for (let i = 0; i < vectors.length; i++) {
    scored.push({ index: i, score: dot(queryVector, vectors[i]) });
  }

  scored.sort((a, b) => b.score - a.score);

  return scored
    .slice(0, Math.max(1, Math.min(20, limit || 6)))
    .map(({ index, score }) => ({
      ...entries[index],
      score: Number(score.toFixed(4)),
      name: path.basename(entries[index].path),
    }));
}

async function search(query, limit, model) {
  const term = String(query || "").trim();
  if (!term) return { success: true, results: [] };

  const { vectors, entries } = buildMatrix();
  if (entries.length === 0) {
    return { success: true, results: [], empty: true };
  }

  let queryVector;
  try {
    [queryVector] = await embed(model, [term]);
  } catch (error) {
    return { success: false, error: error.message, results: [] };
  }

  return { success: true, results: rankChunks(queryVector, vectors, entries, limit) };
}

function listSources() {
  return db
    .prepare(
      `SELECT s.id, s.path, s.added_at,
              (SELECT COUNT(*) FROM library_files f WHERE f.source_id = s.id) AS files,
              (SELECT COALESCE(SUM(f.chunks), 0) FROM library_files f WHERE f.source_id = s.id) AS chunks
       FROM library_sources s ORDER BY s.added_at ASC`,
    )
    .all()
    .map((row) => ({
      id: row.id,
      path: row.path,
      addedAt: row.added_at,
      files: row.files,
      chunks: row.chunks,
    }));
}

function removeSource(id) {
  db.prepare("DELETE FROM library_sources WHERE id = ?").run(Number(id));
  invalidateCache();
  return { success: true };
}

function clear() {
  db.exec("DELETE FROM library_sources");
  invalidateCache();
  return { success: true };
}

function stats() {
  const files = db.prepare("SELECT COUNT(*) AS n FROM library_files").get().n;
  return {
    sources: db.prepare("SELECT COUNT(*) AS n FROM library_sources").get().n,
    files,
    chunks: totalChunks(),
    embedModel: meta("embed_model", DEFAULT_EMBED_MODEL),
    ceiling: MAX_INDEXED_CHUNKS,
  };
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  init,
  indexSource,
  search,
  listSources,
  removeSource,
  clear,
  stats,
  meta,
  setMeta,
  chunkText,
  normalise,
  rankChunks,
  toBlob,
  fromBlob,
  close,
  invalidateCache,
  DEFAULT_EMBED_MODEL,
  MAX_INDEXED_CHUNKS,
  CHUNK_TARGET_CHARS,
};
