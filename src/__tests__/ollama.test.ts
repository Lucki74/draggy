import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTEXT_BUCKETS,
  FALLBACK_CONTEXT_LENGTH,
  PULL_PHASE_KEYS,
  contextSizeFor,
  createPullTracker,
  describeContextUse,
  forgetContextSize,
  forgetModelInfo,
  getModelInfo,
  isCloudModel,
  mergeMetrics,
  needsTextModeTools,
  pickContextSize,
  pullModel,
  readMetrics,
  warmModel,
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

describe("the context meter", () => {
  const base = { measuredTokens: null, draftChars: 0, historyChars: 0, maxContext: 131072 };

  it("falls back to a character estimate before the first reply", () => {
    const use = describeContextUse({ ...base, historyChars: 4000 });

    expect(use.measured).toBe(false);
    expect(use.usedTokens).toBe(1000);
  });

  it("prefers Ollama's real token count once a reply has arrived", () => {
    const use = describeContextUse({ ...base, measuredTokens: 1807, historyChars: 999999 });

    expect(use.measured).toBe(true);
    expect(use.usedTokens).toBe(1807);
  });

  it("adds the unsent draft on top of the measured count", () => {
    const use = describeContextUse({ ...base, measuredTokens: 1000, draftChars: 400 });
    expect(use.usedTokens).toBe(1100);
  });

  it("measures against the model's full context, not the per-turn window", () => {
    const use = describeContextUse({ ...base, measuredTokens: 1807 });

    expect(use.windowTokens).toBe(131072);
    expect(use.percent).toBeLessThan(2);
  });

  it("uses the same real token count the metrics footer reports", () => {
    // The footer reported 1780 prompt + 27 response for this turn.
    const use = describeContextUse({ ...base, measuredTokens: 1780 + 27 });
    expect(use.usedTokens).toBe(1807);
  });

  it("reports the ceiling of whichever model is loaded", () => {
    expect(describeContextUse({ ...base, maxContext: 8192 }).windowTokens).toBe(8192);
    expect(describeContextUse({ ...base, maxContext: 262144 }).windowTokens).toBe(262144);
  });

  it("does not change the ceiling as the conversation grows", () => {
    const windows = [500, 3000, 40000, 120000].map(
      (tokens) => describeContextUse({ ...base, measuredTokens: tokens }).windowTokens,
    );

    expect(new Set(windows).size).toBe(1);
  });

  it("rises towards a hundred percent as the chat fills the model", () => {
    const quarter = describeContextUse({ ...base, measuredTokens: 32768 });
    const half = describeContextUse({ ...base, measuredTokens: 65536 });

    expect(Math.round(quarter.percent)).toBe(25);
    expect(Math.round(half.percent)).toBe(50);
  });

  it("can exceed a hundred percent when the chat outgrows the model", () => {
    const use = describeContextUse({ ...base, measuredTokens: 9000, maxContext: 8192 });
    expect(use.percent).toBeGreaterThan(100);
  });

  it("handles an empty chat without dividing by zero", () => {
    const use = describeContextUse(base);

    expect(use.usedTokens).toBe(0);
    expect(Number.isFinite(use.percent)).toBe(true);
  });

  it("treats a zero measurement as not yet measured", () => {
    const use = describeContextUse({ ...base, measuredTokens: 0, historyChars: 800 });

    expect(use.measured).toBe(false);
    expect(use.usedTokens).toBe(200);
  });

  it("falls back to a known ceiling when the model reports no context length", () => {
    const use = describeContextUse({ ...base, measuredTokens: 100, maxContext: null });
    expect(use.windowTokens).toBe(FALLBACK_CONTEXT_LENGTH);
  });
});
/**
 * Copied from a real `POST /api/pull` against Ollama 0.33.1. Nothing in the
 * stream says "downloading", which the startup screen used to wait for.
 */
const BLOB = "sha256:a3de86cd1c1354b0e7d2ce1e4a1e6f0e0d0c0b0a09080706050403020100ffee";
const CONFIG = "sha256:966de95ca8a62200913e3f8bfbf84c8494536f1b94b49166851e766445e96639";

