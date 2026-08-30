const fs = require("fs");
const path = require("path");

/**
 * Site icons for search results.
 *
 * Fetched from the site itself rather than from Google's favicon service,
 * which is what this used to do: asking a third party for an icon tells that
 * third party every domain the user is looking at, and the only party who
 * learns anything this way is the site whose result is already on screen.
 *
 * Served back to the renderer over `draggy://`, because the renderer's own
 * content policy allows images from exactly two places and a remote host is
 * not one of them. Plain `fetch` rather than a session, so nothing carries a
 * cookie.
 */

const HOSTNAME_RE = /^[a-z0-9][a-z0-9.-]{0,253}$/i;

const FETCH_TIMEOUT_MS = 5000;
const MAX_ICON_BYTES = 256 * 1024;

/**
 * The image formats a favicon actually arrives in.
 *
 * Sniffed rather than trusted from Content-Type, because a wrong header is
 * common and an HTML error page served as an icon should not be cached as
 * one. A file that matches nothing here is not an image.
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
 * Every icon a page declares in its head, for the sites without
 * /favicon.ico.
 *
 * Attribute values are matched quoted or bare, because plenty of real pages
 * are minified to `rel=icon href=/favicon.ico` and requiring quotes silently
 * loses them. Several are returned rather than one, since the first declared
 * icon is not always the one that actually resolves.
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
 * The icon bytes for a host, from disk when it has been asked for before.
 *
 * A host with no usable icon is remembered as an empty file, so a list of ten
 * results does not re-ask the same dead endpoint every time it is rendered.
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
