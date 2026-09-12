const fs = require("fs");
const path = require("path");
const { log } = require("./logger.cjs");

/**
 * Credentials, kept out of the database. Extension tokens used to sit in the
 * `mcpServers` row in plain text, where a backup, a support log or anything
 * that could read the file could read them too. They live here instead,
 * encrypted by the operating system's own keystore.
 *
 * safeStorage is Electron's wrapper over DPAPI on Windows, the Keychain on
 * macOS and libsecret on Linux. Where none of those is available it refuses,
 * and so does this: a secret Draggy cannot protect is one it does not keep.
 */

let storePath = null;
let cache = null;

/** Injected so the tests can drive this without an Electron process. */
let vault = null;

function init(userDataPath, safeStorage) {
  storePath = path.join(userDataPath, "secrets.bin");
  vault = safeStorage;
  cache = null;
  return storePath;
}

function available() {
  try {
    return Boolean(vault && vault.isEncryptionAvailable());
  } catch {
    return false;
  }
}

function read() {
  if (cache) return cache;
  cache = {};

  if (!storePath || !fs.existsSync(storePath) || !available()) return cache;

  try {
    const decrypted = vault.decryptString(fs.readFileSync(storePath));
    const parsed = JSON.parse(decrypted);
    if (parsed && typeof parsed === "object") cache = parsed;
  } catch (error) {
    // A store written by another machine, another user, or a different install
    // cannot be read back. Losing it means entering the credentials again,
    // which is better than refusing to start.
    log.warn("secrets", `could not read the store: ${error.message}`);
  }

  return cache;
}

function write() {
  if (!storePath || !available()) return false;

  try {
    fs.writeFileSync(storePath, vault.encryptString(JSON.stringify(cache)), {
      mode: 0o600,
    });
    return true;
  } catch (error) {
    log.error("secrets", `could not write the store: ${error.message}`);
    return false;
  }
}

/** Everything held for one owner: a server id, usually. */
function get(owner) {
  return read()[String(owner)] ?? {};
}

function set(owner, values) {
  read();

  const kept = {};
  for (const [key, value] of Object.entries(values || {})) {
    if (value === null || value === undefined || value === "") continue;
    kept[key] = String(value);
  }

  if (Object.keys(kept).length === 0) delete cache[String(owner)];
  else cache[String(owner)] = kept;

  return write();
}

function remove(owner) {
  read();
  delete cache[String(owner)];
  return write();
}

function owners() {
  return Object.keys(read());
}

/**
 * Moves credentials out of wherever they were kept before. Returns what the
 * caller should write back in their place: the same records with the secret
 * fields gone.
 *
 * `isSecret` decides field by field, because a server's configuration holds
 * both a token and the folder it is pointed at, and only one of those is worth
 * protecting.
 */
function adopt(records, isSecret) {
  if (!available()) return { moved: 0, records };

  let moved = 0;
  const cleaned = {};

  for (const [owner, record] of Object.entries(records || {})) {
    const secrets = {};
    const rest = { ...record };

    for (const [field, value] of Object.entries(record?.env || {})) {
      if (!isSecret(field, owner)) continue;
      if (value === null || value === undefined || value === "") continue;

      secrets[field] = String(value);
      moved++;
    }

    if (Object.keys(secrets).length > 0) {
      const existing = get(owner);
      set(owner, { ...existing, ...secrets });

      rest.env = Object.fromEntries(
        Object.entries(record.env).filter(([field]) => !(field in secrets)),
      );
    }

    cleaned[owner] = rest;
  }

  if (moved > 0) log.info("secrets", `moved ${moved} credential(s) into the store`);

  return { moved, records: cleaned };
}

/** For a server about to start: what it was configured with, secrets included. */
function withSecrets(owner, env) {
  return { ...(env || {}), ...get(owner) };
}

function close() {
  cache = null;
}

module.exports = {
  adopt,
  available,
  close,
  get,
  init,
  owners,
  remove,
  set,
  withSecrets,
};
