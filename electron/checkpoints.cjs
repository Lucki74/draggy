const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { log } = require("./logger.cjs");

/** Old file bytes, kept before every model write so undo never depends on git. Content addressed,
 * so ten edits keep only the distinct versions. */

let storeDir = null;

function init(userDataPath) {
  storeDir = path.join(userDataPath, "checkpoints");
  fs.mkdirSync(storeDir, { recursive: true });
  return storeDir;
}

function blobPath(hash) {
  return path.join(storeDir, hash.slice(0, 2), hash);
}

/** Stores content and returns its name. Bytes, not text,
 * so an image comes back as the same image. */
function keep(contents) {
  const bytes = Buffer.isBuffer(contents)
    ? contents
    : Buffer.from(String(contents), "utf8");

  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  const target = blobPath(hash);

  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    log.debug("files", "checkpoint blob stored", { bytes: bytes.length });
  }

  return hash;
}

/** The bytes back, exactly as they were. Null when the store has lost them. */
function read(hash) {
  if (!hash) return null;

  try {
    return fs.readFileSync(blobPath(hash));
  } catch (error) {
    log.warn("files", "checkpoint blob unreadable", { code: error?.code ?? null });
    return null;
  }
}

/** The state of a file before a change. A file that is not there yet gets a null hash, which is how
 * a revert knows to remove what was created rather than to write something back. */
function snapshot(file) {
  try {
    const stats = fs.statSync(file);
    if (!stats.isFile()) return null;
    return keep(fs.readFileSync(file));
  } catch (error) {
    log.swallow("files", error, "a file not there yet has no earlier version to keep");
    return null;
  }
}

/** How much of the store is no longer referenced by any checkpoint row. */
function collect(usedHashes) {
  if (!storeDir || !fs.existsSync(storeDir)) return 0;

  const used = new Set(usedHashes);
  let removed = 0;

  for (const shard of fs.readdirSync(storeDir)) {
    const shardDir = path.join(storeDir, shard);

    let entries;
    try {
      entries = fs.readdirSync(shardDir);
    } catch {
      continue;
    }

    for (const name of entries) {
      if (used.has(name)) continue;
      try {
        fs.rmSync(path.join(shardDir, name), { force: true });
        removed++;
      } catch (error) {
        log.swallow("files", error, "a blob that will not delete is not worth failing a cleanup over");
      }
    }
  }

  log.info("files", "checkpoints collected", { removed, kept: used.size });
  return removed;
}

module.exports = { collect, init, keep, read, snapshot };
