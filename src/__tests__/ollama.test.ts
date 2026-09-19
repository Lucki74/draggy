import { afterEach, describe, expect, it } from "vitest";
import {
  CONTEXT_BUCKETS,
  FALLBACK_CONTEXT_LENGTH,
  contextSizeFor,
  forgetContextSize,
  forgetModelInfo,
  isCloudModel,
  mergeMetrics,
  needsTextModeTools,
  peekContextSize,
  pickContextSize,
  readMetrics,
} from "../ollama";

describe("context budgeting", () => {
  it("rounds a small conversation up to the smallest bucket", () => {
    expect(pickContextSize(100, 131072)).toBe(4096);
  });

  it("always leaves headroom above the estimated requirement", () => {
    for (const chars of [0, 1000, 20000, 100000, 400000]) {
      const chosen = pickContextSize(chars, 131072);
      const needed = Math.ceil(chars / 4) + 2048;
      expect(chosen).toBeGreaterThanOrEqual(Math.min(needed, 131072));
    }
  });

  it("only ever chooses a listed bucket, or the ceiling", () => {
    for (const chars of [500, 5000, 50000, 200000]) {
      const chosen = pickContextSize(chars, 131072);
      expect(CONTEXT_BUCKETS).toContain(chosen);
    }
  });

  it("clamps to what the model actually supports", () => {
    expect(pickContextSize(400000, 8192)).toBe(8192);
    expect(pickContextSize(100, 4096)).toBe(4096);
  });

  it("falls back when the model reports no context length", () => {
    expect(pickContextSize(1_000_000, null)).toBe(FALLBACK_CONTEXT_LENGTH);
  });

  it("is monotonic in conversation length", () => {
    let previous = 0;
    for (const chars of [0, 10_000, 50_000, 120_000, 300_000, 900_000]) {
      const chosen = pickContextSize(chars, 131072);
      expect(chosen).toBeGreaterThanOrEqual(previous);
      previous = chosen;
    }
  });
});

describe("cloud model exclusion", () => {
  const cloud = ["gpt-oss:cloud", "qwen3-coder:480b-cloud", "deepseek-v3.1:671b-cloud"];
  const local = ["qwen3:8b", "llama3.2", "phi4-mini", "gemma3:27b", "nomic-embed-text"];

  for (const name of cloud) {
    it(`treats ${name} as cloud`, () => expect(isCloudModel(name)).toBe(true));
  }

  for (const name of local) {
    it(`treats ${name} as local`, () => expect(isCloudModel(name)).toBe(false));
  }

  it("is not fooled by the word cloud inside a model name", () => {
    expect(isCloudModel("cloudy-llm:7b")).toBe(false);
  });
});

const NS = 1e6;

describe("reading generation metrics", () => {
  const chunk = {
    done: true,
    eval_count: 250,
    eval_duration: 5000 * NS,
    prompt_eval_count: 1200,
    prompt_eval_duration: 400 * NS,
    load_duration: 1500 * NS,
    total_duration: 6900 * NS,
  };

  it("converts nanoseconds to milliseconds", () => {
    const metrics = readMetrics(chunk, "qwen3:8b", 8192, 300);
    expect(metrics?.responseMs).toBe(5000);
    expect(metrics?.loadMs).toBe(1500);
  });

  it("computes tokens per second", () => {
    const metrics = readMetrics(chunk, "qwen3:8b", 8192, 300);
    expect(metrics?.tokensPerSecond).toBeCloseTo(50, 5);
  });

  it("keeps the time to first token it was given", () => {
    expect(readMetrics(chunk, "qwen3:8b", 8192, 317)?.timeToFirstTokenMs).toBe(317);
  });

  it("returns nothing when the chunk carries no counters", () => {
    expect(readMetrics({ done: true }, "m", 8192, null)).toBeNull();
  });

  it("does not divide by zero", () => {
    const metrics = readMetrics(
      { eval_count: 10, eval_duration: 0 },
      "m",
      4096,
      null,
    );
    expect(metrics?.tokensPerSecond).toBe(0);
  });
});

