import { describe, expect, it } from "vitest";
import { budgetMessage, checkBudget, periodStart, spendSince, BUDGET_ERROR_PREFIX } from "../stats/budget";
import { budgetStop, type BudgetSources } from "../stats/budgetGuard";
import { classifyTurnError } from "../agent/turnHistory";
import type { BudgetSettings, MetricRow, ProviderInstance } from "../types";

const at = (month: number, day: number, hour = 12) => new Date(2026, month, day, hour).getTime();
const NOW = at(9, 20);

const row = (extra: Partial<MetricRow> = {}): MetricRow => ({
  recordedAt: at(9, 20, 9),
  workspaceId: "w1",
  chatId: "c1",
  model: "@openai/gpt-4o",
  promptTokens: 1,
  responseTokens: 1,
  responseMs: 1,
  firstTokenMs: 1,
  loadMs: 0,
  taskMs: 1,
  loops: 1,
  tools: {},
  providerId: "openai",
  kind: "billed",
  costMicros: 1_000_000,
  costSource: "table",
  ...extra,
});

const budgets = (extra: Partial<BudgetSettings> = {}): BudgetSettings => ({
  enabled: true,
  global: { dailyMicros: 10_000_000, monthlyMicros: null },
  providers: {},
  ...extra,
});

describe("budget periods", () => {
  it("starts the day and the month at local midnight", () => {
    expect(periodStart(NOW, "daily")).toBe(at(9, 20, 0));
    expect(periodStart(NOW, "monthly")).toBe(at(9, 1, 0));
  });
});

describe("spendSince", () => {
  it("counts only billed rows with a known cost inside the window", () => {
    const rows = [
      row(),
      row({ kind: "account", costMicros: 5_000_000 }),
      row({ kind: "local", costMicros: null }),
      row({ costMicros: null }),
      row({ recordedAt: at(9, 19) }),
    ];
    expect(spendSince(rows, at(9, 20, 0))).toBe(1_000_000);
    expect(spendSince(rows, at(9, 1, 0))).toBe(2_000_000);
  });

  it("narrows to one provider", () => {
    const rows = [row(), row({ providerId: "anthropic", costMicros: 3_000_000 })];
    expect(spendSince(rows, 0, "anthropic")).toBe(3_000_000);
  });
});

describe("checkBudget", () => {
  it("is clear when budgets are off or unset", () => {
    expect(checkBudget([row()], undefined, "openai", NOW).state).toBe("ok");
    expect(checkBudget([row()], budgets({ enabled: false }), "openai", NOW).state).toBe("ok");
    expect(checkBudget([row()], budgets({ global: { dailyMicros: null, monthlyMicros: null } }), "openai", NOW).state).toBe("ok");
  });

  it("warns at 80 percent and blocks at the whole limit", () => {
    expect(checkBudget([row({ costMicros: 7_900_000 })], budgets(), "openai", NOW).state).toBe("ok");
    expect(checkBudget([row({ costMicros: 8_000_000 })], budgets(), "openai", NOW).state).toBe("warn");
    const blocked = checkBudget([row({ costMicros: 10_000_000 })], budgets(), "openai", NOW);
    expect(blocked).toMatchObject({ state: "blocked", scope: "global", period: "daily", spentMicros: 10_000_000, limitMicros: 10_000_000 });
  });

  it("lets a monthly limit block while the day is quiet", () => {
    const setting = budgets({ global: { dailyMicros: null, monthlyMicros: 5_000_000 } });
    const rows = [row({ recordedAt: at(9, 2), costMicros: 5_000_000 })];
    expect(checkBudget(rows, setting, "openai", NOW)).toMatchObject({ state: "blocked", period: "monthly" });
  });

  it("applies a provider limit only to that provider and picks the tightest", () => {
    const setting = budgets({ providers: { anthropic: { dailyMicros: 2_000_000, monthlyMicros: null } } });
    const rows = [row({ providerId: "anthropic", costMicros: 2_000_000 })];
    expect(checkBudget(rows, setting, "anthropic", NOW)).toMatchObject({ state: "blocked", scope: "provider" });
    expect(checkBudget(rows, setting, "openai", NOW).state).toBe("ok");
  });

  it("ignores a zero or negative limit", () => {
    const setting = budgets({ global: { dailyMicros: 0, monthlyMicros: -1 } });
    expect(checkBudget([row()], setting, "openai", NOW).state).toBe("ok");
  });
});

describe("the stop message", () => {
  it("is classified as a budget failure", () => {
    const status = checkBudget([row({ costMicros: 10_000_000 })], budgets(), "openai", NOW);
    const text = budgetMessage(status, (micros) => `$${micros / 1e6}`);
    expect(text).toBe("Budget reached: $10 of $10 daily limit spent.");
    expect(classifyTurnError(text)).toBe("budget");
    expect(text.startsWith(BUDGET_ERROR_PREFIX)).toBe(true);
  });
});

describe("budgetStop", () => {
  const instance = (id: string, kind: ProviderInstance["kind"]) => ({ id, kind, type: id, label: id.toUpperCase() }) as ProviderInstance;
  const sources = (rows: MetricRow[], instances: ProviderInstance[]): BudgetSources => ({
    rows: async () => rows,
    instances: async () => instances,
    now: () => NOW,
    locale: "en-US",
  });
  const spent = [row({ costMicros: 10_000_000 })];

  it("stops a billed cloud send once the limit is spent", async () => {
    const text = await budgetStop("@openai/gpt-4o", budgets(), sources(spent, [instance("openai", "cloud")]));
    expect(text).toBe("Budget reached: $10.00 of $10.00 daily limit spent.");
  });

  it("never stops a local model or an account login", async () => {
    expect(await budgetStop("llama-3", budgets(), sources(spent, []))).toBeNull();
    expect(await budgetStop("@claude/opus", budgets(), sources(spent, [instance("claude", "account")]))).toBeNull();
  });

  it("lets a send through while under the limit or with budgets off", async () => {
    expect(await budgetStop("@openai/gpt-4o", budgets(), sources([row()], [instance("openai", "cloud")]))).toBeNull();
    expect(await budgetStop("@openai/gpt-4o", budgets({ enabled: false }), sources(spent, [instance("openai", "cloud")]))).toBeNull();
  });
});
