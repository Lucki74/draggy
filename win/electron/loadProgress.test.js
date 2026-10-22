import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createLoadProgress, roundDown } = require("./loadProgress.cjs");

// Every figure is the engine's: the load percent is its dots, the speed is tokens over elapsed time.

function setup() {
  let clock = 0;
  const seen = [];
  const progress = createLoadProgress({ emit: (event) => seen.push(event), now: () => clock });
  return { progress, seen, advance: (ms) => (clock += ms) };
}

describe("load percent", () => {
  it("moves in steps of 3 and never reaches 100", () => {
    expect(roundDown(0)).toBe(0);
    expect(roundDown(7)).toBe(6);
    expect(roundDown(100)).toBe(99);
  });

  it("shows disk, then loading, then readying, with no invented numbers", () => {
    const { progress, seen } = setup();
    progress.handle({ stage: "disk" });
    progress.handle({ stage: "loading", percent: 4 });
    progress.handle({ stage: "loading", percent: 5 });
    progress.handle({ stage: "loading", percent: 100 });
    progress.handle({ stage: "readying" });
    expect(seen).toEqual([{ stage: "disk" }, { stage: "loading", percent: 3 }, { stage: "loading", percent: 99 }, { stage: "readying" }]);
  });

  it("reads the prompt at the speed it is going and ends in readying", () => {
    const { progress, seen, advance } = setup();
    progress.handle({ stage: "reading", tokens: 0, percent: 0 });
    advance(1000);
    progress.handle({ stage: "reading", tokens: 800, percent: 40 });
    advance(1000);
    progress.handle({ stage: "reading", tokens: 2000, percent: 100 });
    expect(seen).toEqual([
      { stage: "reading", percent: 0 },
      { stage: "reading", percent: 39, tokensPerSecond: 800 },
      { stage: "readying" },
    ]);
  });
});
