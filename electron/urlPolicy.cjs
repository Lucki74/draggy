/**
 * Which URLs the model may make the app fetch. Chromium will render
 * `file:///…/.aws/credentials` as text, so the reachable surface is an allowlist.
 */

/** The only two schemes anything on the web is actually served over. */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Hosts on this machine or its network: a router panel, a staging box, Ollama
 * itself. Checked literally, so a name resolving to 127.0.0.1 still gets through.
 */
const PRIVATE_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

function isPrivateHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (PRIVATE_HOSTNAMES.has(host) || PRIVATE_HOSTNAMES.has(hostname.toLowerCase())) {
    return true;
  }

  // mDNS and the suffix Chromium maps to loopback on its own.
  if (host.endsWith(".local") || host.endsWith(".localhost")) return true;

  // IPv6 loopback and unique-local, written out rather than abbreviated.
  if (host === "0:0:0:0:0:0:0:1") return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;

  const octets = host.split(".");
  if (octets.length === 4 && octets.every((part) => /^\d{1,3}$/.test(part))) {
    const [a, b] = octets.map(Number);
    if (octets.some((part) => Number(part) > 255)) return false;

    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    // Link-local, which is also where every cloud provider keeps its metadata
    // service on 169.254.169.254.
    if (a === 169 && b === 254) return true;
  }

  return false;
}

/**
 * Whether a URL may be fetched. `allowPrivate` separates the user, who may ask
 * for their own dev server, from the model, which may not.
 */
function isFetchableUrl(value, { allowPrivate = false } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return false;

  // A newline or NUL inside a scheme is a parser trick, not a typed URL.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(raw)) return false;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol.toLowerCase())) return false;
  if (!url.hostname) return false;
  if (!allowPrivate && isPrivateHostname(url.hostname)) return false;

  return true;
}

/**
 * Why a URL was refused, worded for the model. A refusal it cannot interpret
 * reads as a transient failure worth retrying five more ways.
 */
function refusalFor(value) {
  const raw = String(value ?? "").trim();

  let url;
  try {
    url = new URL(raw);
  } catch {
    return "That is not a valid web address. Only http:// and https:// pages can be read.";
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol.toLowerCase())) {
    return `Refused: ${url.protocol} addresses cannot be opened. Only http:// and https:// pages can be read, so local files and app-internal addresses are out of reach. Tell the user this rather than trying another way in.`;
  }

  if (!url.hostname) {
    return "That address has no host, so there is nothing to fetch.";
  }

  return "Refused: that address is on this machine or its local network, which is not reachable from here. Only public web pages can be read.";
}

module.exports = {
  ALLOWED_PROTOCOLS,
  isFetchableUrl,
  isPrivateHostname,
  refusalFor,
};
