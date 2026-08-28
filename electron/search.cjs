const { log } = require("./logger.cjs");

const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const RESULT_LIMIT = 10;

/**
 * The smallest gap between two requests to the same provider. Firing five
 * searches at once is exactly what makes a free search engine start returning
 * empty pages, and an empty page reads to the model as "nothing exists", which
 * sends it off inventing more queries. Spacing them out costs a second and
 * avoids the whole spiral.
 */
const PROVIDER_GAP_MS = 900;

/**
 * Models rephrase the same question several times in a row. Answering the
 * repeats from memory keeps that from counting against the rate limit.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_LIMIT = 80;

const DUCKDUCKGO_EXTRACT = `
  (() => {
    const results = [];
    document.querySelectorAll('.result:not(.result--ad)').forEach(item => {
      const titleEl = item.querySelector('.result__a');
      const snippetEl = item.querySelector('.result__snippet');
      if (!titleEl) return;
      const title = titleEl.innerText.trim();
      if (title && titleEl.href) {
        results.push({ title, url: titleEl.href, snippet: snippetEl ? snippetEl.innerText.trim() : '' });
      }
    });
    return JSON.stringify(results.slice(0, ${RESULT_LIMIT}));
  })();
`;

/**
 * The lite endpoint is a plain table: each result is a link row followed by a
 * snippet row. It is served from different infrastructure to the html endpoint,
 * so it usually still answers when that one has started refusing.
 */
const DUCKDUCKGO_LITE_EXTRACT = `
  (() => {
    const results = [];
    document.querySelectorAll('a.result-link').forEach(link => {
      if (!link.href) return;
      const row = link.closest('tr');
      const next = row && row.nextElementSibling;
      const snippetEl = next && (next.querySelector('.result-snippet') || next);
      results.push({
        title: link.innerText.trim(),
        url: link.href,
        snippet: snippetEl ? snippetEl.innerText.trim() : '',
      });
    });
    return JSON.stringify(results.slice(0, ${RESULT_LIMIT}));
  })();
`;

const STARTPAGE_EXTRACT = `
  (() => {
    const results = [];
    document.querySelectorAll('.result, .w-gl__result').forEach(item => {
      const link = item.querySelector('a.result-link, a.w-gl__result-title, h2 a, a[href^="http"]');
      if (!link || !link.href.startsWith('http')) return;
      const heading = item.querySelector('h2, h3');
      const snippetEl = item.querySelector('.description, .w-gl__description, p');
      const title = (heading || link).innerText.trim();
      if (!title) return;
      results.push({
        title,
        url: link.href,
        snippet: snippetEl ? snippetEl.innerText.trim() : '',
      });
    });
    return JSON.stringify(results.slice(0, ${RESULT_LIMIT}));
  })();
`;

const BRAVE_HTML_EXTRACT = `
  (() => {
    const results = [];
    document.querySelectorAll('#results .snippet, .snippet[data-type="web"]').forEach(item => {
      const link = item.querySelector('a[href^="http"]');
      if (!link) return;
      const heading = item.querySelector('.title, .snippet-title, div[class*="title"]');
      const snippetEl = item.querySelector('.snippet-description, .snippet-content, p');
      const raw = (heading ? heading.innerText : link.innerText).trim();
      const title = raw.split('\\n').filter(Boolean).pop() || '';
      if (!title) return;
      results.push({
        title: title.slice(0, 200),
        url: link.href,
        snippet: snippetEl ? snippetEl.innerText.trim() : '',
      });
    });
    return JSON.stringify(results.slice(0, ${RESULT_LIMIT}));
  })();
`;

/**
 * DuckDuckGo hands out links through its own redirector. The real destination
 * is in the uddg parameter, and the model needs that one: it cannot read a
 * redirect, and a redirector URL tells it nothing about the source.
 */
function unwrapRedirect(url) {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)duckduckgo\.com$/i.test(parsed.hostname)) return url;
    const target = parsed.searchParams.get("uddg");
    return target && /^https?:\/\//i.test(target) ? target : url;
  } catch {
    return url;
  }
}

