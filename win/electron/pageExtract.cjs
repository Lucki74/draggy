// Page reading for read_url: metadata, script-shell detection, paging and the fetch-first flow.
// The DOM work (Readability, Turndown) runs in a window the caller supplies, never in Node.
const fs = require("fs");
const path = require("path");

const PAGE_SIZE = 12000;
const MIN_TEXT = 500;
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_HOPS = 5;
const CACHE_LIMIT = 24;
const CACHE_TTL_MS = 30 * 60 * 1000;

const decodeEntities = (value) =>
  String(value)
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const clean = (value) => {
  if (value === undefined || value === null) return null;
  const text = decodeEntities(String(value)).replace(/\s+/g, " ").trim();
  return text || null;
};

function attributesOf(tag) {
  const attrs = {};
  const re = /([^\s"'<>/=]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match;
  const inner = tag.replace(/^<\w+/, "").replace(/\/?>$/, "");
  while ((match = re.exec(inner))) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function metaMap(html) {
  const map = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = attributesOf(tag);
    const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (key && attrs.content !== undefined && !(key in map)) map[key] = attrs.content;
  }
  return map;
}

const ARTICLE_TYPES = /^(Article|NewsArticle|BlogPosting|ScholarlyArticle|TechArticle|Report|WebPage|ReportageNewsArticle|LiveBlogPosting)$/;

function jsonLdNodes(html) {
  const nodes = [];
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    let data;
    try {
      data = JSON.parse(match[1].trim());
    } catch {
      continue;
    }
    const stack = [data];
    while (stack.length) {
      const item = stack.shift();
      if (Array.isArray(item)) stack.push(...item);
      else if (item && typeof item === "object") {
        nodes.push(item);
        if (item["@graph"]) stack.push(item["@graph"]);
      }
    }
  }
  return nodes;
}

const typesOf = (node) => [].concat(node["@type"] ?? []).map(String);

function nameOf(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    const names = value.map(nameOf).filter(Boolean);
    return names.length ? names.join(", ") : null;
  }
  if (typeof value === "string") return clean(value);
  if (typeof value === "object") return clean(value.name);
  return null;
}

function resolveUrl(value, base) {
  if (!value) return null;
  try {
    return new URL(String(value).trim(), base).href;
  } catch {
    return null;
  }
}

/** Title, site, author, dates, language and canonical URL. JSON-LD wins over OpenGraph, then plain meta. */
function extractMetadata(html, pageUrl) {
  const source = String(html ?? "");
  const meta = metaMap(source);
  const node = jsonLdNodes(source).find((n) => typesOf(n).some((t) => ARTICLE_TYPES.test(t))) ?? {};
  const org = jsonLdNodes(source).find((n) => typesOf(n).some((t) => /^(Organization|NewsMediaOrganization|WebSite)$/.test(t)));

  const titleTag = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const canonicalTag = (source.match(/<link\b[^>]*>/gi) ?? [])
    .map(attributesOf)
    .find((a) => /\bcanonical\b/i.test(a.rel ?? ""));
  const langAttr = source.match(/<html\b[^>]*>/i);

  const published =
    clean(node.datePublished) ?? clean(meta["article:published_time"]) ?? clean(meta["datepublished"]) ??
    clean(meta["date"]) ?? clean(meta["pubdate"]) ?? clean(meta["dc.date"]) ?? null;
  const modified =
    clean(node.dateModified) ?? clean(meta["article:modified_time"]) ?? clean(meta["og:updated_time"]) ??
    clean(meta["datemodified"]) ?? clean(meta["last-modified"]) ?? null;

  return {
    title: clean(node.headline) ?? clean(node.name) ?? clean(meta["og:title"]) ?? clean(meta["twitter:title"]) ?? clean(titleTag),
    site:
      nameOf(node.publisher) ?? clean(org?.name) ?? clean(meta["og:site_name"]) ?? clean(meta["application-name"]) ?? null,
    author: nameOf(node.author) ?? clean(meta["author"]) ?? clean(meta["article:author"]) ?? clean(meta["dc.creator"]),
    published,
    modified,
    language:
      clean(node.inLanguage) ?? clean(meta["og:locale"]) ?? clean(langAttr ? attributesOf(langAttr[0]).lang : null),
    canonical: resolveUrl(canonicalTag?.href ?? meta["og:url"], pageUrl),
  };
}

