import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { MIN_PRICES, LIVE_FILE, bundledPath, isUsableTable, readTable, createPriceTable } = require("./table.cjs");

const tableOf = (count, extra = {}) => ({
  version: 1,
  generatedAt: "2026-10-01T00:00:00.000Z",
  providers: {
    openai: Object.fromEntries(Array.from({ length: count }, (_, i) => [`model-${i}`, { inputPerM: 1, outputPerM: 2, ...extra }])),
  },
});

let dir;
let userData;
let bundled;

const write = (file, value) => fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-prices-"));
  userData = path.join(dir, "user");
  fs.mkdirSync(userData);
  bundled = path.join(dir, "prices.json");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("what counts as a usable price table", () => {
  it("accepts a table with enough well-formed prices", () => {
    expect(isUsableTable(tableOf(MIN_PRICES))).toBe(true);
  });

  it("rejects a table that is too small to be a price list", () => {
    expect(isUsableTable(tableOf(MIN_PRICES - 1))).toBe(false);
  });

  it("rejects missing or malformed shapes", () => {
    expect(isUsableTable(null)).toBe(false);
    expect(isUsableTable("prices")).toBe(false);
    expect(isUsableTable({})).toBe(false);
    expect(isUsableTable({ providers: null })).toBe(false);
    expect(isUsableTable({ providers: { openai: null } })).toBe(false);
  });

  it("rejects negative, missing or non-numeric rates", () => {
    expect(isUsableTable(tableOf(MIN_PRICES, { inputPerM: -1 }))).toBe(false);
    expect(isUsableTable(tableOf(MIN_PRICES, { outputPerM: "2" }))).toBe(false);
    expect(isUsableTable(tableOf(MIN_PRICES, { cacheReadPerM: Number.NaN }))).toBe(false);
    const missing = tableOf(MIN_PRICES);
    delete missing.providers.openai["model-0"].outputPerM;
    expect(isUsableTable(missing)).toBe(false);
  });

  it("accepts the snapshot that ships with the app", () => {
    expect(readTable(bundledPath())).not.toBeNull();
  });
});

describe("where the snapshot lives", () => {
  it("is beside the resources when packaged", () => {
    expect(bundledPath({ resourcesPath: "/res", packaged: true })).toBe(path.join("/res", "prices.json"));
  });
});

describe("loading the table", () => {
  it("reads the bundled snapshot when nothing was refreshed", () => {
    write(bundled, { ...tableOf(MIN_PRICES), generatedAt: "bundled" });
    const loader = createPriceTable({ userData, bundled });
    expect(loader.get().generatedAt).toBe("bundled");
    expect(loader.origin()).toBe("bundled");
  });

  it("prefers a refreshed copy over the snapshot", () => {
    write(bundled, { ...tableOf(MIN_PRICES), generatedAt: "bundled" });
    write(path.join(userData, LIVE_FILE), { ...tableOf(MIN_PRICES), generatedAt: "live" });
    const loader = createPriceTable({ userData, bundled });
    expect(loader.get().generatedAt).toBe("live");
    expect(loader.origin()).toBe("live");
  });

  it("falls back to the snapshot when the refreshed copy is corrupt", () => {
    write(bundled, { ...tableOf(MIN_PRICES), generatedAt: "bundled" });
    write(path.join(userData, LIVE_FILE), "{ not json");
    const loader = createPriceTable({ userData, bundled });
    expect(loader.get().generatedAt).toBe("bundled");
    expect(loader.origin()).toBe("bundled");
  });

  it("falls back to the snapshot when the refreshed copy is too small", () => {
    write(bundled, { ...tableOf(MIN_PRICES), generatedAt: "bundled" });
    write(path.join(userData, LIVE_FILE), tableOf(MIN_PRICES - 1));
    const loader = createPriceTable({ userData, bundled });
    expect(loader.get().generatedAt).toBe("bundled");
  });

  it("returns nothing, and logs, when neither copy is usable", () => {
    const warnings = [];
    const loader = createPriceTable({ userData, bundled, log: { warn: (...args) => warnings.push(args) } });
    expect(loader.get()).toBeNull();
    expect(loader.origin()).toBe("none");
    expect(warnings).toHaveLength(1);
  });

  it("reads the disk once, and again only after reload", () => {
    write(bundled, { ...tableOf(MIN_PRICES), generatedAt: "bundled" });
    const loader = createPriceTable({ userData, bundled });
    expect(loader.get().generatedAt).toBe("bundled");

    write(path.join(userData, LIVE_FILE), { ...tableOf(MIN_PRICES), generatedAt: "live" });
    expect(loader.get().generatedAt).toBe("bundled");

    loader.reload();
    expect(loader.get().generatedAt).toBe("live");
  });

  it("names the refreshed copy's file", () => {
    expect(createPriceTable({ userData, bundled }).liveFile()).toBe(path.join(userData, LIVE_FILE));
    expect(createPriceTable({ bundled }).liveFile()).toBeNull();
  });
});
