// Golden fixtures for the web policy, search and connectivity logic. Each case drives the Electron/CJS reference
// (electron/urlPolicy.cjs, search.cjs, connectivity.cjs) and checks what it returns. core/crates/web/tests/fixtures.rs runs
// the same inputs against the Rust port, so both must agree. Scraper providers run their extract scripts in jsdom, standing
// in for the hidden browser window, with a simplified innerText (see installInnerText). Page charsets are decoded with
// TextDecoder, standing in for the browser's charset step. Scraped pages never run their own scripts here, in the reference
// or in the port: a results page that fills in with JavaScript cannot be checked by either runner.
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as { JSDOM: new (html: string, options: object) => { window: Window & typeof globalThis } };
const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../shared/fixtures/web");

// RUNNERS START
type Case = { name: string; input: unknown; expected: unknown };
type DomLike = { nodeType: number; localName: string; data: string; childNodes: ArrayLike<DomLike>; nextElementSibling: unknown };
type Result = { title: string; url: string; snippet: string };
type Config = { searchProvider?: string; searxngUrl?: string; braveApiKey?: string };
type ScrapeOpts = { url: string; userAgent: string; readyExpression: string; extract: string };
type Deps = { now?: () => number; sleep?: (ms: number) => Promise<void>; scrape?: (opts: ScrapeOpts) => Promise<string> };
type Provider = { id: string; run: (query: string, config: Config, deps: Deps) => Promise<Result[]> };
type Outcome = { results: Result[]; provider: string | null; tried: string[]; status: string; cached?: boolean };

const policy = require("../../../electron/urlPolicy.cjs") as {
  isFetchableUrl: (value: unknown, options?: { allowPrivate?: boolean }) => boolean;
  isPrivateHostname: (hostname: string) => boolean;
  permissionGranted: (permission: string, origin: { fromAppWindow: boolean; fromAppPage: boolean }) => boolean;
  refusalFor: (value: unknown) => string;
  sessionCounts: () => Record<string, number>;
};
const { log } = require("../../../electron/logger.cjs") as {
  log: { warn: (scope: string, message: string, data?: Record<string, unknown>) => void };
};
const CONNECTIVITY_PATH = require.resolve("../../../electron/connectivity.cjs");
const search = require("../../../electron/search.cjs") as {
  runSearch: (query: unknown, config: Config, deps: Deps) => Promise<Outcome>;
  buildChain: (config: Config) => Provider[];
  normaliseResults: (raw: unknown) => Result[];
  unwrapRedirect: (url: string) => string;
  clearCache: () => void;
  PROVIDERS: Provider[];
};
const connectivity = require("../../../electron/connectivity.cjs") as {
  checkConnectivity: (options?: { request?: unknown; timeoutMs?: number }) => Promise<boolean>;
};

const START_MS = 1_000_000;
const CONFIG: Config = { searchProvider: "auto", searxngUrl: "http://searx.test:8080", braveApiKey: "BSA-test-key" };

/** The block-level elements a browser puts on their own line. */
const BLOCK_TAGS = new Set(
  "address article aside blockquote caption dd details dialog div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr li main menu nav ol p pre section summary table tbody thead tfoot tr ul".split(" "),
);
const HIDDEN_TAGS = new Set(["script", "style", "noscript", "template"]);

/** jsdom has no innerText, so this stands in for it. Simplified: text runs collapse, <br> and block edges become line
 * breaks, a table cell that has a sibling ends in a tab. Core/crates/web/src/search/dom.rs implements the same rules. */
function renderedText(node: DomLike): string {
  if (node.nodeType === 3) return String(node.data).replace(/[ \t\n\r\f]+/g, " ");
  if (node.nodeType !== 1) return "";
  const tag: string = node.localName;
  if (HIDDEN_TAGS.has(tag)) return "";
  if (tag === "br") return "\n";
  const block = BLOCK_TAGS.has(tag);
  let out = block ? "\n" : "";
  for (const child of Array.from(node.childNodes as unknown as ArrayLike<DomLike>)) out += renderedText(child);
  if ((tag === "td" || tag === "th") && node.nextElementSibling) out += "\t";
  if (block) out += "\n";
  return out;
}

