import { fill } from "../onboarding/text";
import type { AccountLimit, AccountStatus } from "../types";

type Translate = (key: string) => string;

/** "5 h", "week": the vendor's usage window in the reader's own units. */
function windowLabel(minutes: number | null, t: Translate): string | null {
  if (!minutes) return null;
  if (minutes === 7 * 24 * 60) return t("usageWeek");
  if (minutes % (24 * 60) === 0) return fill(t("usageDays"), { count: String(minutes / (24 * 60)) });
  return fill(t("usageHours"), { count: String(Math.round(minutes / 60)) });
}

export function accountSubtitle(status: AccountStatus | null, t: Translate): string {
  if (!status?.signedIn) return t("notSignedIn");
  const limits = (status.limits ?? []).map((limit: AccountLimit) =>
    [windowLabel(limit.window, t), `${Math.round(limit.usedPercent)}%`].filter(Boolean).join(" "),
  );
  const plan = status.plan ? status.plan[0].toUpperCase() + status.plan.slice(1) : null;
  const parts = [plan, ...limits].filter(Boolean);
  return parts.length ? parts.join(" · ") : t("signedIn");
}
