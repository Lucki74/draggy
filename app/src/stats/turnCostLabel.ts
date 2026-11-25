import type { TurnCost } from "../types";
import { formatMoney } from "./cost";
import { US_DOLLARS, type DisplayMoney } from "./displayMoney";

export interface TurnCostLabel {
  /** The figure shown next to the token count. */
  text: string;
  /** What the hover card says: tokens per bucket and, where it applies, why the figure is not a charge. */
  title: string;
}

const compact = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value));

/**
 * What to show for a reply's cost, or null when there is nothing to say: a local reply costs nothing and a
 * billed reply with no known price has no figure (showing $0 would read as free).
 */
export function turnCostLabel(
  cost: TurnCost | null | undefined,
  t: (key: string) => string,
  locale?: string,
  display: DisplayMoney = US_DOLLARS,
): TurnCostLabel | null {
  if (!cost || cost.costMicros === null || cost.costMicros === undefined) return null;
  if (cost.kind !== "billed" && cost.kind !== "account") return null;

  const account = cost.kind === "account";
  const estimated = cost.costSource === "estimated";
  const money = formatMoney(cost.costMicros, display.currency, { estimated: estimated || account, locale, rate: display.rate });

  const buckets: [string, number | null | undefined][] = [
    ["costInput", cost.inputTokens],
    ["costCacheRead", cost.cacheReadTokens],
    ["costCacheWrite", cost.cacheWriteTokens],
    ["costOutput", cost.outputTokens],
    ["costReasoning", cost.reasoningTokens],
  ];
  const lines = buckets
    .filter(([key, count]) => typeof count === "number" && (count > 0 || key === "costInput" || key === "costOutput"))
    .map(([key, count]) => `${t(key)}: ${compact(count as number)}`);

  if (account) lines.push(t("costNotBilled"));
  if (estimated) lines.push(t("costEstimated"));
  if (cost.priceUpdatedAt) lines.push(`${t("costPricesFrom")} ${cost.priceUpdatedAt.slice(0, 10)}`);

  return { text: account ? `${money} ${t("costEquivalent")}` : money, title: lines.join("\n") };
}
