import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import stats from "./tierStats.cjs";

const plan = { expectedTokPerSec: [0.4, 0.9], expectedHitRate: [0.1, 0.3] };

describe("tierStats", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-tier-"));
    stats.resetForTests();
  });
  afterEach(() => {
    stats.resetForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("trusts nothing until three replies are measured", () => {
    stats.record(dir, "m", { tokPerSec: 1, tokens: 50 });
    stats.record(dir, "m", { tokPerSec: 1, tokens: 50 });
    expect(stats.observed(dir, "m")).toBeNull();
    stats.record(dir, "m", { tokPerSec: 1, tokens: 50 });
    expect(stats.observed(dir, "m")).toMatchObject({ samples: 3, tokPerSec: 1 });
  });

  it("ignores short replies and nonsense numbers", () => {
    stats.record(dir, "m", { tokPerSec: 5, tokens: 3 });
    stats.record(dir, "m", { tokPerSec: -1, tokens: 99 });
    stats.record(dir, "m", { tokPerSec: Number.NaN, tokens: 99 });
    expect(fs.existsSync(path.join(dir, "tier-stats.json"))).toBe(false);
  });

  it("survives a restart and keeps only numbers on disk", () => {
    for (let i = 0; i < 3; i += 1) stats.record(dir, "m", { tokPerSec: 2, hitRate: 0.5, tokens: 40 });
    stats.resetForTests();
    expect(stats.observed(dir, "m")).toMatchObject({ tokPerSec: 2, hitRate: 0.5 });
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "tier-stats.json"), "utf8"));
    expect(Object.keys(saved.m).sort()).toEqual(["hitRate", "samples", "tokPerSec"]);
  });

  it("centres the plan's range on the measured speed", () => {
    const next = stats.applyObserved(plan, { tokPerSec: 2, hitRate: 0.6, samples: 3 });
    expect(next).toMatchObject({ expectedTokPerSec: [1.5, 2.5], expectedHitRate: [0.6, 0.6], measured: true });
    expect(stats.applyObserved(plan, null)).toBe(plan);
    const refused = { refusal: { reason: "ram-floor" }, expectedTokPerSec: null };
    expect(stats.applyObserved(refused, { tokPerSec: 2, hitRate: null, samples: 3 })).toBe(refused);
  });

  it("reads a hit rate from counts and refuses anything else", () => {
    expect(stats.hitRateFrom({ hits: 3, misses: 1 })).toBe(0.75);
    expect(stats.hitRateFrom({ hits: 0, misses: 0 })).toBeNull();
    expect(stats.hitRateFrom({ layers: [] })).toBeNull();
    expect(stats.hitRateFrom(null)).toBeNull();
  });

  it("backs the hot set up and restores it only into a folder that has none", () => {
    const model = path.join(dir, "model");
    fs.mkdirSync(model);
    expect(stats.backupUsage(dir, "m", model)).toBe(false);
    fs.writeFileSync(path.join(model, ".coli_usage"), "hot");
    expect(stats.backupUsage(dir, "m", model)).toBe(true);
    fs.rmSync(path.join(model, ".coli_usage"));
    expect(stats.restoreUsage(dir, "m", model)).toBe(true);
    expect(fs.readFileSync(path.join(model, ".coli_usage"), "utf8")).toBe("hot");
    fs.writeFileSync(path.join(model, ".coli_usage"), "newer");
    expect(stats.restoreUsage(dir, "m", model)).toBe(false);
    expect(fs.readFileSync(path.join(model, ".coli_usage"), "utf8")).toBe("newer");
  });
});
