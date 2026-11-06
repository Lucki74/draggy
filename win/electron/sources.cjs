const { log } = require("./logger.cjs");
const urlPolicy = require("./urlPolicy.cjs");
const { pace } = require("./search.cjs");
const pkg = require("../package.json");

const SOURCE_IDS = ["web", "papers", "wiki", "code"];
const TIMEOUT_MS = 12_000;
const PER_PROVIDER = 6;
const RESULT_CAP = 10;
/** crates.io asks for at most one request a second. */
const SLOW_HOSTS = { "crates.io": 1100 };

/** Thrown for a 403 or 429, so a rate limit reads as an outage and never as "no results". */
class LimitedError extends Error {
  constructor(host, status) {
    super(`rate limited by ${host}`);
    this.host = host;
    this.status = status;
  }
}

const userAgent = (version) => `Draggy/${version} (+${pkg.homepage})`;

const clip = (text, max = 300) => {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const stripTags = (text) =>
  String(text ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

function normaliseDoi(value) {
  const doi = String(value ?? "")
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:/i, "")
    .toLowerCase();
  return /^10\.\d{4,9}\//.test(doi) ? doi : "";
}

const authorLine = (names) => {
  const list = names.map((name) => String(name).trim()).filter(Boolean);
  if (list.length === 0) return "";
  return list.length > 3 ? `${list.slice(0, 3).join(", ")}, et al.` : list.join(", ");
};

/** The OpenAlex abstract arrives as a word to positions map. */
function openAlexAbstract(index) {
  if (!index || typeof index !== "object") return "";
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words[position] = word;
  }
  return words.filter(Boolean).join(" ");
}

function paper(fields) {
  const doi = normaliseDoi(fields.doi);
  const out = {
    title: clip(fields.title, 200),
    url: doi ? `https://doi.org/${doi}` : fields.url,
    snippet: clip(fields.snippet),
    source: fields.source,
  };
  if (fields.year) out.year = Number(fields.year);
  if (fields.authors) out.authors = fields.authors;
  if (doi) out.doi = doi;
  if (fields.pdf) out.pdf = fields.pdf;
  return out;
}

function parseOpenAlex(json) {
  const rows = Array.isArray(json?.results) ? json.results : [];
  return rows
    .filter((row) => row?.display_name)
    .map((row) =>
      paper({
        title: row.display_name,
        doi: row.doi,
        url: row.primary_location?.landing_page_url || row.id,
        snippet: openAlexAbstract(row.abstract_inverted_index),
        year: row.publication_year,
        authors: authorLine((row.authorships || []).map((entry) => entry?.author?.display_name)),
        pdf: row.open_access?.oa_url,
        source: "openalex",
      }),
    );
}

const tagText = (block, tag) => {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(block);
  return match ? stripTags(match[1]).replace(/\s+/g, " ").trim() : "";
};

function parseArxiv(xml) {
  const entries = String(xml ?? "").match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return entries.map((entry) => {
    const id = tagText(entry, "id");
    const names = [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/g)].map((m) => stripTags(m[1]));
    return paper({
      title: tagText(entry, "title"),
      doi: tagText(entry, "arxiv:doi"),
      url: id.replace(/^http:/, "https:"),
      snippet: tagText(entry, "summary"),
      year: tagText(entry, "published").slice(0, 4),
      authors: authorLine(names),
      pdf: id.replace(/^http:/, "https:").replace("/abs/", "/pdf/"),
      source: "arxiv",
    });
  }).filter((row) => row.title);
}

function parseCrossref(json) {
  const rows = Array.isArray(json?.message?.items) ? json.message.items : [];
  return rows
    .filter((row) => row?.title?.[0])
    .map((row) =>
      paper({
        title: stripTags(row.title[0]),
        doi: row.DOI,
        url: row.URL,
        snippet: stripTags(row.abstract),
        year: row.issued?.["date-parts"]?.[0]?.[0],
        authors: authorLine((row.author || []).map((a) => [a.given, a.family].filter(Boolean).join(" ") || a.name)),
        source: "crossref",
      }),
    );
}

