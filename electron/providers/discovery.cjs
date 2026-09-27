/** Finds local model servers on this computer: loopback only, a short timeout, and never Draggy's own
 * ports, where its engine would pass for llama.cpp and its API server for an OpenAI-compatible one. */
const { catalog } = require("./catalog.cjs");

const HOST = "127.0.0.1";
const TIMEOUT_MS = 400;
const DEV_PORT = 5173;

// Ports 8000 and 8080 are shared, so a server is named by what it answers, never by where it listens.
const SIGNATURES = [
  { type: "ollama", path: "/api/version", test: (json) => typeof json?.version === "string" },
  { type: "lmstudio", path: "/api/v0/models", test: (json) => Array.isArray(json?.data) },
  { type: "llamacpp", path: "/props", test: (json) => Boolean(json?.default_generation_settings || json?.total_slots) },
  { type: "vllm", path: "/version", test: (json) => typeof json?.version === "string" },
  { type: "lemonade", path: "/api/v1/models", test: (json) => Array.isArray(json?.data) },
];

class Refused extends Error {}

function withPort(baseUrl, port) {
  const url = new URL(baseUrl);
  url.port = String(port);
  return url.toString().replace(/\/+$/, "");
}

/** `excludedPorts` is read on every scan, since the engine and the API server can move. */
function createDiscovery({ excludedPorts = () => [], fetchImpl = globalThis.fetch, isDev = () => false }) {
  async function probe(port, path) {
    let response;
    try {
      response = await fetchImpl(`http://${HOST}:${port}${path}`, { method: "GET", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new Refused(String(port));
    }
    if (!response.ok) return null;
    return response.json().catch(() => null);
  }

  async function identify(port) {
    const entries = catalog().filter((entry) => entry.kind === "local");
    try {
      for (const signature of SIGNATURES) {
        const json = await probe(port, signature.path);
        if (!signature.test(json)) continue;
        const entry = entries.find((e) => e.id === signature.type);
        return { type: entry.id, name: entry.name, port, baseUrl: withPort(entry.baseUrl, port), guessed: false };
      }
      const listing = await probe(port, "/v1/models");
      if (!Array.isArray(listing?.data)) return null;
      // Only a listing to go on: named after the catalog's usual server on this port, and marked a guess.
      const entry = entries.find((e) => e.discovery?.port === port && e.discovery.probe === "/v1/models");
      return entry ? { type: entry.id, name: entry.name, port, baseUrl: withPort(entry.baseUrl, port), guessed: true } : null;
    } catch (error) {
      if (error instanceof Refused) return null;
      throw error;
    }
  }

  /** The ports scanned: every local server's usual one, minus Draggy's own. */
  function ports() {
    const own = new Set([...excludedPorts(), ...(isDev() ? [DEV_PORT] : [])].map(Number));
    const usual = catalog()
      .filter((entry) => entry.kind === "local" && entry.discovery)
      .map((entry) => entry.discovery.port);
    return [...new Set(usual)].filter((port) => !own.has(port));
  }

  async function scan() {
    const found = await Promise.all(ports().map(identify));
    return found.filter(Boolean);
  }

  return { scan, ports };
}

module.exports = { createDiscovery };
