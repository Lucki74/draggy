const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const { log } = require("./logger.cjs");

const SCHEMA_VERSION = 2;

let db = null;
let blobDir = null;

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS chats (
    id                TEXT PRIMARY KEY,
    title             TEXT NOT NULL,
    updated_at        INTEGER NOT NULL,
    is_out_of_context INTEGER NOT NULL DEFAULT 0
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

  CREATE VIRTUAL TABLE IF NOT EXISTS message_search
    USING fts5(chat_id UNINDEXED, message_id UNINDEXED, body);
`;

function blobPath(hash) {
  return path.join(blobDir, hash.slice(0, 2), hash);
}

function writeBlob(content) {
  const hash = crypto.createHash("sha256").update(content, "utf8").digest("hex");
  const target = blobPath(hash);

  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }

  db.prepare("INSERT OR IGNORE INTO blobs (hash, bytes) VALUES (?, ?)").run(
    hash,
    Buffer.byteLength(content, "utf8"),
  );

  return hash;
}

function readBlob(hash) {
  try {
    return fs.readFileSync(blobPath(hash), "utf8");
  } catch {
    return "";
  }
}

function collectGarbage() {
  const orphans = db
    .prepare(
      "SELECT hash FROM blobs WHERE hash NOT IN (SELECT blob_hash FROM attachments)",
    )
    .all();

  for (const row of orphans) {
    try {
      fs.rmSync(blobPath(row.hash), { force: true });
    } catch {
      /* a blob that will not delete is not worth failing a save over */
    }
    db.prepare("DELETE FROM blobs WHERE hash = ?").run(row.hash);
  }

  return orphans.length;
}

function isUsable(database) {
  try {
    // quick_check walks the page structure, which a bare SELECT does not, so it
    // catches damage sitting in pages the health probe would never read.
    const report = database.prepare("PRAGMA quick_check(1)").get();
    const verdict = report ? String(Object.values(report)[0]) : "";

    if (verdict.toLowerCase() !== "ok") {
      log.warn("storage", `quick_check reported: ${verdict.slice(0, 200)}`);
      return false;
    }

    database.prepare("SELECT value FROM kv WHERE key = ?").get("schema_version");
    database.prepare("SELECT COUNT(*) AS n FROM message_search").get();
    database.prepare("SELECT COUNT(*) AS n FROM chats").get();
    return true;
  } catch (error) {
    log.warn("storage", `database is not usable: ${error.message}`);
    return false;
  }
}

function salvage(damagedPath, fresh) {
  const tables = [
    ["chats", "id, title, updated_at, is_out_of_context"],
    ["messages", "id, chat_id, position, role, payload"],
    ["attachments", "message_row_id, position, name, type, blob_hash"],
    ["blobs", "hash, bytes"],
  ];

  let rescued = 0;

  try {
    fresh.exec(`ATTACH DATABASE '${damagedPath.replace(/'/g, "''")}' AS damaged`);
  } catch (error) {
    log.warn("storage", `could not attach the damaged database: ${error.message}`);
    return rescued;
  }

  for (const [table, columns] of tables) {
    try {
      fresh.exec(
        `INSERT OR IGNORE INTO ${table} (${columns}) SELECT ${columns} FROM damaged.${table}`,
      );
      rescued += fresh.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    } catch (error) {
      log.warn("storage", `could not rescue ${table}: ${error.message}`);
    }
  }

  try {
    fresh.exec("DETACH DATABASE damaged");
  } catch {
    /* the rescue is already done; a failed detach changes nothing */
  }

  return rescued;
}

function rebuild(dbPath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const quarantine = `${dbPath}.corrupt-${stamp}`;

  try {
    if (db) db.close();
  } catch {
    /* the handle is already unusable */
  }
  db = null;

  for (const suffix of ["", "-wal", "-shm"]) {
    const from = dbPath + suffix;
    if (!fs.existsSync(from)) continue;
    try {
      fs.renameSync(from, quarantine + suffix);
    } catch {
      try {
        fs.rmSync(from, { force: true });
      } catch {
        /* nothing more can be done for this file */
      }
    }
  }

  log.warn("storage", `quarantined the damaged database as ${path.basename(quarantine)}`);

  db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);

  let rescued = 0;
  if (fs.existsSync(quarantine)) {
    try {
      rescued = salvage(quarantine, db);
    } catch (error) {
      log.warn("storage", `salvage failed: ${error.message}`);
    }
  }

  try {
    recordSchemaVersion(SCHEMA_VERSION);
  } catch {
    /* the fresh database is already at the current schema */
  }

  log.info("storage", `rebuilt the database, recovered ${rescued} row(s)`);
}