/** Interleaves providers by rank, then drops repeats by DOI (title when there is none). */
function mergePapers(lists) {
  const seen = new Map();
  const out = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let rank = 0; rank < longest; rank += 1) {
    for (const list of lists) {
      const row = list[rank];
      if (!row) continue;
      const key = row.doi || `t:${row.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
      const first = seen.get(key);
      if (first) {
        first.snippet ||= row.snippet;
        first.year ||= row.year;
        first.authors ||= row.authors;
        first.pdf ||= row.pdf;
        if (!first.doi && row.doi) first.doi = row.doi;
        continue;
      }
      seen.set(key, row);
      out.push(row);
    }
  }
  return out;
}

function parseWikiSearch(json) {
  const rows = Array.isArray(json?.query?.search) ? json.query.search : [];
  return rows
    .filter((row) => row?.title)
    .map((row) => ({
      title: row.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(row.title.replace(/ /g, "_"))}`,
      snippet: clip(stripTags(row.snippet)),
      source: "wikipedia",
    }));
}

function parseWikiSummary(json) {
  const url = json?.content_urls?.desktop?.page;
  if (!json?.extract || !url) return null;
  return { title: json.title, url, snippet: clip(json.extract, 500), source: "wikipedia" };
}

function parseWikidata(json) {
  const rows = Array.isArray(json?.search) ? json.search : [];
  return rows
    .filter((row) => row?.id && row?.label)
    .map((row) => ({
      title: row.label,
      url: `https://www.wikidata.org/wiki/${row.id}`,
      snippet: clip(row.description || ""),
      source: "wikidata",
    }));
}

function parseGithub(json) {
  const rows = Array.isArray(json?.items) ? json.items : [];
  return rows
    .filter((row) => row?.html_url)
    .map((row) => ({
      title: row.full_name,
      url: row.html_url,
      snippet: clip(`${row.description || ""} (${row.language || "n/a"}, ${row.stargazers_count ?? 0} stars)`),
      source: "github",
    }));
}

function parseNpm(json) {
  const rows = Array.isArray(json?.objects) ? json.objects : [];
  return rows
    .map((row) => row?.package)
    .filter((item) => item?.name)
    .map((item) => ({
      title: `${item.name}@${item.version}`,
      url: item.links?.npm || `https://www.npmjs.com/package/${item.name}`,
      snippet: clip(item.description),
      source: "npm",
    }));
}

function parsePypi(json) {
  const info = json?.info;
  if (!info?.name) return [];
  return [{
    title: `${info.name} ${info.version}`,
    url: info.package_url || `https://pypi.org/project/${info.name}/`,
    snippet: clip(info.summary),
    source: "pypi",
  }];
}

function parseCrates(json) {
  const rows = Array.isArray(json?.crates) ? json.crates : [];
  return rows
    .filter((row) => row?.name)
    .map((row) => ({
      title: `${row.name} ${row.max_version}`,
      url: `https://crates.io/crates/${row.name}`,
      snippet: clip(row.description),
      source: "crates",
    }));
}

