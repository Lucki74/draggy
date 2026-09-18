const fs = require("fs");
const path = require("path");
const { log } = require("./logger.cjs");

/** Credentials encrypted by the OS keystore (DPAPI, Keychain, libsecret) instead of plain text in
 * the database. Without a keystore it refuses to keep them. */

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
    // A store written by another machine, another user, or a different install cannot be read back.
    // Losing it means entering the credentials again, which is better than refusing to start.
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

/** Moves credentials out of old records and returns them without the secret fields. `isSecret`
 * decides per field, since a token and a folder share a config. */
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