describe("following a model download", () => {
  it("reports progress even though Ollama never says the word downloading", () => {
    const track = createPullTracker();

    track({ status: "pulling manifest" });
    const progress = track({
      status: "pulling a3de86cd1c13",
      digest: BLOB,
      total: 1000,
      completed: 250,
    });

    expect(progress.phase).toBe("downloading");
    expect(progress.percent).toBeCloseTo(25);
    expect(progress.total).toBe(1000);
  });

  it("never offers a digest as something to show a person", () => {
    const track = createPullTracker();
    const progress = track({
      status: "pulling a3de86cd1c13",
      digest: BLOB,
      total: 1000,
      completed: 1,
    });

    expect(PULL_PHASE_KEYS[progress.phase]).toBe("downloadingModel");
    expect(PULL_PHASE_KEYS[progress.phase]).not.toContain("a3de86cd1c13");
  });

  it("measures the whole model, not whichever layer is in flight", () => {
    const track = createPullTracker();

    track({ status: "pulling manifest" });
    track({ status: "pulling a3de", digest: BLOB, total: 1000, completed: 1000 });

    // A second layer starting from nothing must not throw the figure away:
    // per-layer arithmetic would report 0 percent of a finished download.
    const progress = track({
      status: "pulling 966de",
      digest: CONFIG,
      total: 1000,
      completed: 0,
    });

    expect(progress.completed).toBe(1000);
    expect(progress.total).toBe(2000);
    expect(progress.percent).toBeCloseTo(50);
  });

  it("counts a layer once, however many times it is reported", () => {
    const track = createPullTracker();

    track({ status: "pulling a3de", digest: BLOB, total: 1000, completed: 100 });
    track({ status: "pulling a3de", digest: BLOB, total: 1000, completed: 500 });
    const progress = track({
      status: "pulling a3de",
      digest: BLOB,
      total: 1000,
      completed: 900,
    });

    expect(progress.total).toBe(1000);
    expect(progress.completed).toBe(900);
  });

  it("holds its figures when Ollama stops reporting bytes", () => {
    const track = createPullTracker();

    track({ status: "pulling a3de", digest: BLOB, total: 1000, completed: 1000 });
    const verifying = track({ status: "verifying sha256 digest" });

    // Zeroing here is what dropped the bar back to "waiting" at the very end.
    expect(verifying.phase).toBe("verifying");
    expect(verifying.percent).toBeCloseTo(100);
    expect(verifying.total).toBe(1000);

    const writing = track({ status: "writing manifest" });
    expect(writing.total).toBe(1000);
    expect(writing.percent).toBeCloseTo(100);
  });

  it("finishes at a hundred", () => {
    const track = createPullTracker();

    track({ status: "pulling a3de", digest: BLOB, total: 1000, completed: 400 });
    const done = track({ status: "success" });

    expect(done.phase).toBe("done");
    expect(done.percent).toBe(100);
    expect(done.completed).toBe(done.total);
  });

  it("does not walk backwards when a report arrives out of order", () => {
    const track = createPullTracker();

    track({ status: "pulling a3de", digest: BLOB, total: 1000, completed: 800 });
    const late = track({
      status: "pulling a3de",
      digest: BLOB,
      total: 1000,
      completed: 200,
    });

    expect(late.percent).toBeCloseTo(80);
  });

  it("does move back when a newly announced layer makes the job bigger", () => {
    const track = createPullTracker();

    track({ status: "pulling 966de", digest: CONFIG, total: 100, completed: 100 });
    const bigger = track({ status: "pulling a3de", digest: BLOB, total: 900, completed: 0 });

    // Pretending to be finished would be the lie; the work really did grow.
    expect(bigger.percent).toBeCloseTo(10);
  });

  it("keeps calm about wording it has never seen", () => {
    const track = createPullTracker();

    track({ status: "pulling a3de", digest: BLOB, total: 1000, completed: 500 });
    const odd = track({ status: "reticulating splines" });

    expect(odd.phase).toBe("downloading");
    expect(odd.percent).toBeCloseTo(50);
  });

  it("starts out preparing rather than claiming to download", () => {
    const track = createPullTracker();
    const first = track({ status: "pulling manifest" });

    expect(first.phase).toBe("preparing");
    expect(first.total).toBe(0);
  });
});