function normaliseResults(raw) {
  if (!Array.isArray(raw)) return [];

  const seen = new Set();
  const results = [];

  for (const entry of raw) {
    const url = unwrapRedirect(String(entry?.url || "").trim());
    const title = String(entry?.title || "").trim();
    if (!title || !/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    results.push({
      title,
      url,
      snippet: String(entry?.snippet || "").trim().slice(0, 500),
    });

    if (results.length >= RESULT_LIMIT) break;
  }

  return results;
}

async function scrapeProvider(url, readySelector, extract, deps) {
  const raw = await deps.scrape({
    url,
    userAgent: DESKTOP_USER_AGENT,
    readyExpression: `document.querySelectorAll('${readySelector}').length > 0`,
    extract,
  });
  return normaliseResults(JSON.parse(raw || "[]"));
}

const duckduckgo = {
  id: "duckduckgo",
  label: "DuckDuckGo",
  configured: () => true,
  run: (query, _config, deps) =>
    scrapeProvider(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      ".result:not(.result--ad)",
      DUCKDUCKGO_EXTRACT,
      deps,
    ),
};

const startpage = {
  id: "startpage",
  label: "Startpage",
  configured: () => true,
  run: (query, _config, deps) =>
    scrapeProvider(
      `https://www.startpage.com/sp/search?query=${encodeURIComponent(query)}`,
      ".result, .w-gl__result",
      STARTPAGE_EXTRACT,
      deps,
    ),
};

const duckduckgoLite = {
  id: "duckduckgo-lite",
  label: "DuckDuckGo Lite",
  configured: () => true,
  run: (query, _config, deps) =>
    scrapeProvider(
      `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
      "a.result-link",
      DUCKDUCKGO_LITE_EXTRACT,
      deps,
    ),
};

const braveHtml = {
  id: "brave-html",
  label: "Brave Search",
  configured: () => true,
  run: (query, _config, deps) =>
    scrapeProvider(
      `https://search.brave.com/search?q=${encodeURIComponent(query)}`,
      "#results .snippet, .snippet",
      BRAVE_HTML_EXTRACT,
      deps,
    ),
};

const searxng = {
  id: "searxng",
  label: "SearXNG",
  configured: (config) => Boolean(config.searxngUrl),
  run: async (query, config) => {
    const base = String(config.searxngUrl).replace(/\/+$/, "");
    const response = await fetch(
      `${base}/search?q=${encodeURIComponent(query)}&format=json&safesearch=0`,
      {
        headers: { Accept: "application/json", "User-Agent": "Draggy" },
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!response.ok) throw new Error(`SearXNG returned ${response.status}`);

    const body = await response.json();
    return normaliseResults(
      (body?.results || []).map((entry) => ({
        title: entry.title,
        url: entry.url,
        snippet: entry.content,
      })),
    );
  },
};

const brave = {
  id: "brave",
  label: "Brave Search API",
  configured: (config) => Boolean(config.braveApiKey),
  run: async (query, config) => {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${RESULT_LIMIT}`,
      {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": String(config.braveApiKey),
        },
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!response.ok) throw new Error(`Brave returned ${response.status}`);

    const body = await response.json();
    return normaliseResults(
      (body?.web?.results || []).map((entry) => ({
        title: entry.title,
        url: entry.url,
        snippet: entry.description,
      })),
    );
  },
};

/**
 * Ordered by how reliably each one answers. Bing used to sit at the end; it
 * stopped returning anything to a scraper, and its RSS feed answers some
 * queries with results for a completely different question, which is worse than
 * no answer at all. It was removed rather than left in as dead weight.
 */
const PROVIDERS = [searxng, brave, duckduckgo, startpage, duckduckgoLite, braveHtml];

const PROVIDER_IDS = PROVIDERS.map((provider) => provider.id);

function buildChain(config) {
  const preferred = String(config.searchProvider || "auto");
  const available = PROVIDERS.filter((provider) => provider.configured(config));

  if (preferred === "auto") return available;

  const chosen = available.filter((provider) => provider.id === preferred);
  const rest = available.filter((provider) => provider.id !== preferred);
  return [...chosen, ...rest];
}

const lastCallAt = new Map();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pace(providerId, now, sleep) {
  const previous = lastCallAt.get(providerId) || 0;
  const due = previous + PROVIDER_GAP_MS - now();
  if (due > 0) await sleep(due);
  lastCallAt.set(providerId, now());
}

const cache = new Map();

function cacheKey(query, config) {
  return `${config.searchProvider || "auto"}::${query.toLowerCase()}`;
}

function readCache(key, now) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function writeCache(key, value, now) {
  cache.set(key, { at: now(), value });
  while (cache.size > CACHE_LIMIT) {
    cache.delete(cache.keys().next().value);
  }
}

function clearCache() {
  cache.clear();
  lastCallAt.clear();
}

/**
 * Runs the chain until something answers.
 *
 * The status matters as much as the results. "empty" means the web was asked
 * and genuinely had nothing; "unavailable" means nobody would answer, which is
 * a temporary condition and not a fact about the world. Telling the model which
 * one happened is what stops it rewording the same question ten times.
 */
async function runSearch(query, config, deps) {
  const term = String(query || "").trim();
  if (!term) return { results: [], provider: null, tried: [], status: "empty" };

  const settings = config || {};
  const now = deps?.now || (() => Date.now());
  const sleep = deps?.sleep || wait;

  const key = cacheKey(term, settings);
  const cached = readCache(key, now);
  if (cached) {
    return { ...cached, cached: true };
  }

  const chain = buildChain(settings);
  const tried = [];
  let anyProviderAnswered = false;

  for (const provider of chain) {
    tried.push(provider.id);
    try {
      await pace(provider.id, now, sleep);
      const results = await provider.run(term, settings, deps);
      anyProviderAnswered = true;

      if (results.length > 0) {
        log.info("search", `${provider.id} returned ${results.length} for "${term}"`);
        const outcome = { results, provider: provider.id, tried, status: "ok" };
        writeCache(key, outcome, now);
        return outcome;
      }

      log.warn("search", `${provider.id} returned nothing for "${term}"`);
    } catch (error) {
      log.warn("search", `${provider.id} failed: ${error.message}`);
    }
  }

  const outcome = {
    results: [],
    provider: null,
    tried,
    status: anyProviderAnswered ? "empty" : "unavailable",
  };

  // A provider outage is worth retrying on the next question, so only a genuine
  // empty result is remembered.
  if (outcome.status === "empty") writeCache(key, outcome, now);

  return outcome;
}

module.exports = {
  runSearch,
  buildChain,
  normaliseResults,
  unwrapRedirect,
  clearCache,
  PROVIDERS,
  PROVIDER_IDS,
  DESKTOP_USER_AGENT,
  RESULT_LIMIT,
  PROVIDER_GAP_MS,
  CACHE_TTL_MS,
};
