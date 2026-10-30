import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createPriceTable, LIVE_FILE } = require("./table.cjs");
const { LITELLM_URL, OPENROUTER_URL } = require("./build.cjs");
const { ALLOWED_URLS, RATES_URL, RATES_FILE, FRESH_MS, parseRates, createPricingRefresher } = require("./refresh.cjs");

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 28);

const litellm = (count, generation = 1) =>
  Object.fromEntries(
    Array.from({ length: count }, (_, i) => [
      `gpt-${i}`,
      { litellm_provider: "openai", mode: "chat", input_cost_per_token: generation * 1e-6, output_cost_per_token: generation * 2e-6 },
    ]),
  );

const rates = { amount: 1, base: "USD", date: "2026-10-28", rates: { EUR: 0.9, GBP: 0.75, JPY: 158, CAD: 1.4, AUD: 1.42 } };

let dir;
let userData;
let bundled;
let clock;
let table;
let calls;

function answers(overrides = {}) {
  const map = { [LITELLM_URL]: litellm(250), [OPENROUTER_URL]: { data: [] }, [RATES_URL]: rates, ...overrides };
  return vi.fn(async (url) => {
    calls.push(url);
    const value = map[url];
    if (value instanceof Error) throw value;
    return value;
  });
}

const refresher = (fetchJson, extra = {}) => createPricingRefresher({ userData, table, fetchJson, now: () => clock, ...extra });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-refresh-"));
  userData = path.join(dir, "user");
  fs.mkdirSync(userData);
  bundled = path.join(dir, "prices.json");
  fs.writeFileSync(
    bundled,
    JSON.stringify({
      version: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      providers: { openai: Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`gpt-${i}`, { inputPerM: 5, outputPerM: 10 }])) },
    }),
  );
  table = createPriceTable({ userData, bundled });
  clock = T0;
  calls = [];
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("what the app may fetch", () => {
  it("allows only the three public lists", () => {
    expect(ALLOWED_URLS).toEqual([LITELLM_URL, OPENROUTER_URL, RATES_URL]);
    for (const url of ALLOWED_URLS) expect(new URL(url).protocol).toBe("https:");
  });
});

describe("refreshing prices", () => {
  it("writes a good download beside the app data and switches to it", async () => {
    const result = await refresher(answers()).refresh({ force: true });
    expect(result.prices.ok).toBe(true);
    expect(fs.existsSync(path.join(userData, LIVE_FILE))).toBe(true);
    expect(table.origin()).toBe("live");
    expect(table.get().providers.openai["gpt-0"].inputPerM).toBe(1);
  });

  it("keeps the old table when the list is too small", async () => {
    const result = await refresher(answers({ [LITELLM_URL]: litellm(10) })).refresh({ force: true });
    expect(result.prices.ok).toBe(false);
    expect(fs.existsSync(path.join(userData, LIVE_FILE))).toBe(false);
    expect(table.origin()).toBe("bundled");
    expect(table.get().providers.openai["gpt-0"].inputPerM).toBe(5);
  });

  it("keeps the old table when a request fails, and says why", async () => {
    const warnings = [];
    const instance = refresher(answers({ [OPENROUTER_URL]: new Error("answered 503") }), { log: { warn: (...a) => warnings.push(a) } });
    const result = await instance.refresh({ force: true });
    expect(result.prices).toMatchObject({ ok: false, error: "answered 503" });
    expect(instance.status().pricesError).toBe("answered 503");
    expect(warnings).toHaveLength(1);
    expect(table.origin()).toBe("bundled");
  });

  it("does not fetch again inside a day, but does once the copy is old", async () => {
    const instance = refresher(answers());
    await instance.refresh({ force: true });
    calls.length = 0;

    clock += FRESH_MS - 1;
    await instance.refresh();
    expect(calls).toEqual([]);

    clock += 2;
    await instance.refresh();
    expect(calls).toContain(LITELLM_URL);
    expect(calls).toContain(RATES_URL);
  });

  it("runs one refresh at a time", async () => {
    const instance = refresher(answers());
    const [a, b] = [instance.refresh({ force: true }), instance.refresh({ force: true })];
    expect(a).toBe(b);
    await a;
    expect(calls.filter((url) => url === LITELLM_URL)).toHaveLength(1);
  });

  it("tells the caller what changed", async () => {
    const onUpdate = vi.fn();
    await refresher(answers(), { onUpdate }).refresh({ force: true });
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ origin: "live", ratesDate: "2026-10-28" }));
  });
});

describe("exchange rates", () => {
  it("keeps USD as 1 and drops malformed codes and rates", () => {
    const parsed = parseRates({ base: "USD", date: "d", rates: { ...rates.rates, bad: 1, XXX: -2, YYY: "3" } });
    expect(parsed.rates).toEqual({ USD: 1, ...rates.rates });
  });

  it("rejects another base or too few rates", () => {
    expect(parseRates({ base: "EUR", rates: rates.rates })).toBeNull();
    expect(parseRates({ base: "USD", rates: { EUR: 0.9 } })).toBeNull();
    expect(parseRates(null)).toBeNull();
  });

  it("stores the rates and reads them back", async () => {
    const instance = refresher(answers());
    await instance.refresh({ force: true });
    expect(fs.existsSync(path.join(userData, RATES_FILE))).toBe(true);
    expect(instance.rates()).toMatchObject({ base: "USD", date: "2026-10-28", fetchedAt: T0 });
    expect(instance.rates().rates.EUR).toBe(0.9);
  });

  it("falls back to no rates when the answer is bad", async () => {
    const instance = refresher(answers({ [RATES_URL]: { base: "USD", rates: {} } }));
    const result = await instance.refresh({ force: true });
    expect(result.rates.ok).toBe(false);
    expect(instance.rates()).toBeNull();
  });
});

describe("the schedule", () => {
  it("sends nothing while it is off", async () => {
    vi.useFakeTimers();
    const fetchJson = answers();
    const instance = refresher(fetchJson);
    instance.setAutomatic(false);
    await vi.advanceTimersByTimeAsync(3 * DAY);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("checks shortly after it is turned on and stops when turned off", async () => {
    vi.useFakeTimers();
    const fetchJson = answers();
    const instance = refresher(fetchJson);
    instance.setAutomatic(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchJson).toHaveBeenCalled();

    instance.setAutomatic(false);
    const seen = fetchJson.mock.calls.length;
    clock += 2 * DAY;
    await vi.advanceTimersByTimeAsync(2 * DAY);
    expect(fetchJson.mock.calls.length).toBe(seen);
  });
});