/** Text a reader would see: no scripts, styles or tags. */
function visibleText(html) {
  return decodeEntities(
    String(html)
      .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** A page whose content arrives through script: almost no text in the HTML and scripts to build it. */
function isScriptShell(html) {
  const source = String(html ?? "");
  if (!/<script\b/i.test(source)) return false;
  return visibleText(source).length < 300;
}

function needsRender(markdown, html) {
  return String(markdown ?? "").trim().length < MIN_TEXT || isScriptShell(html);
}

function isPdfSource(contentType, url) {
  const type = String(contentType ?? "").split(";")[0].trim().toLowerCase();
  if (type === "application/pdf" || type === "application/x-pdf") return true;
  if (type === "text/html" || type === "application/xhtml+xml") return false;
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

/** Splits on paragraph boundaries into pages of about `size` characters. Never returns zero pages. */
function splitPages(markdown, size = PAGE_SIZE) {
  const text = String(markdown ?? "").trim();
  if (!text) return [""];
  const pieces = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    if (paragraph.length <= size) {
      pieces.push(paragraph);
      continue;
    }
    // An oversized paragraph breaks on lines, then on the size itself.
    let line = "";
    for (const part of paragraph.split("\n")) {
      if (line && line.length + part.length + 1 > size) {
        pieces.push(line);
        line = "";
      }
      line = line ? `${line}\n${part}` : part;
      while (line.length > size) {
        pieces.push(line.slice(0, size));
        line = line.slice(size);
      }
    }
    if (line) pieces.push(line);
  }
  const pages = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > size) {
      pages.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${piece}` : piece;
  }
  if (current) pages.push(current);
  return pages;
}

/** Model-facing line for a page of a long read. */
function pageNote(page, count) {
  if (count <= 1) return "";
  const head = `Page ${page} of ${count}.`;
  if (page >= count) return `${head} This is the last page.`;
  return `${head} More follows: call read_url again with the same url and page=${page + 1} to read the next page.`;
}

function decodeBody(bytes, contentType) {
  const header = String(contentType ?? "").match(/charset\s*=\s*["']?([\w.:-]+)/i)?.[1];
  const head = Buffer.from(bytes.subarray(0, 2048)).toString("latin1");
  const label = header ?? head.match(/<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function readCapped(response, limit) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length > limit ? bytes.subarray(0, limit) : bytes;
  }
  const chunks = [];
  let total = 0;
  while (total < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  reader.cancel().catch(() => {});
  return new Uint8Array(Buffer.concat(chunks).subarray(0, limit));
}

/** Fetches with every redirect hop held to the URL policy. A refused hop is reported, not followed. */
async function fetchFollowing(url, deps) {
  let current = url;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const response = await deps.fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": deps.userAgent, Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5" },
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      const next = resolveUrl(location, current);
      if (!next || !deps.isFetchable(next)) return { refused: next ?? location };
      current = next;
      continue;
    }
    // A runtime that followed the redirect itself is checked after the fact.
    if (response.url && response.url !== current && !deps.isFetchable(response.url)) return { refused: response.url };
    const contentType = response.headers.get("content-type") ?? "";
    const limit = isPdfSource(contentType, current) ? MAX_PDF_BYTES : MAX_HTML_BYTES;
    return { status: response.status, contentType, finalUrl: response.url || current, bytes: await readCapped(response, limit) };
  }
  return { failed: "too many redirects" };
}

const cache = new Map();

function cacheGet(url, now) {
  const entry = cache.get(url);
  if (!entry || now - entry.at > CACHE_TTL_MS) {
    cache.delete(url);
    return null;
  }
  return entry;
}

function cachePut(url, entry, now) {
  cache.delete(url);
  cache.set(url, { ...entry, at: now });
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

function clearCache() {
  cache.clear();
}

function shape(entry, page) {
  const count = entry.pages.length;
  const index = Math.min(Math.max(page, 1), count);
  return {
    title: entry.meta.title ?? "",
    text: page > count ? "" : entry.pages[index - 1],
    url: entry.url,
    canonicalUrl: entry.canonicalUrl,
    site: entry.meta.site ?? undefined,
    author: entry.meta.author ?? undefined,
    published: entry.meta.published ?? undefined,
    modified: entry.meta.modified ?? undefined,
    language: entry.meta.language ?? undefined,
    snapshotHash: entry.snapshotHash ?? undefined,
    pageCount: count,
    page: page > count ? page : index,
    pageNote: page > count ? `Page ${page} does not exist. This read has ${count} page${count === 1 ? "" : "s"}.` : pageNote(index, count),
  };
}

/** Reads one page of a URL: cache, fast fetch, PDF or Readability, render fallback, snapshot. */
async function readPage(url, requestedPage, deps) {
  const now = (deps.now ?? Date.now)();
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  if (!deps.isFetchable(url)) {
    deps.log.warn("read-url", `refused ${String(url).slice(0, 120)}`);
    return { title: "", text: "", blocked: "refused", reason: deps.refusalFor(url), url };
  }
  const hit = cacheGet(url, now);
  if (hit) return shape(hit, page);

  let markdown = "";
  let meta = {};
  let finalUrl = url;
  let via = "fast";

  let raw = null;
  try {
    raw = await fetchFollowing(url, deps);
  } catch (error) {
    deps.log.warn("read-url", `fast fetch failed: ${error?.name ?? "Error"}`);
  }
  if (raw?.refused) {
    deps.log.warn("read-url", "redirect refused");
    return { title: "", text: "", blocked: "refused", reason: deps.refusalFor(raw.refused), url };
  }

  if (raw?.bytes && raw.status < 400 && isPdfSource(raw.contentType, raw.finalUrl)) {
    try {
      markdown = String(await deps.readPdf(Buffer.from(raw.bytes))).trim();
    } catch (error) {
      deps.log.warn("read-url", "pdf read failed");
      return { title: "", text: "", blocked: "unreachable", reason: error?.message || "That PDF could not be read.", url };
    }
    finalUrl = raw.finalUrl;
    via = "pdf";
    const name = decodeURIComponent(new URL(finalUrl).pathname.split("/").pop() || "");
    meta = { title: name.replace(/\.pdf$/i, "") || null };
  } else {
    let html;
    let type;
    let needRender = true;
    if (raw?.bytes && raw.status < 400) {
      type = raw.contentType.split(";")[0].trim().toLowerCase();
      if (type && !/^(text\/|application\/(xhtml\+xml|xml|json))/.test(type)) {
        return { title: "", text: "", blocked: "unreachable", reason: `That address serves ${type}, which cannot be read as a page.`, url };
      }
      finalUrl = raw.finalUrl;
      html = decodeBody(raw.bytes, raw.contentType);
      meta = extractMetadata(html, finalUrl);
      if (type === "text/plain") markdown = html.trim();
      else {
        try {
          const extracted = await deps.extractHtml(html, finalUrl);
          markdown = extracted.markdown.trim();
          meta.title = meta.title ?? clean(extracted.title);
          meta.author = meta.author ?? clean(extracted.byline);
          meta.site = meta.site ?? clean(extracted.siteName);
        } catch {
          deps.log.warn("read-url", "extract failed");
        }
      }
      needRender = type === "text/plain" ? !markdown : needsRender(markdown, html);
    }
    if (needRender) {
      const rendered = await deps.render(url);
      if (rendered.blocked) return rendered;
      via = "rendered";
      if (rendered.markdown.trim().length >= markdown.length) {
        markdown = rendered.markdown.trim();
        const more = extractMetadata(rendered.html ?? "", rendered.finalUrl ?? url);
        for (const key of Object.keys(more)) meta[key] = meta[key] ?? more[key] ?? null;
        meta.title = meta.title ?? clean(rendered.title);
        finalUrl = rendered.finalUrl ?? finalUrl;
      }
    }
  }

  const canonicalUrl = meta.canonical && deps.isFetchable(meta.canonical) ? meta.canonical : finalUrl;
  const pages = splitPages(markdown);
  let snapshotHash;
  if (markdown) {
    try {
      snapshotHash = deps.saveSnapshot(markdown, {
        url,
        canonical: canonicalUrl,
        fetched_at: now,
        title: meta.title ?? null,
        site: meta.site ?? null,
        author: meta.author ?? null,
        published: meta.published ?? null,
        modified: meta.modified ?? null,
        language: meta.language ?? null,
        via,
      });
    } catch {
      deps.log.warn("read-url", "snapshot not saved");
    }
  }
  const entry = { url, canonicalUrl, meta, pages, snapshotHash };
  if (markdown) cachePut(url, entry, now);
  deps.log.warn("read-url", `read ${via}, ${pages.length} page(s)`);
  return shape(entry, page);
}

/** The browser-side script: Readability, then Turndown. `html` null means the live document. */
function buildExtractScript({ readability, turndown, html, baseUrl }) {
  const wrap = (src) => `(function(){var module={exports:{}};var exports=module.exports;${src}\n;return module.exports;})()`;
  return `(() => {
    const Readability = ${wrap(readability)};
    const Turndown = ${wrap(turndown)};
    const html = ${JSON.stringify(html)};
    const base = ${JSON.stringify(baseUrl)};
    let doc;
    if (html === null) doc = document.cloneNode(true);
    else {
      doc = new DOMParser().parseFromString(html, "text/html");
      const tag = doc.createElement("base");
      tag.href = base;
      (doc.head || doc.documentElement).prepend(tag);
    }
    const rendered = html === null ? document.documentElement.outerHTML.slice(0, 400000) : "";
    doc.querySelectorAll("script, style, noscript, template").forEach((el) => el.remove());
    let article = null;
    try { article = new Readability(doc.cloneNode(true), { charThreshold: 200 }).parse(); } catch (e) { article = null; }
    const content = article && article.content ? article.content : (doc.body ? doc.body.innerHTML : "");
    const td = new Turndown({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
    td.remove(["script", "style", "iframe", "form", "button"]);
    const markdown = td.turndown(content).replace(/\\n{3,}/g, "\\n\\n").trim();
    return JSON.stringify({
      markdown,
      title: (article && article.title) || doc.title || "",
      byline: article && article.byline || "",
      siteName: article && article.siteName || "",
      html: rendered,
    });
  })()`;
}

function loadBundles() {
  const read = (pkg, file) => fs.readFileSync(path.join(path.dirname(require.resolve(`${pkg}/package.json`)), file), "utf8");
  return {
    readability: read("@mozilla/readability", "Readability.js"),
    turndown: read("turndown", "lib/turndown.browser.umd.js"),
  };
}

module.exports = {
  PAGE_SIZE,
  MIN_TEXT,
  extractMetadata,
  isScriptShell,
  needsRender,
  isPdfSource,
  splitPages,
  pageNote,
  decodeBody,
  fetchFollowing,
  readPage,
  clearCache,
  buildExtractScript,
  loadBundles,
};
