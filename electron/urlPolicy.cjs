const { log } = require("./logger.cjs");

/** Which URLs the model may make the app fetch. Chromium will render `file:///…/.aws/credentials`
 * as text, so the reachable surface is an allowlist. */

/** Refusals this session, by the rule that refused. Read by `sessionCounts()` at quit. */
const refusals = { empty: 0, control_char: 0, invalid: 0, protocol: 0, no_host: 0, private_host: 0 };

function refuse(rule, data = {}) {
  refusals[rule]++;
  log.debug("net.policy", "url refused", { rule, ...data });
  return false;
}

/** Per-session refusal counts, logged at INFO. The quit path calls this once. */
function sessionCounts() {
  const counts = { ...refusals };
  log.info("net.policy", "url refusals this session", counts);
  return counts;
}

/** The only two schemes anything on the web is actually served over. */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** Hosts on this machine or its network: a router panel, a staging box, the engine itself. Checked
 * literally, so a name resolving to 127.0.0.1 still gets through. */
const PRIVATE_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "localhost4",
  "localhost4.localdomain4",
  "localhost6",
  "localhost6.localdomain6",
  "ip6-localhost",
  "ip6-loopback",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

/** An IPv6 literal in the spelling the URL parser gives it, so every spelling of one address agrees. Null when it is not one. */
function canonicalIPv6(host) {
  if (!host.includes(":") || !/^[0-9a-f:.]+$/i.test(host)) return null;
  try {
    return new URL(`http://[${host}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }
}

/** Loopback, unspecified and link-local IPv6, and IPv4-mapped addresses under the IPv4 rules. */
function isPrivateIPv6(address) {
  if (address === "::1" || address === "::") return true;
  if (/^fe[89ab][0-9a-f]:/.test(address)) return true;

  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
  if (mapped) {
    const high = parseInt(mapped[1], 16);
    const low = parseInt(mapped[2], 16);
    return isPrivateHostname(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }

  return false;
}

function isPrivateHostname(hostname) {
  // A trailing dot names the same host, so one is dropped before any check.
  const host = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");

  if (PRIVATE_HOSTNAMES.has(host) || PRIVATE_HOSTNAMES.has(hostname.toLowerCase())) {
    return true;
  }

  // mDNS and the suffix Chromium maps to loopback on its own.
  if (host.endsWith(".local") || host.endsWith(".localhost")) return true;

  // IPv6 unique-local, fc00::/7.
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;

  const canonical = canonicalIPv6(host);
  if (canonical !== null) return isPrivateIPv6(canonical);

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
    // Carrier-grade NAT, 100.64.0.0/10.
    if (a === 100 && b >= 64 && b <= 127) return true;
  }

  return false;
}

/** Whether a URL may be fetched. `allowPrivate` separates the user, who may ask for their own dev
 * server, from the model, which may not. */
function isFetchableUrl(value, { allowPrivate = false } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return refuse("empty");

  // A newline or NUL inside a scheme is a parser trick, not a typed URL.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(raw)) return refuse("control_char");

  let url;
  try {
    url = new URL(raw);
  } catch {
    return refuse("invalid");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol.toLowerCase())) return refuse("protocol", { scheme: url.protocol });
  if (!url.hostname) return refuse("no_host");
  if (!allowPrivate && isPrivateHostname(url.hostname)) return refuse("private_host", { host: url.hostname });

  return true;
}

/** Why a URL was refused, worded for the model. A refusal it cannot interpret reads as a transient
 * failure worth retrying five more ways. */
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

/** What Draggy's own window may use: the microphone for Talk, and clipboard writes for copy
 * buttons, those only from its own pages and never from a widget frame. */
function permissionGranted(permission, { fromAppWindow, fromAppPage }) {
  if (!fromAppWindow) return false;
  if (permission === "media") return true;
  return permission === "clipboard-sanitized-write" && Boolean(fromAppPage);
}

module.exports = {
  ALLOWED_PROTOCOLS,
  permissionGranted,
  isFetchableUrl,
  isPrivateHostname,
  refusalFor,
  sessionCounts,
};
