import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const draftStats = require("./draftStats.cjs");

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "draggy-draft-stats-"));

describe("draftStats", () => {
  afterEach(() => draftStats.resetForTests());

  it("reads llama-server's acceptance line", () => {
    const line = "slot print_timing: id  0 | task 12 | draft acceptance rate = 0.62857 (   44 accepted /    70 generated)";
    expect(draftStats.parseAcceptance(line)).toEqual({ rate: 44 / 70, accepted: 44, generated: 70 });
    expect(draftStats.parseAcceptance("eval time = 10 ms")).toBeNull();
    expect(draftStats.parseAcceptance("draft acceptance rate = 0.0 (0 accepted / 0 generated)")).toBeNull();
  });

  it("keeps the default draft length until enough replies are measured", () => {
    const dir = tempDir();
    draftStats.record(dir, "/m/a.gguf", { rate: 0.95, generated: 10 });
    expect(draftStats.draftSettings(dir, "/m/a.gguf")).toMatchObject({ enabled: true, max: 8 });
  });

  it("drafts longer for a model whose drafts are mostly accepted, and stops for one whose are not", () => {
    const dir = tempDir();
    for (let i = 0; i < 4; i++) draftStats.record(dir, "/m/good.gguf", { rate: 0.85, generated: 10 });
    for (let i = 0; i < 4; i++) draftStats.record(dir, "/m/bad.gguf", { rate: 0.1, generated: 10 });
    expect(draftStats.draftSettings(dir, "/m/good.gguf")).toMatchObject({ enabled: true, max: 16 });
    expect(draftStats.draftSettings(dir, "/m/bad.gguf")).toMatchObject({ enabled: false });

    // Kept across runs.
    draftStats.resetForTests();
    expect(draftStats.draftSettings(dir, "/m/good.gguf").max).toBe(16);
  });

  it("never tries a refused draft again", () => {
    const dir = tempDir();
    draftStats.recordRefusal(dir, "/m/a.gguf");
    expect(draftStats.isRefused(dir, "/m/a.gguf")).toBe(true);
    expect(draftStats.draftSettings(dir, "/m/a.gguf").enabled).toBe(false);
  });
});