/** Spaces next to a line break go, runs of spaces and of line breaks collapse to one. */
function tidy(text: string): string {
  let out = "";
  for (const ch of text) {
    if (ch === " ") {
      if (out === "" || out.endsWith(" ") || out.endsWith("\n")) continue;
      out += " ";
    } else if (ch === "\n") {
      while (out.endsWith(" ")) out = out.slice(0, -1);
      if (out === "" || out.endsWith("\n")) continue;
      out += "\n";
    } else {
      out += ch;
    }
  }
  while (out.endsWith(" ")) out = out.slice(0, -1);
  return out;
}

function installInnerText(win: { HTMLElement: { prototype: object } }): void {
  Object.defineProperty(win.HTMLElement.prototype, "innerText", {
    configurable: true,
    get() {
      return tidy(renderedText(this as unknown as DomLike));
    },
    set(_value: unknown) {},
  });
}

/** A lone surrogate becomes U+FFFD, the one character the Rust port writes in its place (a Rust string cannot hold one). */
function wellFormedText(text: string): string {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
}

function wellFormed(results: Result[]): Result[] {
  return results.map((result) => ({
    title: wellFormedText(result.title),
    url: wellFormedText(result.url),
    snippet: wellFormedText(result.snippet),
  }));
}

function providerById(id: string): Provider {
  const found = search.PROVIDERS.find((provider) => provider.id === id);
  if (!found) throw new Error(`no provider ${id}`);
  return found;
}

/** Routes a request URL to the provider that issued it. */
function providerOf(url: string): string {
  if (url.includes("&format=json")) return "searxng";
  const prefixes: [string, string][] = [
    ["https://html.duckduckgo.com/", "duckduckgo"],
    ["https://lite.duckduckgo.com/", "duckduckgo-lite"],
    ["https://www.startpage.com/", "startpage"],
    ["https://api.search.brave.com/", "brave"],
    ["https://search.brave.com/", "brave-html"],
  ];
  return prefixes.find(([prefix]) => url.startsWith(prefix))?.[1] ?? "unknown";
}

type Canned = { body?: string; status?: number; error?: string };
type Captured = { id: string; url: string; headers: Record<string, string> };

/** Stands in for the network. A scraper's canned page runs through its extract script in jsdom, the way the hidden
 * window runs it; an API gets a Response. Calls are recorded in order. */
function fakeWeb(canned: Record<string, Canned>) {
  const calls: Captured[] = [];
  const answer = (id: string): Canned => {
    const reply = canned[id];
    if (!reply) throw new Error(`no canned response for ${id}`);
    if (reply.error !== undefined) throw new Error(reply.error);
    return reply;
  };
  const scrape = async (opts: ScrapeOpts): Promise<string> => {
    const id = providerOf(opts.url);
    calls.push({ id, url: opts.url, headers: { "User-Agent": opts.userAgent } });
    const reply = answer(id);
    const dom = new JSDOM(reply.body ?? "", { url: opts.url, runScripts: "outside-only" });
    installInnerText(dom.window);
    return String(dom.window.eval(opts.extract));
  };
  const fetchStub = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const id = providerOf(url);
    const headers = { ...((init?.headers ?? {}) as Record<string, string>) };
    calls.push({ id, url, headers });
    const reply = answer(id);
    return new Response(reply.body ?? "", { status: reply.status ?? 200 });
  };
  return { calls, scrape, fetchStub };
}

async function withFetch<T>(stub: typeof fetch, body: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await body();
  } finally {
    globalThis.fetch = original;
  }
}

/** Provider failures are reported by message: a status the API returned, or a body the port cannot read. */
function failureOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /returned \d+$/.test(message) ? message : "invalid body";
}

