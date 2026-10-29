// Keeps the price table and the exchange rates current. This is the only code that reaches the network for
// pricing: three fixed GET URLs, no user data in them, nothing sent, nothing followed to another host.
const fs = require("node:fs");
const path = require("node:path");
const { LITELLM_URL, OPENROUTER_URL, buildTable } = require("./build.cjs");
const { isUsableTable, LIVE_FILE } = require("./table.cjs");

const RATES_URL = "https://api.frankfurter.dev/v1/latest?base=USD";
const RATES_FILE = "rates.live.json";

/** The only URLs this module will fetch. */
const ALLOWED_URLS = Object.freeze([LITELLM_URL, OPENROUTER_URL, RATES_URL]);

const FIRST_CHECK_MS = 45_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** A copy younger than this is not fetched again by the schedule. A manual update ignores it. */
const FRESH_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 20 * 1024 * 1024;

async function defaultFetchJson(url) {
  if (!ALLOWED_URLS.includes(url)) throw new Error("address is not on the pricing allowlist");
  const response = await fetch(url, {
    method: "GET",
    redirect: "error",
    headers: { "user-agent": "Draggy-pricing", accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`answered ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error("answer is too large");
  return JSON.parse(text);
}

/** Exchange rates with USD as the base, or null when the answer is not usable. */
function parseRates(body) {
  if (!body || body.base !== "USD" || !body.rates || typeof body.rates !== "object") return null;
  const rates = { USD: 1 };
  for (const [code, rate] of Object.entries(body.rates)) {
    if (/^[A-Z]{3}$/.test(code) && typeof rate === "number" && Number.isFinite(rate) && rate > 0) rates[code] = rate;
  }
  return Object.keys(rates).length >= 5 ? { base: "USD", date: String(body.date ?? ""), rates } : null;
}

function writeAtomic(file, text) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, file);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * `table` is the loader from table.cjs; a good download is written beside it and the loader re-read.
 * `fetchJson` and `now` are injectable so the tests never touch the network or the clock.
 */
function createPricingRefresher({ userData, table, log, fetchJson = defaultFetchJson, now = Date.now, onUpdate }) {
  let timer = null;
  let first = null;
  let running = null;
  const status = { pricesAt: null, pricesError: null, ratesAt: null, ratesError: null };

  const ratesFile = path.join(userData, RATES_FILE);
  const liveFile = path.join(userData, LIVE_FILE);

  function readRates() {
    const saved = readJson(ratesFile);
    const parsed = parseRates(saved);
    return parsed ? { ...parsed, fetchedAt: Number(saved.fetchedAt) || 0 } : null;
  }

  async function refreshPrices() {
    try {
      const [litellm, openrouter] = await Promise.all([fetchJson(LITELLM_URL), fetchJson(OPENROUTER_URL)]);
      const next = buildTable({ litellm, openrouter, now: new Date(now()) });
      if (!isUsableTable(next)) throw new Error("the downloaded list is incomplete");
      fs.mkdirSync(userData, { recursive: true });
      writeAtomic(liveFile, JSON.stringify(next));
      table.reload();
      status.pricesAt = now();
      status.pricesError = null;
      return { ok: true, at: status.pricesAt };
    } catch (error) {
      status.pricesError = error.message;
      log?.warn?.("pricing", `price refresh failed: ${error.message}`);
      return { ok: false, error: error.message };
    }
  }

  async function refreshRates() {
    try {
      const parsed = parseRates(await fetchJson(RATES_URL));
      if (!parsed) throw new Error("the rates answer is not usable");
      fs.mkdirSync(userData, { recursive: true });
      writeAtomic(ratesFile, JSON.stringify({ ...parsed, fetchedAt: now() }));
      status.ratesAt = now();
      status.ratesError = null;
      return { ok: true, at: status.ratesAt };
    } catch (error) {
      status.ratesError = error.message;
      log?.warn?.("pricing", `rates refresh failed: ${error.message}`);
      return { ok: false, error: error.message };
    }
  }

  /** Both lists, one run at a time. `force` skips the freshness check, as the Update now button does. */
  function refresh({ force = false } = {}) {
    if (running) return running;
    running = (async () => {
      const lastPrices = status.pricesAt ?? (Date.parse(table.get()?.generatedAt ?? "") || 0);
      const lastRates = status.ratesAt ?? readRates()?.fetchedAt ?? 0;
      const stalePrices = force || table.origin() !== "live" || now() - lastPrices >= FRESH_MS;
      const staleRates = force || now() - lastRates >= FRESH_MS;
      const prices = stalePrices ? await refreshPrices() : { ok: true, skipped: true };
      const rates = staleRates ? await refreshRates() : { ok: true, skipped: true };
      if (!prices.skipped || !rates.skipped) onUpdate?.(snapshot());
      return { prices, rates };
    })().finally(() => {
      running = null;
    });
    return running;
  }

  function snapshot() {
    const current = table.get();
    return {
      origin: table.origin(),
      pricesGeneratedAt: current?.generatedAt ?? null,
      priceCount: current ? Object.values(current.providers).reduce((sum, models) => sum + Object.keys(models).length, 0) : 0,
      ratesDate: readRates()?.date || null,
      ...status,
    };
  }

  /** Starts or stops the schedule. Off means no request leaves the app on its own. */
  function setAutomatic(on) {
    clearTimeout(first);
    clearInterval(timer);
    first = timer = null;
    if (!on) return;
    const tick = () => void refresh().catch((error) => log?.warn?.("pricing", `scheduled refresh failed: ${error.message}`));
    first = setTimeout(tick, FIRST_CHECK_MS);
    timer = setInterval(tick, CHECK_INTERVAL_MS);
    first.unref?.();
    timer.unref?.();
  }

  return { refresh, status: snapshot, rates: readRates, setAutomatic, dispose: () => setAutomatic(false) };
}

module.exports = { RATES_URL, RATES_FILE, ALLOWED_URLS, FRESH_MS, parseRates, createPricingRefresher };
