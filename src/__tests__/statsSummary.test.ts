import { describe, expect, it } from "vitest";
import {
  bucketFor,
  formatDuration,
  percentile,
  sinceFor,
  summarize,
} from "../stats/summary";
import type { MetricRow } from "../types";

/**
 * The numbers on the statistics page. Speed is the one most easily got wrong:
 * averaging each turn's tokens per second lets a ten-token reply count as much
 * as a thousand-token one, so it is measured over all the tokens instead.
 */

const row = (extra: Partial<MetricRow> = {}): MetricRow => ({
  recordedAt: 1000,
  model: "qwen3:8b",
  promptTokens: 1000,
  responseTokens: 100,
  responseMs: 2000,
  firstTokenMs: 500,
  loadMs: 0,
  taskMs: 3000,
  loops: 1,
  tools: {},
  ...extra,
});

describe("summarising", () => {
  it("adds up turns and tokens", () => {
    const summary = summarize([row(), row({ responseTokens: 300, promptTokens: 500 })]);

    expect(summary.turns).toBe(2);
    expect(summary.responseTokens).toBe(400);
    expect(summary.promptTokens).toBe(1500);
  });

  it("measures speed over all the tokens, not as an average of averages", () => {
    // 10 tokens in 1 s (10 tok/s) and 1000 tokens in 10 s (100 tok/s).
    const summary = summarize([
      row({ responseTokens: 10, responseMs: 1000 }),
      row({ responseTokens: 1000, responseMs: 10_000 }),
    ]);

    expect(summary.tokensPerSecond).toBeCloseTo(1010 / 11);
  });

  it("splits speed by model, busiest first", () => {
    const summary = summarize([
      row({ model: "small", responseTokens: 200, responseMs: 1000 }),
      row({ model: "big", responseTokens: 20, responseMs: 1000, firstTokenMs: 2000 }),
      row({ model: "big", responseTokens: 30, responseMs: 1000, firstTokenMs: null }),
    ]);

    expect(summary.models.map((model) => model.model)).toEqual(["big", "small"]);
    expect(summary.models[0]).toMatchObject({ turns: 2, tokensPerSecond: 25, firstTokenMs: 2000 });
    expect(summary.models[1]).toMatchObject({ turns: 1, tokensPerSecond: 200 });
  });

  it("counts tool calls, and in how many turns each tool appeared", () => {
    const summary = summarize([
      row({ tools: { read_file: 3, git_status: 1 } }),
      row({ tools: { read_file: 1 } }),
    ]);

    expect(summary.tools).toEqual([
      { name: "read_file", calls: 4, turns: 2 },
      { name: "git_status", calls: 1, turns: 1 },
    ]);
  });

  it("describes how long tasks take", () => {
    const summary = summarize([1000, 2000, 3000, 4000, 100_000].map((taskMs) => row({ taskMs })));

    expect(summary.tasks).toMatchObject({
      count: 5,
      medianMs: 3000,
      p90Ms: 100_000,
      longestMs: 100_000,
      averageMs: 22_000,
    });
    expect(summary.tasks.buckets).toEqual([
      { id: "under5s", count: 4 },
      { id: "under15s", count: 0 },
      { id: "under1m", count: 0 },
      { id: "under5m", count: 1 },
      { id: "over5m", count: 0 },
    ]);
  });

  it("notes when the recorded period starts and ends", () => {
    const summary = summarize([row({ recordedAt: 50 }), row({ recordedAt: 10 }), row({ recordedAt: 90 })]);

    expect(summary.firstAt).toBe(10);
    expect(summary.lastAt).toBe(90);
  });

  it("copes with nothing recorded", () => {
    const summary = summarize([]);

    expect(summary).toMatchObject({ turns: 0, tokensPerSecond: 0, models: [], tools: [], firstAt: null });
    expect(summary.tasks.medianMs).toBe(0);
  });
});

describe("the pieces", () => {
  it("takes a percentile by nearest rank", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentile([1, 2, 3, 4], 0.9)).toBe(4);
    expect(percentile([], 0.5)).toBe(0);
  });

  it("puts a duration in the right bucket", () => {
    expect(bucketFor(4999)).toBe("under5s");
    expect(bucketFor(5000)).toBe("under15s");
    expect(bucketFor(59_999)).toBe("under1m");
    expect(bucketFor(299_999)).toBe("under5m");
    expect(bucketFor(300_000)).toBe("over5m");
  });

  it("writes durations the way a person reads them", () => {
    expect(formatDuration(850)).toBe("850 ms");
    expect(formatDuration(4200)).toBe("4.2 s");
    expect(formatDuration(60_000)).toBe("1 min");
    expect(formatDuration(72_000)).toBe("1 min 12 s");
    expect(formatDuration(3_780_000)).toBe("1 h 3 min");
  });

  it("works out where a range starts", () => {
    const now = 100 * 24 * 60 * 60 * 1000;

    expect(sinceFor("7d", now)).toBe(93 * 24 * 60 * 60 * 1000);
    expect(sinceFor("30d", now)).toBe(70 * 24 * 60 * 60 * 1000);
    expect(sinceFor("all", now)).toBe(0);
  });
});