function init(userDataPath) {
  const dbPath = path.join(userDataPath, "draggy.db");
  blobDir = path.join(userDataPath, "blobs");

  fs.mkdirSync(blobDir, { recursive: true });

  // A damaged search index or key-value table would otherwise make every save
  // fail forever, with nothing but an unexplained warning in the interface.
  let healthy;

  try {
    db = new DatabaseSync(dbPath);
    db.exec(SCHEMA);
    migrate();
    healthy = isUsable(db);
  } catch (error) {
    log.warn("storage", `could not open the database: ${error.message}`);
    healthy = false;
  }

  if (!healthy) rebuild(dbPath);

  log.info("storage", `opened ${dbPath}`);
  return dbPath;
}


function schemaVersion() {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get("schema_version");
  return row ? Number(row.value) : null;
}

function recordSchemaVersion(version) {
  db.prepare(
    "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run("schema_version", String(version));
}

function hasLegacyMessageTable() {
  const columns = db.prepare("PRAGMA table_info(messages)").all();
  return columns.length > 0 && !columns.some((column) => column.name === "row_id");
}

function migrate() {
  const version = schemaVersion();

  if (version === null) {
    recordSchemaVersion(SCHEMA_VERSION);
    return;
  }

  if (version >= SCHEMA_VERSION) return;

  if (!hasLegacyMessageTable()) {
    recordSchemaVersion(SCHEMA_VERSION);
    return;
  }

  log.info("storage", `migrating chat database from v${version} to v${SCHEMA_VERSION}`);
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN");

  try {
    db.exec(`
      CREATE TABLE messages_next (
        row_id   INTEGER PRIMARY KEY AUTOINCREMENT,
        id       TEXT NOT NULL,
        chat_id  TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        role     TEXT NOT NULL,
        payload  TEXT NOT NULL,
        UNIQUE (chat_id, id)
      );

      INSERT INTO messages_next (id, chat_id, position, role, payload)
        SELECT id, chat_id, position, role, payload FROM messages;

      CREATE TABLE attachments_next (
        message_row_id INTEGER NOT NULL REFERENCES messages_next(row_id) ON DELETE CASCADE,
        position       INTEGER NOT NULL,
        name           TEXT NOT NULL,
        type           TEXT NOT NULL,
        blob_hash      TEXT NOT NULL,
        PRIMARY KEY (message_row_id, position)
      );

      INSERT INTO attachments_next (message_row_id, position, name, type, blob_hash)
        SELECT m.row_id, a.position, a.name, a.type, a.blob_hash
        FROM attachments a JOIN messages_next m ON m.id = a.message_id;

      DROP TABLE attachments;
      DROP TABLE messages;
      ALTER TABLE messages_next RENAME TO messages;
      ALTER TABLE attachments_next RENAME TO attachments;

      CREATE INDEX IF NOT EXISTS messages_by_chat ON messages(chat_id, position);
      CREATE INDEX IF NOT EXISTS attachments_by_blob ON attachments(blob_hash);
    `);

    recordSchemaVersion(SCHEMA_VERSION);
    db.exec("COMMIT");
    log.info("storage", "migration complete");
  } catch (error) {
    db.exec("ROLLBACK");
    log.error("storage", "migration failed", error);
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

function searchBody(message) {
  const parts = [message.content || "", message.textContent || ""];
  for (const attachment of message.attachments || []) parts.push(attachment.name);
  return parts.join("\n").slice(0, 20000);
}

function saveChat(session) {
  const transaction = () => {
    db.prepare(
      `INSERT INTO chats (id, title, updated_at, is_out_of_context)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         updated_at = excluded.updated_at,
         is_out_of_context = excluded.is_out_of_context`,
    ).run(
      session.id,
      String(session.title || ""),
      Number(session.updatedAt) || Date.now(),
      session.isOutOfContext ? 1 : 0,
    );

    db.prepare("DELETE FROM messages WHERE chat_id = ?").run(session.id);
    db.prepare("DELETE FROM message_search WHERE chat_id = ?").run(session.id);

    const insertMessage = db.prepare(
      "INSERT INTO messages (id, chat_id, position, role, payload) VALUES (?, ?, ?, ?, ?)",
    );
    const insertAttachment = db.prepare(
      "INSERT INTO attachments (message_row_id, position, name, type, blob_hash) VALUES (?, ?, ?, ?, ?)",
    );
    const insertSearch = db.prepare(
      "INSERT INTO message_search (chat_id, message_id, body) VALUES (?, ?, ?)",
    );

    const seen = new Set();

    session.messages.forEach((message, index) => {
      const { attachments, ...rest } = message;

      let id = String(message.id || `message-${index}`);
      while (seen.has(id)) id = `${id}-${index}`;
      seen.add(id);

      const inserted = insertMessage.run(
        id,
        session.id,
        index,
        message.role,
        JSON.stringify({ ...rest, id }),
      );

      const rowId = inserted.lastInsertRowid;

      (attachments || []).forEach((attachment, slot) => {
        insertAttachment.run(
          rowId,
          slot,
          String(attachment.name || ""),
          String(attachment.type || ""),
          writeBlob(String(attachment.content || "")),
        );
      });

      insertSearch.run(session.id, id, searchBody(message));
    });
  };

  db.exec("BEGIN");
  try {
    transaction();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { success: true };
}

function hydrateChat(chatRow) {
  const messageRows = db
    .prepare(
      "SELECT row_id, id, role, payload FROM messages WHERE chat_id = ? ORDER BY position ASC",
    )
    .all(chatRow.id);

  const attachmentStatement = db.prepare(
    "SELECT name, type, blob_hash FROM attachments WHERE message_row_id = ? ORDER BY position ASC",
  );

  const messages = messageRows.map((row) => {
    const message = JSON.parse(row.payload);
    const attachments = attachmentStatement.all(row.row_id);

    if (attachments.length > 0) {
      message.attachments = attachments.map((attachment) => ({
        name: attachment.name,
        type: attachment.type,
        content: readBlob(attachment.blob_hash),
      }));
    }

    return message;
  });

  return {
    id: chatRow.id,
    title: chatRow.title,
    updatedAt: chatRow.updated_at,
    isOutOfContext: Boolean(chatRow.is_out_of_context),
    isGenerating: false,
    messages,
  };
}

function loadChats() {
  const rows = db
    .prepare("SELECT id, title, updated_at, is_out_of_context FROM chats ORDER BY updated_at DESC")
    .all();
  return rows.map(hydrateChat);
}

function loadChatSummaries() {
  return db
    .prepare(
      `SELECT c.id, c.title, c.updated_at, c.is_out_of_context,
              (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS message_count
       FROM chats c ORDER BY c.updated_at DESC`,
    )
    .all()
    .map((row) => ({
      id: row.id,
      title: row.title,
      updatedAt: row.updated_at,
      isOutOfContext: Boolean(row.is_out_of_context),
      messageCount: row.message_count,
    }));
}

function deleteChat(id) {
  db.prepare("DELETE FROM chats WHERE id = ?").run(id);
  db.prepare("DELETE FROM message_search WHERE chat_id = ?").run(id);
  collectGarbage();
  return { success: true };
}

function clearChats() {
  db.exec("DELETE FROM chats");
  db.exec("DELETE FROM message_search");
  collectGarbage();
  return { success: true };
}

function searchChats(query) {
  const term = String(query || "").trim();
  if (!term) return [];

  try {
    return db
      .prepare(
        `SELECT s.chat_id, s.message_id, c.title,
                snippet(message_search, 2, '[', ']', '…', 12) AS excerpt
         FROM message_search s
         JOIN chats c ON c.id = s.chat_id
         WHERE message_search MATCH ?
         ORDER BY rank
         LIMIT 50`,
      )
      .all(`"${term.replace(/"/g, '""')}"*`)
      .map((row) => ({
        chatId: row.chat_id,
        messageId: row.message_id,
        title: row.title,
        excerpt: row.excerpt,
      }));
  } catch {
    return [];
  }
}

function getValue(key) {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key);
  return row ? row.value : null;
}

function setValue(key, value) {
  db.prepare(
    "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, String(value));
  return { success: true };
}

function importSessions(sessions) {
  let imported = 0;
  for (const session of sessions || []) {
    if (!session || !session.id) continue;
    try {
      saveChat({
        id: session.id,
        title: session.title || "",
        updatedAt: session.updatedAt || Date.now(),
        isOutOfContext: Boolean(session.isOutOfContext),
        messages: Array.isArray(session.messages) ? session.messages : [],
      });
      imported++;
    } catch (error) {
      log.error("storage", `import failed for ${session.id}`, error);
    }
  }
  log.info("storage", `imported ${imported} chats from localStorage`);
  return { success: true, imported };
}

function stats() {
  const chats = db.prepare("SELECT COUNT(*) AS n FROM chats").get().n;
  const messages = db.prepare("SELECT COUNT(*) AS n FROM messages").get().n;
  const blobRow = db
    .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS total FROM blobs")
    .get();

  return {
    chats,
    messages,
    attachments: blobRow.n,
    attachmentBytes: blobRow.total,
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
  saveChat,
  loadChats,
  loadChatSummaries,
  deleteChat,
  clearChats,
  searchChats,
  getValue,
  setValue,
  importSessions,
  stats,
  collectGarbage,
  close,
};
