const fs = require("node:fs");
const path = require("node:path");
const { log } = require("./logger.cjs");

/** The numbers both apps share. A checkout reads shared/, a packaged build finds the copy beside its resources. */
function loadSharedConfig() {
  const checkout = path.join(__dirname, "..", "..", "shared", "fixtures", "web", "config.json");
  return require(fs.existsSync(checkout) ? checkout : path.join(process.resourcesPath || "", "search-config.json"));
}

const SHARED = loadSharedConfig();

const DESKTOP_USER_AGENT = SHARED.desktopUserAgent;

const RESULT_LIMIT = SHARED.resultLimit;

/** The smallest gap between two requests to one provider. Firing five at once returns empty pages,
 * which the model reads as "nothing exists". */
const PROVIDER_GAP_MS = SHARED.providerGapMs;

/** Models rephrase the same question several times in a row. Answering the repeats from memory
 * keeps that from counting against the rate limit. */
const CACHE_TTL_MS = SHARED.cacheTtlMs;
const CACHE_LIMIT = SHARED.cacheLimit;

/** How long a provider that served a block page is left alone, by how many blocks in a row. */
const COOLDOWNS_MS = SHARED.cooldownsMs;

/** Names a block page from its title and text, or null. Runs inside the scraped page as well as in
 * Node, so it must stay self-contained. */
function blockReason(title, text) {
  const haystack = (String(title || "") + " " + String(text || "")).toLowerCase().replace(/\s+/g, " ");
  const rules = [
    ["unusual-traffic", ["unusual traffic", "bots use duckduckgo too", "anomaly in the request", "automated requests", "unusual activity"]],
    ["captcha", ["captcha", "verify you are human", "verify you're human", "are you a robot", "are you human", "not a robot", "select all squares"]],
    ["consent", ["before you continue to google", "consent.google", "before you continue", "cookie consent", "accept all cookies"]],
  ];
  for (const [reason, phrases] of rules) {
    if (phrases.some((phrase) => haystack.includes(phrase))) return reason;
  }
  return null;
}

/** Thrown when a provider answered with a block page, which is not the same as having no results. */
class BlockedError extends Error {
  constructor(reason) {
    super("blocked: " + reason);
    this.name = "BlockedError";
    this.blocked = true;
    this.reason = reason;
  }
}

/** The tail every extract script shares: rows, or the block reason when there are none. */
const FINISH = `
    const rows = results.slice(0, ${RESULT_LIMIT});
    if (rows.length === 0) {
      const reason = (${blockReason.toString()})(document.title, document.body ? document.body.innerText : '');
      if (reason) return JSON.stringify({ blocked: reason });
    }
    return JSON.stringify(rows);
`;

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
${FINISH}
  })();
`;

/** The lite endpoint is a plain table of link and snippet rows. Different infrastructure to the
 * html one, so it answers when that starts refusing. */
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
${FINISH}
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
${FINISH}
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
${FINISH}
  })();
`;

/** DuckDuckGo hands out links through a redirector; the destination is in the uddg parameter. A
 * redirector URL tells the model nothing about the source. */
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

const TRACKING_PARAM = /^(utm_.*|gclid|fbclid|mc_cid|mc_eid|ref|ref_src|igshid|yclid|msclkid)$/i;

/** The same page under different tracking, AMP or fragment spellings gets one key. The host is only
 * lowercased: a www host and its bare twin can serve different pages. */
function canonicalUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return String(url);
  }

  const segments = parsed.pathname.split("/").filter((segment) => segment.toLowerCase() !== "amp");
  let pathname = segments.join("/");
  if (!pathname.startsWith("/")) pathname = "/" + pathname;
  if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);

  const kept = parsed.search
    .replace(/^\?/, "")
    .split("&")
    .filter((pair) => {
      if (!pair) return false;
      const equals = pair.indexOf("=");
      const name = (equals < 0 ? pair : pair.slice(0, equals)).toLowerCase();
      const value = (equals < 0 ? "" : pair.slice(equals + 1)).toLowerCase();
      if (TRACKING_PARAM.test(name)) return false;
      return !((name === "amp" && value === "1") || (name === "outputtype" && value === "amp"));
    });

  return `${parsed.protocol}//${parsed.host}${pathname}${kept.length ? "?" + kept.join("&") : ""}`;
}

/** The host without a leading www., for showing the model where a result comes from. */
function domainOf(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
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
    const canonical = canonicalUrl(url);
    if (seen.has(canonical)) continue;
    seen.add(canonical);

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
  const parsed = JSON.parse(raw || "[]");
  if (parsed && !Array.isArray(parsed) && typeof parsed.blocked === "string") throw new BlockedError(parsed.blocked);
  return normaliseResults(parsed);
}

/** An API that answers 202 with nothing is throttling, not reporting an empty web. */
async function readApiBody(response, name) {
  const text = await response.text();
  if (response.status === 202 && !text.trim()) throw new BlockedError("rate-limited");
  if (!response.ok) throw new Error(`${name} returned ${response.status}`);
  return JSON.parse(text.replace(/^\uFEFF/, ""));
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

    const body = await readApiBody(response, "SearXNG");
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

    const body = await readApiBody(response, "Brave");
    return normaliseResults(
      (body?.web?.results || []).map((entry) => ({
        title: entry.title,
        url: entry.url,
        snippet: entry.description,
      })),
    );
  },
};

