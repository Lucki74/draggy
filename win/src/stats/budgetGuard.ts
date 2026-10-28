/** Decides whether a send through `model` may go ahead under the user's budgets. Local models and account logins are
 * never stopped; a billed provider is stopped once a limit that covers it is spent. */

import { parseRef } from "../ai/providers";
import type { BudgetSettings, MetricRow, ProviderInstance } from "../types";
import { budgetMessage, checkBudget, periodStart } from "./budget";
import { costKindOf, formatMoney } from "./cost";

export interface BudgetSources {
  rows: (since: number) => Promise<MetricRow[]>;
  instances: () => Promise<readonly ProviderInstance[]>;
  now: () => number;
  locale?: string;
}

const appSources: BudgetSources = {
  rows: async (since) => (await window.electronAPI?.metrics?.list(since))?.rows ?? [],
  instances: async () => (await window.electronAPI?.providers?.list?.()) ?? [],
  now: () => Date.now(),
};

/** The words to show when the send must stop, or null when it may go ahead. A failed lookup lets the send through:
 * a budget that cannot be read must not lock the user out of their own chat. */
export async function budgetStop(
  model: string,
  budgets: BudgetSettings | undefined,
  sources: BudgetSources = appSources,
): Promise<string | null> {
  if (!budgets?.enabled) return null;
  const ref = parseRef(model);
  if (ref.kind !== "remote") return null;

  const instance = (await sources.instances()).find((item) => item.id === ref.instanceId);
  if (costKindOf(instance?.kind) !== "billed") return null;

  const now = sources.now();
  // The month holds the day, so one read serves both limits.
  const rows = await sources.rows(periodStart(now, "monthly"));
  const status = checkBudget(rows, budgets, ref.instanceId, now);
  if (status.state !== "blocked") return null;
  return budgetMessage(status, (micros) => formatMoney(micros, "USD", { locale: sources.locale }), instance?.label);
}