describe("merging metrics across tool loops", () => {
  const first = readMetrics(
    { eval_count: 100, eval_duration: 1000 * NS, prompt_eval_count: 500, total_duration: 1200 * NS },
    "m",
    8192,
    200,
  );
  const second = readMetrics(
    { eval_count: 300, eval_duration: 3000 * NS, prompt_eval_count: 900, total_duration: 3200 * NS },
    "m",
    16384,
    900,
  );

  it("adds up the generated tokens", () => {
    expect(mergeMetrics(first, second)?.responseTokens).toBe(400);
  });

  it("recomputes the rate over the combined time", () => {
    expect(mergeMetrics(first, second)?.tokensPerSecond).toBeCloseTo(100, 5);
  });

  it("keeps the largest context window the turn reached", () => {
    expect(mergeMetrics(first, second)?.contextWindow).toBe(16384);
  });

  it("keeps the first time-to-first-token, not the last", () => {
    expect(mergeMetrics(first, second)?.timeToFirstTokenMs).toBe(200);
  });

  it("tolerates a missing side", () => {
    expect(mergeMetrics(null, second)).toBe(second);
    expect(mergeMetrics(first, null)).toBe(first);
    expect(mergeMetrics(null, null)).toBeNull();
  });
});

describe("knowing when tool calls will be guesswork", () => {
  const info = (capabilities: string[]) => ({
    contextLength: 8192,
    capabilities,
    parameterCount: null,
    quantization: null,
  });

  it("says nothing while the model is still being probed", () => {
    expect(needsTextModeTools(null)).toBe(false);
  });

  it("is quiet for a model that calls tools natively", () => {
    expect(needsTextModeTools(info(["completion", "tools"]))).toBe(false);
  });

  it("warns for a completion-only model", () => {
    expect(needsTextModeTools(info(["completion"]))).toBe(true);
  });

  it("warns when the model reports no capabilities at all", () => {
    expect(needsTextModeTools(info([]))).toBe(true);
  });

  it("is not fooled by other capabilities", () => {
    expect(needsTextModeTools(info(["completion", "vision", "thinking"]))).toBe(true);
  });

  it("is quiet for a fully capable model", () => {
    expect(
      needsTextModeTools(info(["completion", "vision", "tools", "thinking"])),
    ).toBe(false);
  });
});

describe("holding a model in memory", () => {
  const MODEL = "sticky:test";

  afterEach(() => {
    forgetContextSize(MODEL);
    forgetModelInfo(MODEL);
  });

  it("grows the window when the conversation needs more room", () => {
    expect(contextSizeFor(MODEL, 100, 131072)).toBe(4096);
    expect(contextSizeFor(MODEL, 200000, 131072)).toBe(65536);
  });

  it("never shrinks it again, because shrinking costs a reload", () => {
    contextSizeFor(MODEL, 200000, 131072);

    expect(contextSizeFor(MODEL, 100, 131072)).toBe(65536);
  });

  it("still respects what the model can actually hold", () => {
    expect(contextSizeFor(MODEL, 500000, 8192)).toBe(8192);
  });

  it("locks to a fixed context window when specified", () => {
    expect(contextSizeFor(MODEL, 100, 131072, 32768)).toBe(32768);
  });

  it("locks to the model maximum when fixedContext is 'max'", () => {
    expect(contextSizeFor(MODEL, 100, 131072, "max")).toBe(131072);
    expect(contextSizeFor(MODEL, 100, null, "max")).toBe(FALLBACK_CONTEXT_LENGTH);
  });

  it("resets and adapts when fixedContext setting changes", () => {
    expect(contextSizeFor(MODEL, 100, 131072, 65536)).toBe(65536);
    expect(contextSizeFor(MODEL, 100, 131072, 8192)).toBe(8192);
    expect(contextSizeFor(MODEL, 100, 131072, "max")).toBe(131072);
    expect(contextSizeFor(MODEL, 100, 131072, null)).toBe(4096);
  });

  it("peekContextSize respects fixed context numbers and 'max'", () => {
    expect(peekContextSize(MODEL, 100, 131072, 16384)).toBe(16384);
    expect(peekContextSize(MODEL, 100, 131072, "max")).toBe(131072);
  });
});
