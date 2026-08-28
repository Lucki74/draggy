import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ROUTER_CANDIDATES,
  chooseRouterModel,
  parseRoute,
  resolveRouterModel,
} from "../router";
import { getRecommendedHelperModel } from "../modelRecommendations";

describe("choosing a small helper model", () => {
  it("prefers the first candidate that is installed", () => {
    expect(chooseRouterModel(["qwen3:8b", "qwen3:0.6b"], "qwen3:8b")).toBe("qwen3:0.6b");
  });

  it("returns nothing when only the big model is installed", () => {
    expect(chooseRouterModel(["qwen3:32b"], "qwen3:32b")).toBeNull();
  });

  it("ignores cloud models", () => {
    expect(chooseRouterModel(["qwen3:0.6b-cloud", "qwen3:8b"], "qwen3:8b")).toBeNull();
  });

  it("never picks the model already answering", () => {
    const picked = chooseRouterModel(["qwen3:1.7b"], "qwen3:1.7b");
    expect(picked).not.toBe("qwen3:1.7b");
  });

  it("follows the declared preference order", () => {
    const installed = [...ROUTER_CANDIDATES].reverse();
    expect(chooseRouterModel(installed, "qwen3:8b")).toBe(ROUTER_CANDIDATES[0]);
  });

  it("matches a differently tagged build of a candidate", () => {
    expect(chooseRouterModel(["llama3.2:1b-instruct-q4_K_M"], "qwen3:8b")).toBe(
      "llama3.2:1b-instruct-q4_K_M",
    );
  });
});

describe("parsing a routing decision", () => {
  it("reads the three verdicts", () => {
    expect(parseRoute("SEARCH")).toBe("search");
    expect(parseRoute("LOCAL")).toBe("local");
    expect(parseRoute("KNOWN")).toBe("known");
  });

  it("is case insensitive and tolerates punctuation", () => {
    expect(parseRoute("search.")).toBe("search");
    expect(parseRoute(" Known ")).toBe("known");
  });

  it("ignores reasoning that leaks out", () => {
    expect(parseRoute("<think>weather changes often</think> SEARCH")).toBe("search");
  });

  it("prefers LOCAL when a small model hedges with both", () => {
    expect(parseRoute("LOCAL or SEARCH")).toBe("local");
  });

  it("returns nothing for an unusable answer", () => {
    expect(parseRoute("I am not sure what you mean")).toBeNull();
    expect(parseRoute("")).toBeNull();
  });
});

describe("resolving a helper model, downloading one if needed", () => {
  it("uses an installed small model when there is one", () => {
    const resolved = resolveRouterModel(["qwen3:8b", "qwen3:0.6b"], "qwen3:8b", 8);

    expect(resolved.ready).toBe("qwen3:0.6b");
    expect(resolved.needsDownload).toBeNull();
  });

  it("asks for a download when nothing small is installed", () => {
    const resolved = resolveRouterModel(["qwen3:8b"], "qwen3:8b", 8);

    expect(resolved.ready).toBeNull();
    expect(resolved.needsDownload).toBe("llama3.2:1b");
  });

  it("scales the suggestion to the available VRAM", () => {
    expect(resolveRouterModel([], "big", 0).needsDownload).toBe("smollm2:360m");
    expect(resolveRouterModel([], "big", 4).needsDownload).toBe("qwen3:0.6b");
    expect(resolveRouterModel([], "big", 8).needsDownload).toBe("llama3.2:1b");
    expect(resolveRouterModel([], "big", 24).needsDownload).toBe("qwen3:1.7b");
  });

  it("falls back to the smallest model when VRAM is unknown", () => {
    expect(resolveRouterModel([], "big", 0).needsDownload).toBe("smollm2:360m");
  });

  it("never downloads the model already answering", () => {
    const resolved = resolveRouterModel(["llama3.2:1b"], "llama3.2:1b", 8);

    expect(resolved.ready).toBeNull();
    expect(resolved.needsDownload).not.toBe("llama3.2:1b");
  });

  it("prefers an installed model over downloading a different one", () => {
    const resolved = resolveRouterModel(["smollm2:360m"], "qwen3:8b", 24);
    expect(resolved.ready).toBe("smollm2:360m");
  });
});

describe("helper model ladder", () => {
  it("only ever suggests genuinely small models", () => {
    for (const vram of [0, 2, 4, 6, 8, 12, 16, 24, 48]) {
      const picked = getRecommendedHelperModel(vram);
      expect(picked).toMatch(/360m|0\.6b|1b|1\.7b/);
    }
  });

  it("never gets smaller as VRAM grows", () => {
    const order = ["smollm2:360m", "qwen3:0.6b", "llama3.2:1b", "qwen3:1.7b"];
    let previous = -1;

    for (const vram of [0, 4, 8, 16, 32]) {
      const index = order.indexOf(getRecommendedHelperModel(vram));
      expect(index).toBeGreaterThanOrEqual(previous);
      previous = index;
    }
  });
});

describe("when the best helper is the model already answering", () => {
  it("steps down the ladder instead of giving up", () => {
    // llama3.2:1b is the 8 GB recommendation, and also the main model here.
    const resolved = resolveRouterModel(["llama3.2:1b"], "llama3.2:1b", 8);

    expect(resolved.ready).toBeNull();
    expect(resolved.needsDownload).toBe("qwen3:0.6b");
  });

  it("keeps stepping down when several rungs collide", () => {
    const resolved = resolveRouterModel([], "qwen3:0.6b", 4);

    expect(resolved.needsDownload).toBe("smollm2:360m");
  });

  it("gives up only when nothing on the ladder is usable", () => {
    const resolved = resolveRouterModel([], "smollm2:360m", 0);

    expect(resolved.ready).toBeNull();
    expect(resolved.needsDownload).toBeNull();
  });

  it("never suggests the main model at any VRAM size", () => {
    for (const vram of [0, 4, 8, 16, 24, 48]) {
      for (const main of ["smollm2:360m", "qwen3:0.6b", "llama3.2:1b", "qwen3:1.7b"]) {
        const resolved = resolveRouterModel([], main, vram);
        expect(resolved.needsDownload).not.toBe(main);
        expect(resolved.ready).not.toBe(main);
      }
    }
  });

  it("still prefers an already-installed helper over any download", () => {
    const resolved = resolveRouterModel(["smollm2:360m"], "llama3.2:1b", 8);

    expect(resolved.ready).toBe("smollm2:360m");
    expect(resolved.needsDownload).toBeNull();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
