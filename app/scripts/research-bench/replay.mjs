// Replay web tools for the research bench: search and read served from the fixed corpus, no network.
// api() has the shape of window.draggy.searchWebDetailed and readUrl, so a test can install it as is.
import fs from "node:fs";
import path from "node:path";

export const CORPUS_DIR = path.resolve(import.meta.dirname, "../../../shared/fixtures/research-bench/corpus");
const PART = 6000;
const STOP = new Set("a an and are as at be by did do does for from how in is it of on or that the to was what when where which who with".split(" "));

export const tokens = (text) =>
  text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t));

/** Reads one page file: a front matter block of key: value lines, then the body. */
export function parsePage(raw, file) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw.replace(/\r\n/g, "\n"));
  if (!m) throw new Error(`${file}: no front matter`);
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(": ");
    if (i < 0) throw new Error(`${file}: bad front matter line ${line}`);
    meta[line.slice(0, i)] = line.slice(i + 2);
  }
  for (const key of ["url", "title", "date", "keywords"]) if (!meta[key]) throw new Error(`${file}: missing ${key}`);
  return { file, url: meta.url, title: meta.title, date: meta.date, keywords: meta.keywords.split(" "), body: m[2].trim() };
}

export function loadCorpus(dir = CORPUS_DIR) {
  const pages = fs
    .readdirSync(path.join(dir, "pages"))
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => parsePage(fs.readFileSync(path.join(dir, "pages", f), "utf8"), f));
  const df = new Map();
  for (const p of pages) {
    p.kw = new Set(p.keywords.flatMap(tokens));
    p.tt = new Set(tokens(p.title));
    p.bt = new Set(tokens(p.body));
    for (const t of new Set([...p.kw, ...p.tt, ...p.bt])) df.set(t, (df.get(t) ?? 0) + 1);
  }
  return { pages, byUrl: new Map(pages.map((p) => [p.url, p])), df };
}

/** Keyword hits weigh 3, title hits 2, body hits 1, each scaled by how rare the word is. Ties go to the lower URL. */
export function search(corpus, query, limit = 8) {
  const words = [...new Set(tokens(query))];
  const scored = [];
  for (const p of corpus.pages) {
    let score = 0;
    for (const w of words) {
      const hit = (p.kw.has(w) ? 3 : 0) + (p.tt.has(w) ? 2 : 0) + (p.bt.has(w) ? 1 : 0);
      if (hit) score += hit * Math.log(1 + corpus.pages.length / (corpus.df.get(w) ?? 1));
    }
    if (score > 0) scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score || (a.p.url < b.p.url ? -1 : 1));
  return scored.slice(0, limit).map(({ p }) => ({
    title: p.title,
    url: p.url,
    snippet: p.body.replace(/\s+/g, " ").slice(0, 200),
  }));
}

export function readPage(corpus, url, page = 1) {
  const p = corpus.byUrl.get(url);
  if (!p) return { title: "", text: "", blocked: "unreachable", reason: "That address could not be reached." };
  const count = Math.max(1, Math.ceil(p.body.length / PART));
  const n = Math.min(Math.max(1, page), count);
  return {
    title: p.title,
    text: p.body.slice((n - 1) * PART, n * PART),
    site: new URL(p.url).hostname,
    published: p.date,
    url: p.url,
    pageCount: count,
    page: n,
    pageNote: count > 1 ? `Page ${n} of ${count}. Pass page ${n + 1} for the next part.` : "",
  };
}

/** The slice of window.draggy the web tools use, served from the corpus. */
export function replayApi(corpus, log = []) {
  const answer = (query) => {
    const results = search(corpus, query);
    log.push({ tool: "search_web", query, urls: results.map((r) => r.url) });
    return { results, provider: "replay", tried: ["replay"], status: results.length ? "ok" : "empty" };
  };
  return {
    searchWebDetailed: async (query) => answer(query),
    searchSource: async (query) => answer(query),
    readUrl: async (url, page) => {
      log.push({ tool: "read_url", url });
      return readPage(corpus, url, page);
    },
  };
}
