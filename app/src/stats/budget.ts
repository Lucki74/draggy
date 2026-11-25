/** Spending limits. Pure: the rows and the clock come in as arguments, so the same history gives the same verdict
 * under test. Only billed replies count; plan-covered (account) and local replies never spend against a budget. */

import type { BudgetLimits, BudgetSettings, MetricRow } from "../types";

/** A budget turns to a warning at this share of its limit and blocks new cloud sends at the whole of it. */
export const BUDGET_WARN_RATIO = 0.8;

/** Shown to the user and classified by `classifyTurnError`; keep the two in step. */
export const BUDGET_ERROR_PREFIX = "Budget reached";

export type BudgetPeriod = "daily" | "monthly";
export type BudgetScope = "global" | "provider";
export type BudgetState = "ok" | "warn" | "blocked";

export const NO_LIMITS: BudgetLimits = { dailyMicros: null, monthlyMicros: null };

export const DEFAULT_BUDGETS: BudgetSettings = { enabled: false, global: NO_LIMITS, providers: {} };

/** Start of the local day or month containing `now`. */
export function periodStart(now: number, period: BudgetPeriod): number {
  const date = new Date(now);
  return period === "daily"
    ? new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    : new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

/** Billed micro-dollars since `since`, for one provider or all of them. */
export function spendSince(rows: readonly MetricRow[], since: number, providerId?: string): number {
  let total = 0;
  for (const row of rows) {
    if (row.kind !== "billed" || row.recordedAt < since) continue;
    if (typeof row.costMicros !== "number") continue;
    if (providerId !== undefined && row.providerId !== providerId) continue;
    total += row.costMicros;
  }
  return total;
}

export interface BudgetStatus {
  state: BudgetState;
  scope: BudgetScope | null;
  period: BudgetPeriod | null;
  spentMicros: number;
  limitMicros: number;
  /** spent / limit of the limit that decided the state; 0 when nothing is limited. */
  ratio: number;
}

const CLEAR: BudgetStatus = { state: "ok", scope: null, period: null, spentMicros: 0, limitMicros: 0, ratio: 0 };

/** The tightest limit that applies to a send through `providerId`: the highest share used wins, so a provider cap
 * about to run out outranks a global one with room left. */
export function checkBudget(
  rows: readonly MetricRow[],
  budgets: BudgetSettings | undefined,
  providerId: string | null,
  now: number,
): BudgetStatus {
  if (!budgets?.enabled) return CLEAR;

  const candidates: { scope: BudgetScope; limits: BudgetLimits; provider?: string }[] = [{ scope: "global", limits: budgets.global ?? NO_LIMITS }];
  const own = providerId ? budgets.providers?.[providerId] : undefined;
  if (own && providerId) candidates.push({ scope: "provider", limits: own, provider: providerId });

  let worst: BudgetStatus = CLEAR;
  for (const { scope, limits, provider } of candidates) {
    for (const period of ["daily", "monthly"] as const) {
      const limit = period === "daily" ? limits.dailyMicros : limits.monthlyMicros;
      if (typeof limit !== "number" || limit <= 0) continue;
      const spent = spendSince(rows, periodStart(now, period), provider);
      const ratio = spent / limit;
      if (ratio > worst.ratio || worst.scope === null) {
        const state: BudgetState = ratio >= 1 ? "blocked" : ratio >= BUDGET_WARN_RATIO ? "warn" : "ok";
        worst = { state, scope, period, spentMicros: spent, limitMicros: limit, ratio };
      }
    }
  }
  return worst;
}

/** The reason a send was stopped, in words the failed reply can show. */
export function budgetMessage(status: BudgetStatus, money: (micros: number) => string, providerLabel?: string): string {
  const where = status.scope === "provider" && providerLabel ? ` for ${providerLabel}` : "";
  return `${BUDGET_ERROR_PREFIX}${where}: ${money(status.spentMicros)} of ${money(status.limitMicros)} ${status.period} limit spent.`;
}
