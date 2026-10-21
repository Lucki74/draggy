import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createLoadProgress, roundDown } = require("./loadProgress.cjs");

// The engine prints nothing while it reads the weights, so the percent is an estimate in steps of 3.

function setup(over = {}) {
  let clock = 0;
  let tick = null;
  const seen = [];
  const logger = { info: vi.fn(), warn: vi.fn() };
  const progress = createLoadProgress({
    modelPath: "m.gguf",
    sizeBytes: 10 * 1024 ** 3,
    userDataDir: null,
    emit: (event) => seen.push(event),
    logger,
    now: () => clock,
    setTick: (fn) => {
      tick = fn;
      return { unref() {} };
    },
    clearTick: () => {
      tick = null;
    },
    ...over,
  });
  return { progress, seen, logger, advance: (ms) => { clock += ms; tick?.(); } };
}

describe("load percent", () => {
  it("moves in steps of 3 and never passes 99 before the stage ends", () => {
    expect(roundDown(0)).toBe(0);
    expect(roundDown(7)).toBe(6);
    expect(roundDown(100)).toBe(99);
  });

  it("walks from disk to ready and logs how long each stage took", () => {
    const { progress, seen, logger, advance } = setup();

    progress.handle({ stage: "reading" });
    advance(5000);
    advance(60000);
    progress.handle({ stage: "placing" });
    advance(1000);
    progress.handle({ stage: "prefilling", percent: 14 });
    progress.handle({ stage: "ready" });

    expect(seen[0]).toEqual({ stage: "reading", percent: 0 });
    expect(seen.filter((event) => event.stage === "reading").every((event) => event.percent % 3 === 0)).toBe(true);
    expect(Math.max(...seen.filter((event) => event.stage === "reading").map((event) => event.percent))).toBe(99);
    expect(seen).toContainEqual({ stage: "prefilling", percent: 12 });
    expect(seen.at(-1)).toEqual({ stage: "ready" });
    expect(logger.info).toHaveBeenCalledWith("llama.load", "stage done", { stage: "reading", durMs: 65000 });
  });

  it("paces the percent by how long the stage took last time", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-load-"));
    const first = setup({ userDataDir: dir });
    first.progress.handle({ stage: "reading" });
    first.advance(4000);
    first.progress.handle({ stage: "placing" });
    first.progress.handle({ stage: "ready" });

    const second = setup({ userDataDir: dir });
    second.progress.handle({ stage: "reading" });
    second.advance(2000);

    expect(second.seen.at(-1)).toEqual({ stage: "reading", percent: 48 });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
