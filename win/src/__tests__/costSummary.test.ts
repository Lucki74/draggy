import { describe, expect, it } from "vitest";
import { dayOf, fillDays, summarizeCost } from "../stats/costSummary";
import type { MetricRow } from "../types";

const at = (year: number, month: number, day: number, hour = 12) => new Date(year, month - 1, day, hour).getTime();

const row = (extra: Partial<MetricRow> = {}): MetricRow => ({
  recordedAt: at(2026, 10, 20),
  workspaceId: "w1",
  chatId: "c1",
  model: "@openai/gpt-4o",
  promptTokens: 1000,
  responseTokens: 500,
  responseMs: 5000,
  firstTokenMs: 300,
  loadMs: 0,
  taskMs: 6000,
  loops: 1,
  tools: {},
  providerId: "openai",
  kind: "billed",
  costMicros: 7500,
  costSource: "table",
  ...extra,
});

describe("what the stored turns cost", () => {
  it("adds billed turns to spent and keeps account value apart", () => {
    const summary = summarizeCost([
      row(),
      row({ costMicros: 2500 }),
      row({ kind: "account", providerId: "claude", model: "@claude/claude-sonnet-4-5", costMicros: 9000 }),
    ]);
    expect(summary.spentMicros).toBe(10_000);
    expect(summary.accountMicros).toBe(9000);
    expect(summary.paidTurns).toBe(3);
    expect(summary.estimated).toBe(false);
  });

  it("counts a turn with no price as unpriced, never as free", () => {
    const summary = summarizeCost([row({ costMicros: null, costSource: "unknown" }), row()]);
    expect(summary.spentMicros).toBe(7500);
    expect(summary.unpricedTurns).toBe(1);
    expect(summary.paidTurns).toBe(2);
  });

  it("leaves local turns out of spent and prices them on the reference model as saved", () => {
    const summary = summarizeCost([row({ kind: "local", costMicros: null, providerId: null, model: "qwen3.gguf" })], {
      priceReference: (turn) => turn.promptTokens * 3 + turn.responseTokens * 15,
    });
    expect(summary.spentMicros).toBe(0);
    expect(summary.savedMicros).toBe(10_500);
    expect(summary.paidTurns).toBe(0);
  });

  it("prices rows from before costs were kept, flagged as an estimate", () => {
    const old = row({ kind: undefined, costMicros: undefined, costSource: undefined, providerId: undefined });
    const summary = summarizeCost([old], {
      priceLegacy: () => ({ kind: "billed", providerId: "openai", micros: 4000 }),
    });
    expect(summary.spentMicros).toBe(4000);
    expect(summary.estimated).toBe(true);
    expect(summary.byProvider[0]).toMatchObject({ key: "openai", estimated: true });
  });

  it("treats an old row nobody can price as unpriced", () => {
    const old = row({ kind: undefined, costMicros: undefined, costSource: undefined });
    expect(summarizeCost([old]).unpricedTurns).toBe(1);
    expect(summarizeCost([old], { priceLegacy: () => null }).unpricedTurns).toBe(1);
  });

  it("flags a total built from estimated token counts", () => {
    expect(summarizeCost([row({ costSource: "estimated" })]).estimated).toBe(true);
  });

  it("groups by provider, model and workspace, biggest first", () => {
    const summary = summarizeCost([
      row({ workspaceId: "w1", costMicros: 1000 }),
      row({ workspaceId: "w2", costMicros: 5000, model: "@openai/gpt-5" }),
      row({ workspaceId: "w2", costMicros: 2000, model: "@openai/gpt-5" }),
    ]);
    expect(summary.byWorkspace.map((entry) => [entry.key, entry.spentMicros])).toEqual([
      ["w2", 7000],
      ["w1", 1000],
    ]);
    expect(summary.byModel[0]).toMatchObject({ key: "@openai/gpt-5", turns: 2, spentMicros: 7000 });
    expect(summary.byProvider).toHaveLength(1);
  });

  it("adds up per local day, oldest first", () => {
    const summary = summarizeCost([
      row({ recordedAt: at(2026, 10, 21), costMicros: 3000 }),
      row({ recordedAt: at(2026, 10, 20, 8), costMicros: 1000 }),
      row({ recordedAt: at(2026, 10, 20, 23), costMicros: 2000, kind: "account" }),
    ]);
    expect(summary.daily).toEqual([
      { day: "2026-10-20", spentMicros: 1000, accountMicros: 2000 },
      { day: "2026-10-21", spentMicros: 3000, accountMicros: 0 },
    ]);
  });

  it("is all zero for no rows", () => {
    expect(summarizeCost([])).toMatchObject({ spentMicros: 0, accountMicros: 0, savedMicros: 0, paidTurns: 0, daily: [] });
  });
});

describe("days", () => {
  it("names a local calendar day", () => {
    expect(dayOf(at(2026, 1, 5))).toBe("2026-01-05");
  });

  it("fills quiet days with zeros", () => {
    const filled = fillDays([{ day: "2026-10-20", spentMicros: 5, accountMicros: 0 }], at(2026, 10, 19), at(2026, 10, 22));
    expect(filled.map((entry) => entry.day)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"]);
    expect(filled[1].spentMicros).toBe(5);
    expect(filled[2].spentMicros).toBe(0);
  });
});