describe("reporting a download to the screen", () => {
  const stream = (lines: Record<string, unknown>[]) => {
    const body = lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
    const encoded = new TextEncoder().encode(body);
    let sent = false;

    return {
      ok: true,
      body: {
        getReader: () => ({
          read: async () =>
            sent
              ? { done: true, value: undefined }
              : ((sent = true), { done: false, value: encoded }),
        }),
      },
    };
  };

  it("lets every change of phase through, however fast they arrive", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      stream([
        { status: "pulling manifest" },
        { status: "pulling a3de", digest: BLOB, total: 1000, completed: 1000 },
        { status: "verifying sha256 digest" },
        { status: "writing manifest" },
        { status: "success" },
      ])) as unknown as typeof fetch;

    try {
      const seen: string[] = [];
      await pullModel("qwen3:8b", (progress) => seen.push(progress.phase));

      // These all land inside one throttle window, and dropping them leaves
      // the screen saying "downloading" long after the bytes are in.
      expect(seen).toContain("downloading");
      expect(seen).toContain("verifying");
      expect(seen).toContain("done");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("raises what Ollama reports as an error", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      stream([
        { status: "pulling manifest" },
        { error: "model \"nope\" not found" },
      ])) as unknown as typeof fetch;

    try {
      await expect(pullModel("nope", () => {})).rejects.toThrow(/not found/);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("asking a model what it can do", () => {
  const shown = (capabilities: string[]) =>
    new Response(JSON.stringify({ capabilities }), { status: 200 });

  afterEach(() => {
    vi.unstubAllGlobals();
    forgetModelInfo("probe:deadline");
    forgetModelInfo("probe:failure");
  });

  it("gives the request a deadline, so one hung model cannot stall the list", async () => {
    let sent: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        sent = init;
        return shown(["completion"]);
      }),
    );

    await getModelInfo("probe:deadline");

    expect(sent?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports nothing when the request times out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }),
    );

    expect(await getModelInfo("probe:failure")).toBeNull();
  });

  it("does not remember a timeout, so the next look can still succeed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }),
    );
    await getModelInfo("probe:failure");

    vi.stubGlobal("fetch", vi.fn(async () => shown(["embedding"])));
    const info = await getModelInfo("probe:failure");

    expect(info?.capabilities).toEqual(["embedding"]);
  });
});

describe("holding a model in memory", () => {
  const MODEL = "sticky:test";

  const stubShow = () =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/api/show")) {
          return new Response(
            JSON.stringify({
              capabilities: ["completion"],
              model_info: { "test.context_length": 32768 },
              details: { parameter_size: "8B", quantization_level: "Q4_K_M" },
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 200 });
      }),
    );

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

  it("forgets a model, so a reinstalled one starts over", () => {
    contextSizeFor(MODEL, 200000, 131072);
    forgetContextSize(MODEL);

    expect(contextSizeFor(MODEL, 100, 131072)).toBe(4096);
  });

  it("warms the model at the size the turn will ask for", async () => {
    stubShow();

    await warmModel(MODEL, "30m", 100000);

    const sent = vi.mocked(fetch).mock.calls.find(([url]) =>
      String(url).endsWith("/api/chat"),
    );
    const body = JSON.parse(String((sent?.[1] as RequestInit).body));

    // The window the warm-up picked is the one the next turn is handed, so the
    // weights are loaded once rather than loaded and then loaded again.
    expect(body.options.num_ctx).toBe(contextSizeFor(MODEL, 100000, 32768));
    expect(body.keep_alive).toBe("30m");
  });

  it("leaves room for the system prompt the turn will carry", async () => {
    stubShow();

    // Fits the smaller bucket alone, but not once the prompt is counted.
    // Warming to the smaller one hands the turn a window it must grow.
    expect(pickContextSize(8000, 32768)).toBe(4096);

    await warmModel(MODEL, "30m", 8000);

    const sent = vi.mocked(fetch).mock.calls.find(([url]) =>
      String(url).endsWith("/api/chat"),
    );
    const body = JSON.parse(String((sent?.[1] as RequestInit).body));

    expect(body.options.num_ctx).toBe(8192);
  });
});
