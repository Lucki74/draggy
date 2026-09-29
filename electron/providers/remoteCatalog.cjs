/** providers.json from draggy.org: new models, capabilities and API-key providers between releases.
 * Only a file signed with the key below is used, and it may never redirect a provider or add an account. */
const crypto = require("node:crypto");
const { bundledCatalog, useCatalog, problemWith } = require("./catalog.cjs");

const URL_JSON = "https://draggy.org/providers.json";
const STORE = "providers.remote";
const DAY = 24 * 60 * 60 * 1000;
const PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA0t8tmRLchjHxbg6zg+3q+VMdvhw1nZVbOi8O8AOaciU=\n-----END PUBLIC KEY-----\n";

// What the file may change on a provider Draggy already ships.
const TUNABLE = ["capabilityPatterns", "defaultModels", "quirks"];
// What must match, so a signed file still cannot send a key or a conversation somewhere new.
const FIXED = ["kind", "protocol", "baseUrl", "auth"];
const KEY_PROTOCOLS = new Set(["openai", "anthropic", "gemini"]);
const KEY_AUTHS = new Set(["bearer", "x-api-key", "x-goog-api-key"]);

function verified(body, signature, publicKey = PUBLIC_KEY) {
  try {
    return crypto.verify(null, Buffer.from(body, "utf8"), publicKey, Buffer.from(String(signature).trim(), "base64"));
  } catch {
    return false;
  }
}

const reject = (reason) => {
  throw new Error(`providers.json rejected: ${reason}`);
};
const pick = (from, keys) => Object.fromEntries(keys.filter((key) => from[key] !== undefined).map((key) => [key, from[key]]));

/**
 * The bundled catalog with the file laid over it, or a throw naming the first forbidden change.
 * `previous` is the last accepted file; a remote-only provider the user added must keep its address from it.
 */
function merge(file, { inUse = new Set(), previous = null } = {}) {
  if (!file || file.version !== 1 || !Array.isArray(file.providers)) reject("not version 1");
  const bundled = new Map(bundledCatalog().map((entry) => [entry.id, entry]));
  const before = new Map((previous?.providers || []).map((entry) => [entry?.id, entry]));
  const overrides = new Map();
  const added = [];
  for (const raw of file.providers) {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string") reject("an entry has no id");
    if (overrides.has(raw.id) || added.some((entry) => entry.id === raw.id)) reject(`${raw.id} appears twice`);
    const own = bundled.get(raw.id);
    if (own) {
      if (own.kind === "account") reject(`${raw.id} is an account`);
      for (const key of FIXED) if (key in raw && raw[key] !== own[key]) reject(`${raw.id} changes ${key}`);
      const entry = { ...own, ...pick(raw, TUNABLE) };
      const problem = problemWith(entry);
      if (problem) reject(`${raw.id}: ${problem}`);
      overrides.set(raw.id, entry);
      continue;
    }
    if (raw.kind !== "cloud" || !KEY_PROTOCOLS.has(raw.protocol) || !KEY_AUTHS.has(raw.auth)) reject(`${raw.id} is not an API-key provider`);
    const prior = before.get(raw.id);
    if (inUse.has(raw.id) && (!prior || FIXED.some((key) => raw[key] !== prior[key]))) reject(`${raw.id} is in use and changes its address`);
    const entry = {
      ...pick(raw, ["id", "name", "kind", "protocol", "baseUrl", "keyUrl", "auth", ...TUNABLE]),
      capabilityPatterns: raw.capabilityPatterns || [],
      defaultModels: raw.defaultModels || [],
      quirks: raw.quirks || {},
      remote: true,
    };
    const problem = problemWith(entry);
    if (problem) reject(`${raw.id}: ${problem}`);
    added.push(entry);
  }
  // A provider the user added from an earlier file keeps working if a later one drops it.
  for (const id of inUse) {
    const prior = before.get(id);
    if (prior && !bundled.has(id) && !added.some((entry) => entry.id === id)) added.push({ ...prior, remote: true });
  }
  return [...bundledCatalog().map((entry) => overrides.get(entry.id) || entry), ...added];
}

function createRemoteCatalog({ storage, fetchImpl = fetch, publicKey = PUBLIC_KEY, now = Date.now, log = () => {}, instances = () => [] }) {
  const read = () => {
    try {
      return JSON.parse(storage.getValue(STORE) || "{}");
    } catch {
      return {};
    }
  };
  const inUse = () => new Set(instances().map((instance) => instance.type));
  const cloudEnabled = () => instances().some((instance) => instance.enabled && instance.kind === "cloud");

  /** Lays the last accepted file over the catalog at start, checked again as if just fetched. */
  function load() {
    const saved = read();
    if (!saved.body) return false;
    try {
      if (!verified(saved.body, saved.signature, publicKey)) reject("stored copy fails its signature");
      useCatalog(merge(JSON.parse(saved.body), { inUse: inUse(), previous: JSON.parse(saved.body) }));
      return true;
    } catch (error) {
      log(error.message);
      return false;
    }
  }

  /** At most once a day, and only while a cloud provider is on. Any failure keeps what is in use. */
  async function refresh() {
    if (!cloudEnabled()) return "skipped";
    const saved = read();
    if (saved.checkedAt && now() - saved.checkedAt < DAY) return "fresh";
    storage.setValue(STORE, JSON.stringify({ ...saved, checkedAt: now() }));
    try {
      const headers = saved.body && saved.etag ? { "If-None-Match": saved.etag } : {};
      const response = await fetchImpl(URL_JSON, { headers, signal: AbortSignal.timeout(15000) });
      if (response.status === 304) return "unchanged";
      if (!response.ok) reject(`HTTP ${response.status}`);
      const body = await response.text();
      const sig = await fetchImpl(`${URL_JSON}.sig`, { signal: AbortSignal.timeout(15000) });
      if (!sig.ok) reject(`signature HTTP ${sig.status}`);
      const signature = await sig.text();
      if (!verified(body, signature, publicKey)) reject("bad signature");
      let file;
      try {
        file = JSON.parse(body);
      } catch {
        reject("not JSON");
      }
      const entries = merge(file, { inUse: inUse(), previous: saved.body ? JSON.parse(saved.body) : null });
      storage.setValue(STORE, JSON.stringify({ body, signature, etag: response.headers.get("etag") || "", checkedAt: now() }));
      useCatalog(entries);
      return "updated";
    } catch (error) {
      log(error.message);
      return "failed";
    }
  }

  return { load, refresh };
}

module.exports = { createRemoteCatalog, merge, verified, PUBLIC_KEY };