function runUrl(input: { url: unknown; allowPrivate?: boolean }) {
  const fetchable = policy.isFetchableUrl(input.url, { allowPrivate: input.allowPrivate === true });
  return { fetchable, refusal: fetchable ? null : policy.refusalFor(input.url) };
}

function runHostname(input: { hostname: string }) {
  return policy.isPrivateHostname(input.hostname);
}

function runChain(input: { config: Config }) {
  return search.buildChain(input.config).map((provider) => provider.id);
}

/** The API calls set a timeout with AbortSignal.timeout, which is recorded here. A page's timeout is set in the shell. */
async function runQuery(input: { provider: string; query: string; searxngUrl?: string; braveApiKey?: string }) {
  const web = fakeWeb({ [input.provider]: { body: input.provider === "searxng" ? "{}" : "[]" } });
  const config: Config = { searchProvider: "auto", searxngUrl: input.searxngUrl ?? "", braveApiKey: input.braveApiKey ?? "" };
  const timeouts: number[] = [];
  const realTimeout = AbortSignal.timeout;
  AbortSignal.timeout = (ms: number) => {
    timeouts.push(ms);
    return realTimeout.call(AbortSignal, ms);
  };
  try {
    await withFetch(web.fetchStub, () => providerById(input.provider).run(input.query, config, { scrape: web.scrape }));
  } finally {
    AbortSignal.timeout = realTimeout;
  }
  const [call] = web.calls;
  return timeouts.length > 0
    ? { url: call.url, headers: call.headers, timeoutMs: timeouts[0] }
    : { url: call.url, headers: call.headers };
}

function runNormalise(input: { raw: unknown }) {
  return wellFormed(search.normaliseResults(input.raw));
}

function runRedirect(input: { url: string }) {
  return search.unwrapRedirect(input.url);
}

/** A browser decodes a page by the byte order mark, then the charset its Content-Type names, then UTF-8. */
function charsetOf(contentType: string | null): string | null {
  if (!contentType) return null;
  for (const param of contentType.split(";").slice(1)) {
    const equals = param.indexOf("=");
    if (equals < 0) continue;
    if (param.slice(0, equals).trim().toLowerCase() === "charset") {
      return param.slice(equals + 1).trim().replace(/^"+|"+$/g, "");
    }
  }
  return null;
}

/** windows-1252 bytes 0x80 to 0x9F, as the WHATWG index maps them. Node's TextDecoder maps them to C1 controls instead. */
const WINDOWS_1252_HIGH = "\u20AC\u0081\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u008D\u017D\u008F\u0090\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u009D\u017E\u0178";

function decodeLabelled(label: string, bytes: Uint8Array): string {
  const decoder = new TextDecoder(label);
  if (decoder.encoding !== "windows-1252") return decoder.decode(bytes);
  return Array.from(bytes, (byte) => (byte >= 0x80 && byte < 0xa0 ? WINDOWS_1252_HIGH[byte - 0x80] : String.fromCharCode(byte))).join("");
}

