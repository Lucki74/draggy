// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MetricsFooter } from "../chat/TurnActions";
import { turnCostLabel } from "../stats/turnCostLabel";
import { translations } from "../translations";
import type { TurnCost, TurnMetrics } from "../types";

afterEach(cleanup);

const t = (key: string) => (translations.en as Record<string, string>)[key] ?? key;

const cost = (extra: Partial<TurnCost> = {}): TurnCost => ({
  providerId: "openai",
  kind: "billed",
  inputTokens: 1200,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 450,
  reasoningTokens: 0,
  costMicros: 10_500,
  costSource: "table",
  priceUpdatedAt: "2026-10-01T00:00:00.000Z",
  ...extra,
});

const metrics = (extra: Partial<TurnMetrics> = {}): TurnMetrics => ({
  model: "@openai/gpt-4o",
  promptTokens: 1200,
  responseTokens: 450,
  promptMs: 300,
  responseMs: 9000,
  totalMs: 9300,
  tokensPerSecond: 42,
  timeToFirstTokenMs: 320,
  contextWindow: 128_000,
  gpuPercent: null,
  loadMs: 0,
  ...extra,
});

describe("the cost of a reply", () => {
  it("shows what an API-key reply cost, next to the tokens it generated", () => {
    render(<MetricsFooter metrics={metrics({ cost: cost() })} t={t} locale="en-US" />);
    expect(screen.getByText("$0.01")).toBeTruthy();
  });

  it("uses four decimals under a cent", () => {
    expect(turnCostLabel(cost({ costMicros: 4_200 }), t, "en-US")?.text).toBe("$0.0042");
  });

  it("marks a figure worked out from totals with a tilde", () => {
    expect(turnCostLabel(cost({ costSource: "estimated" }), t, "en-US")?.text).toBe("~$0.01");
  });

  it("shows an account login as an equivalent value, not a charge", () => {
    const label = turnCostLabel(cost({ kind: "account" }), t, "en-US");
    expect(label?.text).toBe("~$0.01 equiv.");
    expect(label?.title).toContain("Not billed");
  });

  it("shows nothing for a local reply or a price that is unknown", () => {
    expect(turnCostLabel(cost({ kind: "local", costMicros: null }), t)).toBeNull();
    expect(turnCostLabel(cost({ costMicros: null, costSource: "unknown" }), t)).toBeNull();
    expect(turnCostLabel(undefined, t)).toBeNull();
    render(<MetricsFooter metrics={metrics()} t={t} locale="en-US" />);
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it("breaks the tokens down in the hover card, leaving out empty cache and reasoning lines", () => {
    const plain = turnCostLabel(cost(), t, "en-US")?.title ?? "";
    expect(plain).toContain("Input: 1.2k");
    expect(plain).toContain("Output: 450");
    expect(plain).not.toContain("Cache read");
    expect(plain).not.toContain("Reasoning");
    expect(plain).toContain("2026-10-01");

    const full = turnCostLabel(cost({ cacheReadTokens: 5000, cacheWriteTokens: 800, reasoningTokens: 300 }), t, "en-US")?.title ?? "";
    expect(full).toContain("Cache read: 5.0k");
    expect(full).toContain("Cache write: 800");
    expect(full).toContain("Reasoning: 300");
  });

  it("explains an estimate in the hover card", () => {
    expect(turnCostLabel(cost({ costSource: "estimated" }), t, "en-US")?.title).toContain("Estimated");
  });

  it("has every label in every language", () => {
    for (const key of ["costEquivalent", "costNotBilled", "costEstimated", "costInput", "costCacheRead", "costCacheWrite", "costOutput", "costReasoning", "costPricesFrom"]) {
      for (const language of ["en", "fr", "es", "zh"] as const) {
        expect((translations[language] as Record<string, string>)[key], `${language}.${key}`).toBeTruthy();
      }
    }
  });
});