/** Ordered by how reliably each answers. Bing was removed: it returns nothing to a scraper, and its
 * RSS feed answers some queries with the wrong question. */
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

/** The slot is reserved before sleeping, so calls that arrive together queue one gap apart
 * instead of all reading the same last call. */
async function pace(providerId, now, sleep, gap = PROVIDER_GAP_MS) {
  const slot = Math.max(now(), (lastCallAt.get(providerId) || 0) + gap);
  lastCallAt.set(providerId, slot);
  const due = slot - now();
  if (due > 0) await sleep(due);
}

/** Providers that served a block page: how many in a row, and when they may be asked again. */
const cooldowns = new Map();

function coolingDown(providerId, now) {
  const state = cooldowns.get(providerId);
  return Boolean(state) && now() < state.until;
}

function recordBlock(providerId, now) {
  const strikes = (cooldowns.get(providerId)?.strikes || 0) + 1;
  const cooldownMs = COOLDOWNS_MS[Math.min(strikes, COOLDOWNS_MS.length) - 1];
  cooldowns.set(providerId, { strikes, until: now() + cooldownMs });
  return cooldownMs;
}

/** Calls for one question that are already on their way, so a repeat joins them. */
const inFlight = new Map();

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

/** Error text from a provider can echo the request URL, so the query is cut out before it is logged. */
function redactQuery(message, term) {
  let text = String(message ?? "");
  for (const form of new Set([term, encodeURIComponent(term), encodeURIComponent(term).replace(/%20/g, "+")])) {
    if (form) text = text.split(form).join("[query]");
  }
  return text;
}

function clearCache() {
  cache.clear();
  lastCallAt.clear();
  cooldowns.clear();
  inFlight.clear();
}

/** Runs the chain until something answers. "empty" means the web had nothing; "unavailable" means
 * nobody answered; "blocked" means a provider refused us. The last two are temporary, not facts. */
async function runSearch(query, config, deps) {
  const term = String(query || "").trim();
  if (!term) return { results: [], provider: null, tried: [], status: "empty" };

  const settings = config || {};
  const now = deps?.now || (() => Date.now());

  const key = cacheKey(term, settings);
  const cached = readCache(key, now);
  if (cached) {
    return { ...cached, cached: true };
  }

  const joined = inFlight.get(key);
  if (joined) return { ...(await joined) };

  const pending = searchChain(term, settings, deps, key);
  inFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  }
}

async function searchChain(term, settings, deps, key) {
  const now = deps?.now || (() => Date.now());
  const sleep = deps?.sleep || wait;

  const chain = buildChain(settings);
  const tried = [];
  let anyProviderAnswered = false;
  let anyProviderBlocked = false;

  for (const provider of chain) {
    if (coolingDown(provider.id, now)) {
      anyProviderBlocked = true;
      log.info("net.search", "provider cooling down", { provider: provider.id });
      continue;
    }

    tried.push(provider.id);
    const started = now();
    try {
      await pace(provider.id, now, sleep);
      const results = await provider.run(term, settings, deps);
      anyProviderAnswered = true;
      const durationMs = now() - started;

      if (results.length > 0) {
        cooldowns.delete(provider.id);
        log.info("net.search", "search answered", { provider: provider.id, results: results.length, durationMs });
        const outcome = { results, provider: provider.id, tried, status: "ok" };
        writeCache(key, outcome, now);
        return outcome;
      }

      log.info("net.search", "search empty", { provider: provider.id, results: 0, durationMs });
    } catch (error) {
      if (error?.blocked) {
        anyProviderBlocked = true;
        const cooldownMs = recordBlock(provider.id, now);
        log.warn("net.search", "provider blocked", { provider: provider.id, reason: error.reason, cooldownMs });
        continue;
      }
      log.warn("net.search", "provider failed", {
        provider: provider.id,
        durationMs: now() - started,
        error: redactQuery(error?.message, term).slice(0, 120),
      });
    }
  }

  // A block page parses to nothing, so it must never read as an empty web: that would be
  // remembered and tell the model nothing exists.
  let status = "unavailable";
  if (anyProviderBlocked && !anyProviderAnswered) status = "blocked";
  else if (anyProviderAnswered) status = "empty";

  const outcome = { results: [], provider: null, tried, status };

  // An outage or a block is worth retrying later, so only a genuine empty result is remembered.
  if (status === "empty") writeCache(key, outcome, now);

  return outcome;
}

module.exports = {
  runSearch,
  pace,
  buildChain,
  normaliseResults,
  canonicalUrl,
  domainOf,
  blockReason,
  BlockedError,
  unwrapRedirect,
  clearCache,
  PROVIDERS,
  PROVIDER_IDS,
  DESKTOP_USER_AGENT,
  RESULT_LIMIT,
  PROVIDER_GAP_MS,
  CACHE_TTL_MS,
  COOLDOWNS_MS,
};