/** Gets one URL as text. The model never picks the URL, but the policy check stays on every hop. */
async function request(url, deps, accept) {
  if (!urlPolicy.isFetchableUrl(url)) throw new Error("url refused");
  const host = new URL(url).hostname;
  await pace(`src:${host}`, deps.now, deps.sleep, SLOW_HOSTS[host]);
  let response;
  try {
    response = await deps.fetch(url, {
      headers: {
        "User-Agent": userAgent(deps.version),
        Accept: accept,
        ...(host === "api.github.com" && deps.githubToken ? { Authorization: `Bearer ${deps.githubToken}` } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    log.warn("net.sources", "request failed", { host, error: error instanceof Error ? error.name : "Error" });
    throw error;
  }
  log.info("net.sources", "request answered", { host, status: response.status });
  if (response.status === 403 || response.status === 429) throw new LimitedError(host, response.status);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${host} answered ${response.status}`);
  return response.text();
}

async function getJson(url, deps) {
  const text = await request(url, deps, "application/json");
  if (text === null) return null;
  return JSON.parse(text);
}

const enc = encodeURIComponent;

const PAPER_PROVIDERS = [
  {
    id: "openalex",
    run: async (q, deps) => {
      const key = deps.openAlexKey ? `&api_key=${enc(deps.openAlexKey)}` : "";
      const fields = "display_name,doi,id,publication_year,authorships,abstract_inverted_index,primary_location,open_access";
      const json = await getJson(`https://api.openalex.org/works?search=${enc(q)}&per-page=${PER_PROVIDER}&select=${fields}${key}`, deps);
      return parseOpenAlex(json);
    },
  },
  {
    id: "arxiv",
    run: async (q, deps) =>
      parseArxiv(await request(`https://export.arxiv.org/api/query?search_query=all:${enc(q)}&max_results=${PER_PROVIDER}`, deps, "application/atom+xml")),
  },
  {
    id: "crossref",
    run: async (q, deps) =>
      parseCrossref(await getJson(`https://api.crossref.org/works?query=${enc(q)}&rows=${PER_PROVIDER}&select=DOI,title,author,issued,URL,abstract`, deps)),
  },
];

const WIKI_PROVIDERS = [
  {
    id: "wikipedia",
    run: async (q, deps) => {
      const found = parseWikiSearch(
        await getJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc(q)}&srlimit=${PER_PROVIDER}&format=json&origin=*`, deps),
      );
      // A summary is a cleaner snippet than the search fragment, so the top two are upgraded.
      const top = await Promise.all(
        found.slice(0, 2).map(async (row) => {
          try {
            const summary = parseWikiSummary(await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${enc(row.title.replace(/ /g, "_"))}`, deps));
            return summary ? { ...row, snippet: summary.snippet, url: summary.url } : row;
          } catch (error) {
            log.debug("net.sources", "summary skipped", { error: error?.name });
            return row;
          }
        }),
      );
      return [...top, ...found.slice(2)];
    },
  },
  {
    id: "wikidata",
    run: async (q, deps) =>
      parseWikidata(await getJson(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${enc(q)}&language=en&limit=4&format=json&origin=*`, deps)),
  },
];

const CODE_PROVIDERS = [
  {
    id: "github",
    run: async (q, deps) =>
      parseGithub(await getJson(`https://api.github.com/search/repositories?q=${enc(q)}&per_page=${PER_PROVIDER}`, deps)),
  },
  {
    id: "npm",
    run: async (q, deps) => parseNpm(await getJson(`https://registry.npmjs.org/-/v1/search?text=${enc(q)}&size=4`, deps)),
  },
  {
    // PyPI has no search API, so only an exact package name can be looked up.
    id: "pypi",
    run: async (q, deps) => {
      const name = q.trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) return [];
      return parsePypi(await getJson(`https://pypi.org/pypi/${enc(name)}/json`, deps));
    },
  },
  {
    id: "crates",
    run: async (q, deps) => parseCrates(await getJson(`https://crates.io/api/v1/crates?q=${enc(q)}&per_page=4`, deps)),
  },
];

const TABLE = { papers: PAPER_PROVIDERS, wiki: WIKI_PROVIDERS, code: CODE_PROVIDERS };

/** Runs every provider of a source and merges. A provider that is rate limited or down counts as
 * unavailable, which is only reported when nothing else answered. */
async function searchSource(query, source, overrides = {}) {
  const providers = TABLE[source];
  const text = String(query ?? "").trim();
  if (!providers || !text) return { results: [], provider: null, tried: [], status: "empty" };

  const deps = {
    fetch: overrides.fetch,
    version: overrides.version || "0",
    now: overrides.now || Date.now,
    sleep: overrides.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    openAlexKey: overrides.openAlexKey || "",
    githubToken: overrides.githubToken || "",
  };
  const active = providers;
  const settled = await Promise.allSettled(active.map((p) => p.run(text, deps)));

  const answered = [];
  const tried = [];
  let failed = 0;
  settled.forEach((outcome, index) => {
    tried.push(active[index].id);
    if (outcome.status === "fulfilled") answered.push(outcome.value);
    else {
      failed += 1;
      log.info("net.sources", "provider failed", { provider: active[index].id, error: outcome.reason?.name, status: outcome.reason?.status });
    }
  });

  const merged = source === "papers" ? mergePapers(answered) : answered.flat();
  const results = merged.slice(0, RESULT_CAP);
  if (results.length > 0) return { results, provider: source, tried, status: "ok" };
  return { results, provider: null, tried, status: failed > 0 ? "unavailable" : "empty" };
}

module.exports = {
  SOURCE_IDS,
  searchSource,
  userAgent,
  normaliseDoi,
  mergePapers,
  parseOpenAlex,
  parseArxiv,
  parseCrossref,
  parseWikiSearch,
  parseWikiSummary,
  parseWikidata,
  parseGithub,
  parseNpm,
  parsePypi,
  parseCrates,
  LimitedError,
};