function runDecode(input: { contentType: string | null; bytes: number[] }) {
  // Uint8Array.from would wrap a value outside 0 to 255, so a malformed fixture fails here rather than decoding a different page.
  if (input.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new Error("fixture has a byte outside 0 to 255");
  }
  const bytes = Uint8Array.from(input.bytes);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  try {
    return decodeLabelled(charsetOf(input.contentType) ?? "utf-8", bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** The warning a failed provider logs. Every provider fails with the same message, so the first log line is the one kept. */
async function runRedact(input: { query: string; message: string }) {
  const logged: string[] = [];
  const realWarn = log.warn;
  log.warn = (scope, message, data) => {
    if (scope === "net.search" && message === "provider failed") logged.push(String(data?.error));
  };
  try {
    const web = fakeWeb(Object.fromEntries(search.PROVIDERS.map((provider) => [provider.id, { error: input.message }])));
    const deps: Deps = { now: () => START_MS, sleep: () => Promise.resolve(), scrape: web.scrape };
    await withFetch(web.fetchStub, () => search.runSearch(input.query, CONFIG, deps));
  } finally {
    log.warn = realWarn;
  }
  return wellFormedText(logged[0] ?? "");
}

/** One op per URL check or refusal-count snapshot. The counts are the difference since the case began, because the CJS keeps them for the process. */
function runPolicyOps(input: { ops: ({ url?: unknown; allowPrivate?: boolean; counts?: boolean })[] }) {
  const base = policy.sessionCounts();
  const steps = input.ops.map((op) => {
    if (op.counts === true) {
      const now = policy.sessionCounts();
      const counts = Object.fromEntries(Object.keys(base).map((rule) => [rule, now[rule] - base[rule]]));
      return { counts };
    }
    return { fetchable: policy.isFetchableUrl(op.url, { allowPrivate: op.allowPrivate === true }) };
  });
  return { steps };
}

async function runProviderBody(input: { provider: string; query: string; status?: number; body: string }) {
  const web = fakeWeb({ [input.provider]: { body: input.body, status: input.status } });
  try {
    const results = await withFetch(web.fetchStub, () => providerById(input.provider).run(input.query, CONFIG, { scrape: web.scrape }));
    return { results: wellFormed(results) };
  } catch (error) {
    return { error: failureOf(error) };
  }
}

/** Ordered op list: one shared cache and pacing state, a virtual clock, and one result per op. */
async function runSearchOps(input: {
  ops: { at?: number; query: string; config: Config; responses: Record<string, Canned> }[];
}) {
  search.clearCache();
  let clock = START_MS;
  const steps: unknown[] = [];
  for (const op of input.ops) {
    if (op.at !== undefined) clock = op.at;
    const web = fakeWeb(op.responses);
    let waitedMs = 0;
    const deps: Deps = {
      now: () => clock,
      sleep: (ms: number) => {
        clock += ms;
        waitedMs += ms;
        return Promise.resolve();
      },
      scrape: web.scrape,
    };
    const outcome = await withFetch(web.fetchStub, () => search.runSearch(op.query, op.config, deps));
    steps.push({
      results: wellFormed(outcome.results),
      provider: outcome.provider,
      tried: outcome.tried,
      status: outcome.status,
      cached: outcome.cached === true,
      called: web.calls.map((call) => call.id),
      waitedMs,
    });
  }
  return { steps };
}

type ProbeCall = { url: string; method: string; followRedirects: boolean; timeoutMs: number };

/** A stand-in for https.request that answers with one outcome and records each request. Node's https.request never follows
 * a redirect, so the probe always records followRedirects false. */
function probeRequest(outcome: number | string, calls: ProbeCall[]) {
  return (url: string, options: { method: string }, onResponse: (res: { statusCode: number; resume: () => void }) => void) => {
    const req = new EventEmitter() as EventEmitter & { setTimeout: (ms: number, cb: () => void) => void; destroy: () => void; end: () => void };
    let onTimeout: (() => void) | null = null;
    let timeoutMs = 0;
    req.setTimeout = (ms, callback) => {
      timeoutMs = ms;
      onTimeout = callback;
    };
    req.destroy = () => {};
    req.end = () => {
      calls.push({ url, method: options.method, followRedirects: false, timeoutMs });
      setTimeout(() => {
        if (outcome === "error") req.emit("error", new Error("ENOTFOUND"));
        else if (outcome === "timeout") onTimeout?.();
        else onResponse({ statusCode: Number(outcome), resume: () => {} });
      }, 0);
    };
    return req;
  };
}

function runConnectivity(input: { outcome: number | string }) {
  const calls: ProbeCall[] = [];
  return connectivity.checkConnectivity({ request: probeRequest(input.outcome, calls) }).then((online) => ({ online, calls }));
}

type Level = "debug" | "info" | "warn" | "error";
type LogLine = { level: Level; scope: string; message: string; data: Record<string, unknown> };
type LogFn = (scope: string, message: string, data?: Record<string, unknown>) => void;

/** Records the lines the logger writes while `body` runs, as the Rust runner records its tracing events. */
async function captureLogs<T>(body: () => Promise<T>): Promise<{ value: T; logs: LogLine[] }> {
  const logs: LogLine[] = [];
  const logger = log as unknown as Record<Level, LogFn>;
  const levels: Level[] = ["debug", "info", "warn", "error"];
  const originals = levels.map((level) => logger[level]);
  for (const level of levels) {
    logger[level] = (scope, message, data) => {
      logs.push({ level, scope, message, data: data ?? {} });
    };
  }
  try {
    return { value: await body(), logs };
  } finally {
    levels.forEach((level, index) => {
      logger[level] = originals[index];
    });
  }
}

/** Checks in order through one copy of the module, which keeps its last answer: each case starts from a fresh copy. */
async function runConnectivityLog(input: { ops: { outcome: number | string }[] }) {
  delete require.cache[CONNECTIVITY_PATH];
  const fresh = require(CONNECTIVITY_PATH) as typeof connectivity;
  const steps: { online: boolean; logs: LogLine[] }[] = [];
  for (const op of input.ops) {
    const { value: online, logs } = await captureLogs(() => fresh.checkConnectivity({ request: probeRequest(op.outcome, []) }));
    steps.push({ online, logs });
  }
  return { steps };
}

/** A permission check: the permission name and the two origin flags the CJS reads. */
function runPermission(input: { permission: string; fromAppWindow: boolean; fromAppPage: boolean }) {
  return policy.permissionGranted(input.permission, { fromAppWindow: input.fromAppWindow, fromAppPage: input.fromAppPage });
}

/** Ordered op list through one search module, as runSearchOps, with the net.search events each step logs. */
async function runSearchLog(input: {
  ops: { at?: number; query: string; config: Config; responses: Record<string, Canned> }[];
}) {
  search.clearCache();
  let clock = START_MS;
  const steps: unknown[] = [];
  for (const op of input.ops) {
    if (op.at !== undefined) clock = op.at;
    const web = fakeWeb(op.responses);
    const deps: Deps = {
      now: () => clock,
      sleep: (ms: number) => {
        clock += ms;
        return Promise.resolve();
      },
      scrape: web.scrape,
    };
    const { value: outcome, logs } = await captureLogs(() =>
      withFetch(web.fetchStub, () => search.runSearch(op.query, op.config, deps)),
    );
    steps.push({
      status: outcome.status,
      provider: outcome.provider,
      cached: outcome.cached === true,
      called: web.calls.map((call) => call.id),
      logs,
    });
  }
  return { steps };
}

const RUNNERS: Record<string, (input: never) => unknown> = {
  "urls.json": runUrl,
  "hostnames.json": runHostname,
  "search-chain.json": runChain,
  "search-query.json": runQuery,
  "search-normalise.json": runNormalise,
  "search-redirect.json": runRedirect,
  "search-duckduckgo.json": runProviderBody,
  "search-duckduckgo-lite.json": runProviderBody,
  "search-startpage.json": runProviderBody,
  "search-brave-html.json": runProviderBody,
  "search-searxng.json": runProviderBody,
  "search-brave.json": runProviderBody,
  "search-run.json": runSearchOps,
  "search-log.json": runSearchLog,
  "connectivity.json": runConnectivity,
  "connectivity-log.json": runConnectivityLog,
  "page-decode.json": runDecode,
  "permissions.json": runPermission,
  "search-redact.json": runRedact,
  "policy-counts.json": runPolicyOps,
};
// RUNNERS END

describe("web fixtures", () => {
  for (const file of fs.readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".json")).sort()) {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as { cases: Case[] };
    describe(file, () => {
      for (const testCase of fixture.cases) {
        it(testCase.name, async () => {
          const runner = RUNNERS[file];
          if (!runner) throw new Error(`no runner for ${file}`);
          expect(await runner(testCase.input as never)).toEqual(testCase.expected);
        });
      }
    });
  }
});
