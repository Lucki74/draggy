const fs = require("fs");
const path = require("path");

/**
 * Site icons, asked of the site itself rather than Google's service, which
 * would learn every domain the user looks at. Served back over `draggy://`.
 */

const HOSTNAME_RE = /^[a-z0-9][a-z0-9.-]{0,253}$/i;

const FETCH_TIMEOUT_MS = 5000;
const MAX_ICON_BYTES = 256 * 1024;

/**
 * The formats a favicon arrives in, sniffed rather than trusted from
 * Content-Type: an HTML error page should not be cached as an icon.
 */
function sniffImageType(bytes) {
  if (bytes.length < 4) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01) return "image/x-icon";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/webp";
  if (bytes.subarray(0, 300).includes(Buffer.from("<svg"))) return "image/svg+xml";
  return null;
}

function isValidHostname(hostname) {
  return (
    typeof hostname === "string" &&
    HOSTNAME_RE.test(hostname) &&
    !hostname.includes("..")
  );
}

async function fetchIcon(url, deps) {
  try {
    const response = await deps.fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!response.ok) return null;

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_ICON_BYTES) return null;
    return sniffImageType(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * Every icon a page declares, for sites without /favicon.ico. Values match
 * quoted or bare, since minified pages drop the quotes.
 */
const LINK_ICON_RE =
  /<link\b[^>]*\brel\s*=\s*(?:"[^"]*\bicon\b[^"]*"|'[^']*\bicon\b[^']*'|[^\s"'>]*icon[^\s>]*)[^>]*>/gi;

const HREF_RE = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

async function declaredIconUrls(origin, deps) {
  try {
    const response = await deps.fetch(origin, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!response.ok) return [];

    const html = (await response.text()).slice(0, 60000);
    const urls = [];

    for (const tag of html.match(LINK_ICON_RE) ?? []) {
      const match = tag.match(HREF_RE);
      let href = match?.[1] ?? match?.[2] ?? match?.[3];
      if (!href) continue;

      // A bare value swallows the slash of a self-closing tag; no icon path
      // ends in one.
      if (href.endsWith("/")) href = href.slice(0, -1);
      if (!href) continue;

      try {
        urls.push(new URL(href, origin).toString());
      } catch {
        /* a href that is not a URL is not an icon */
      }
      if (urls.length >= 3) break;
    }

    return urls;
  } catch {
    return [];
  }
}

/**
 * The icon bytes for a host, from disk when asked before. A host with none is
 * remembered as an empty file, so ten results do not re-ask a dead endpoint.
 */
async function loadFavicon(cacheDir, hostname, deps = { fetch }) {
  if (!isValidHostname(hostname)) return null;

  const cached = path.join(cacheDir, `${hostname}.icon`);

  try {
    if (fs.existsSync(cached)) {
      const bytes = fs.readFileSync(cached);
      return bytes.length === 0 ? null : bytes;
    }
  } catch {
    /* fall through and fetch */
  }

  const origin = `https://${hostname}`;
  let bytes = await fetchIcon(`${origin}/favicon.ico`, deps);

  if (!bytes) {
    for (const url of await declaredIconUrls(origin, deps)) {
      bytes = await fetchIcon(url, deps);
      if (bytes) break;
    }
  }

  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cached, bytes ?? Buffer.alloc(0));
  } catch {
    /* an un-writable cache costs a refetch, not a broken icon */
  }

  return bytes;
}

module.exports = {
  loadFavicon,
  sniffImageType,
  isValidHostname,
  MAX_ICON_BYTES,
};
