// Golden fixtures for the model store. Each case drives the Electron/CJS reference (electron/huggingface.cjs, modelCache.cjs)
// and checks what it returns. core/crates/models/tests/modelstore.rs runs the same files against the Rust port, so both must agree.
// Whole numbers in expected output are decimal strings, so 64-bit sizes survive JSON; `canon` applies the same rule here.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runScenario, type Scenario } from "./modelstoreDownloadHarness";

const require = createRequire(import.meta.url);
const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../../shared/fixtures/modelstore");
const HF_PATH = require.resolve("../../../electron/huggingface.cjs");

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Case = { name: string; input: unknown; expected: unknown };
type Rule = { match: string; status?: number; json?: unknown; link?: string; error?: string; times?: number; used?: number };
type Op = { op: string; args?: unknown[] };
type Flow = { responses: Rule[]; ops: Op[] };

const hf = require("../../../electron/huggingface.cjs") as Record<string, (...args: unknown[]) => unknown>;
const cache = require("../../../electron/modelCache.cjs") as {
  cachedPath: (root: string, relative: string) => string | null;
  modelFileHeaders: (relative: string, size: number) => Record<string, string>;
};

/** Whole numbers become decimal strings, everything else stays a JSON number. Mirrors the generator. */
function canon(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`non-finite output ${value}`);
    return Number.isInteger(value) ? BigInt(value).toString() : value;
  }
  if (Array.isArray(value)) return value.map((item) => canon(item));
  if (typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) out[key] = canon(item);
    }
    return out;
  }
  return value as Json;
}

function loadCases<T extends Case>(file: string): T[] {
  const parsed = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as { area: string; cases: T[] };
  expect(parsed.area).toBe("modelstore");
  return parsed.cases;
}

/** A fake hub: the first rule whose `match` appears in the URL answers, with its limit on uses; no rule means offline. */
function installHub(rules: Rule[], calls: string[]): void {
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    const rule = rules.find((r) => url.includes(r.match) && (r.times === undefined || (r.used ?? 0) < r.times));
    if (!rule) throw new Error("offline");
    rule.used = (rule.used ?? 0) + 1;
    if (rule.error) throw new Error(rule.error);
    const status = rule.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => (name.toLowerCase() === "link" ? (rule.link ?? null) : null) },
      json: async () => rule.json,
    };
  });
}

/** Runs the ops in order on one fresh module, so caches carry between them, and records each op's result and fetches. */
async function runFlow(input: Flow): Promise<unknown[]> {
  delete require.cache[HF_PATH];
  const fresh = require(HF_PATH) as Record<string, (...args: unknown[]) => unknown>;
  const calls: string[] = [];
  installHub(JSON.parse(JSON.stringify(input.responses)) as Rule[], calls);
  const results: unknown[] = [];
  for (const op of input.ops) {
    const before = calls.length;
    const args = op.args ?? [];
    let value: unknown;
    if (op.op === "search") value = await fresh.searchHuggingFace(args[0] ?? "");
    else if (op.op === "resolve") value = await fresh.resolveModelDownload(args[0], args[1]);
    else if (op.op === "size") value = await fresh.fetchModelSize(args[0], args[1]);
    else throw new Error(`unknown op ${op.op}`);
    results.push({ value: canon(value), fetches: calls.slice(before) });
  }
  return results;
}

describe("modelstore fixtures: huggingface sizes", () => {
  afterEach(() => vi.unstubAllGlobals());
  for (const c of loadCases<Case>("huggingface-sizes.json")) {
    it(c.name, () => {
      expect(canon(hf.extractAvailableSizes(c.input))).toEqual(c.expected);
    });
  }
});

describe("modelstore fixtures: huggingface task types", () => {
  for (const c of loadCases<Case>("huggingface-task-types.json")) {
    it(c.name, () => {
      expect(canon(hf.typeOfTask(c.input as string))).toEqual(c.expected);
    });
  }
});

describe("modelstore fixtures: huggingface flows", () => {
  afterEach(() => vi.unstubAllGlobals());
  for (const c of loadCases<Case>("huggingface-flow.json")) {
    it(c.name, async () => {
      expect(await runFlow(c.input as Flow)).toEqual(c.expected);
    });
  }
});

describe("modelstore fixtures: download flows", () => {
  for (const c of loadCases<Case>("download-flow.json")) {
    it(c.name, async () => {
      expect(await runScenario(c.input as Scenario)).toEqual(c.expected);
    });
  }
});

describe("modelstore fixtures: model cache paths", () => {
  for (const c of loadCases<Case>("model-cache-paths.json")) {
    it(c.name, () => {
      const input = c.input as { root: string; relative: string };
      const result = cache.cachedPath(input.root, input.relative);
      // A Windows host resolves "/cache" onto the current drive and joins with "\"; the fixtures spell it with "/".
      const portable = path.sep === "\\" && result !== null ? result.replace(/^[A-Za-z]:/, "").replaceAll("\\", "/") : result;
      expect(canon(portable)).toEqual(c.expected);
    });
  }
});

describe("modelstore fixtures: model cache headers", () => {
  for (const c of loadCases<Case>("model-cache-headers.json")) {
    it(c.name, () => {
      const input = c.input as { relative: string; size: number | string | null };
      // JSON cannot carry NaN, so a null or "NaN" length arrives as NaN, the way the reference reads a missing header.
      const size = input.size === null || input.size === "NaN" ? Number.NaN : (input.size as number);
      expect(canon(cache.modelFileHeaders(input.relative, size))).toEqual(c.expected);
    });
  }
});
