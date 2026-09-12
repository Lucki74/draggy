const fs = require("fs");
const path = require("path");
const { log } = require("./logger.cjs");
const catalogue = require("./mcpCatalogue.cjs");

/**
 * Finding servers Draggy does not ship. The catalogue is still what the app
 * opens with, because it works with no network at all and every entry in it was
 * checked by hand; the registry is what the user reaches for when they want
 * something that is not in it.
 *
 * Nothing here runs on its own. A search happens because somebody typed one,
 * which is the only reason this file is allowed to touch the network.
 */

const REGISTRY_URL = "https://registry.modelcontextprotocol.io/v0/servers";

/** How long a search is worth keeping before asking again. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const SEARCH_TIMEOUT_MS = 15000;

let cachePath = null;

function init(userDataPath) {
  cachePath = path.join(userDataPath, "registry-cache.json");
  return cachePath;
}

function readCache() {
  if (!cachePath || !fs.existsSync(cachePath)) return {};

  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(cache) {
  if (!cachePath) return;

  try {
    fs.writeFileSync(cachePath, JSON.stringify(cache));
  } catch (error) {
    log.warn("registry", `could not write the cache: ${error.message}`);
  }
}

/** The last name segment, since registry names are namespaced like packages. */
function idFor(name) {
  const parts = String(name || "").split("/");
  return (
    parts[parts.length - 1]
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "server"
  );
}

/**
 * One registry entry as Draggy describes a server: either a package it can
 * install, or an address it can call. Anything it could do neither with is
 * dropped rather than shown as something that will fail when switched on.
 */
function toEntry(server) {
  const npm = (server?.packages || []).find(
    (one) => (one.registry_name || one.registryType) === "npm",
  );

  const remote = (server?.remotes || []).find((one) =>
    ["streamable-http", "streamable", "http", "sse"].includes(
      String(one.type || one.transport_type || "").toLowerCase(),
    ),
  );

  if (!npm && !remote) return null;

  return {
    id: idFor(server.name),
    name: server.title || server.name,
    description: String(server.description || "").trim(),
    source: "registry",
    docs: server.repository?.url || server.website_url || "",
    ...(npm
      ? { package: npm.name || npm.identifier, args: [], env: [] }
      : { url: remote.url, transport: "http", remote: true }),
  };
}

function parseServers(payload) {
  const servers = Array.isArray(payload?.servers)
    ? payload.servers
    : Array.isArray(payload)
      ? payload
      : [];

  return servers
    .map((one) => toEntry(one?.server || one))
    .filter(Boolean)
    // Anything Draggy already ships is better described by its own entry.
    .filter((entry) => !catalogue.findEntry(entry.id));
}

/**
 * Searches the registry, or hands back the last answer when there is no
 * network. The cache is per query, so a second look at the same search costs
 * nothing and works on a train.
 */
async function search(query, { fetchImpl = fetch, now = Date.now() } = {}) {
  const term = String(query || "").trim();
  const cache = readCache();
  const cached = cache[term.toLowerCase()];

  if (cached && now - cached.at < CACHE_TTL_MS) {
    return { success: true, entries: cached.entries, cached: true };
  }

  try {
    const url = new URL(REGISTRY_URL);
    if (term) url.searchParams.set("search", term);
    url.searchParams.set("limit", "30");

    const response = await fetchImpl(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });

    if (!response.ok) throw new Error(`the registry answered ${response.status}`);

    const entries = parseServers(await response.json());

    cache[term.toLowerCase()] = { at: now, entries };
    writeCache(cache);

    return { success: true, entries, cached: false };
  } catch (error) {
    // Offline, or the registry is down. The stale answer is worth more than an
    // empty screen, and the catalogue is still there underneath.
    if (cached) {
      return { success: true, entries: cached.entries, cached: true, stale: true };
    }

    return { success: false, error: error.message, entries: [] };
  }
}

function forget() {
  if (cachePath && fs.existsSync(cachePath)) fs.rmSync(cachePath, { force: true });
}

module.exports = {
  CACHE_TTL_MS,
  REGISTRY_URL,
  forget,
  idFor,
  init,
  parseServers,
  search,
  toEntry,
};
