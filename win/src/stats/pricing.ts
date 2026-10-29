/** Prices a finished turn: who answered, who pays, and what it cost. The pure part (`costFields`) takes its inputs
 * as arguments so the same turn prices the same way under test; `createTurnPricer` adds the lookups. */

import { parseRef } from "../ai/providers";
import { swallowed } from "../logger";
import type { GenerationMetrics } from "../llama";
import type { MetricRow, ProviderInstance, TurnCost } from "../types";
import type { LegacyPrice } from "./costSummary";
import { costKindOf, costOf, costOfPasses, lookupPrice, PRICE_PROVIDER_OF_VENDOR, UNKNOWN_COST, type Cost, type CostKind, type PriceTable } from "./cost";
import { sumTokenUsage, type TokenUsage } from "./tokenUsage";

/** The columns a MetricRow gains once a turn is priced. */
export type CostFields = TurnCost;

/** The account logins and the vendor whose API list prices them. */
const ACCOUNT_VENDOR: Readonly<Record<string, string>> = { chatgpt: "openai", claude: "anthropic", google: "google" };

/** The price-table provider an instance is priced under, or null when the table cannot know it (a custom server). */
export function priceProviderOf(instance: Pick<ProviderInstance, "type" | "kind"> | undefined): string | null {
  if (!instance) return null;
  if (instance.kind === "account") return PRICE_PROVIDER_OF_VENDOR[ACCOUNT_VENDOR[instance.type] ?? ""] ?? null;
  if (instance.kind === "cloud" && instance.type !== "custom") return instance.type;
  return null;
}

/** What a turn used and cost. A built-in or local model is `local` and carries no cost, so it never reads as a bill. */
export function costFields(
  model: string,
  metrics: Pick<GenerationMetrics, "promptTokens" | "responseTokens" | "passUsage">,
  instance: Pick<ProviderInstance, "type" | "kind"> | undefined,
  table: PriceTable | null,
): CostFields {
  const ref = parseRef(model);
  const kind: CostKind = ref.kind === "remote" ? costKindOf(instance?.kind) : "local";
  const providerId = ref.kind === "remote" ? ref.instanceId : null;

  const passes: TokenUsage[] =
    metrics.passUsage && metrics.passUsage.length > 0
      ? metrics.passUsage
      : kind === "local"
        ? []
        : [{ input: metrics.promptTokens, cacheRead: 0, cacheWrite: 0, output: metrics.responseTokens, reasoning: 0, source: "estimated" }];

  const total = passes.length > 0 ? sumTokenUsage(passes) : null;
  const tokens = {
    inputTokens: total?.input ?? null,
    cacheReadTokens: total?.cacheRead ?? null,
    cacheWriteTokens: total?.cacheWrite ?? null,
    outputTokens: total?.output ?? null,
    reasoningTokens: total?.reasoning ?? null,
  };

  // A local engine has nothing to price; the stats page works out "what it would have cost" on its own.
  if (kind === "local") return { providerId, kind, ...tokens, costMicros: null, costSource: null, priceUpdatedAt: null };

  const provider = priceProviderOf(instance);
  const price = provider && ref.kind === "remote" ? lookupPrice(table, provider, ref.modelId) : null;
  const cost: Cost = passes.length > 0 ? costOfPasses(passes, price) : UNKNOWN_COST;
  const estimated = total?.source === "estimated" && cost.source === "table";
  return {
    providerId,
    kind,
    ...tokens,
    costMicros: cost.micros,
    // An estimated token count makes the dollar figure an estimate too; the stats page shows it with a "~".
    costSource: estimated ? "estimated" : cost.source,
    priceUpdatedAt: cost.source === "table" ? (table?.generatedAt ?? null) : null,
  };
}

/** Prices an old row, from before costs were kept, out of its model name and token totals. */
export function legacyPricer(table: PriceTable | null, instances: readonly ProviderInstance[]) {
  return (row: MetricRow): LegacyPrice => {
    const ref = parseRef(row.model);
    const instance = ref.kind === "remote" ? instances.find((item) => item.id === ref.instanceId) : undefined;
    const fields = costFields(row.model, { promptTokens: row.promptTokens, responseTokens: row.responseTokens }, instance, table);
    if (fields.kind === "local") return { kind: "local", providerId: fields.providerId ?? null };
    if (fields.kind !== "billed" && fields.kind !== "account") return null;
    if (fields.costMicros === null || fields.costMicros === undefined) return null;
    return { kind: fields.kind, providerId: fields.providerId ?? null, micros: fields.costMicros };
  };
}

/** The model local replies are priced against to show what they would have cost. */
export interface ReferenceModel {
  provider: string;
  model: string;
}

export const DEFAULT_REFERENCE: ReferenceModel = { provider: "anthropic", model: "claude-sonnet-4-5" };

/** Reads the `provider/model` form Settings stores; anything else falls back to the default reference. */
export function parseReference(value: string | undefined): ReferenceModel {
  const slash = value ? value.indexOf("/") : -1;
  if (!value || slash <= 0 || slash === value.length - 1) return DEFAULT_REFERENCE;
  return { provider: value.slice(0, slash), model: value.slice(slash + 1) };
}

export const formatReference = (reference: ReferenceModel): string => `${reference.provider}/${reference.model}`;

/** What a row's tokens would have cost on the reference model, or null when the table has no price for it. */
export function referencePricer(table: PriceTable | null, reference: ReferenceModel = DEFAULT_REFERENCE) {
  const price = lookupPrice(table, reference.provider, reference.model);
  return (row: MetricRow): number | null => {
    if (!price) return null;
    const cost = costOf(
      {
        input: row.inputTokens ?? row.promptTokens,
        cacheRead: row.cacheReadTokens ?? 0,
        cacheWrite: row.cacheWriteTokens ?? 0,
        output: row.outputTokens ?? row.responseTokens,
        reasoning: row.reasoningTokens ?? 0,
        source: "estimated",
      },
      price,
    );
    return cost.micros;
  };
}

export interface PricerSources {
  table: () => Promise<PriceTable | null>;
  instances: () => Promise<readonly ProviderInstance[]>;
}

/** Looks the table and the provider list up once and keeps them; both change rarely and a turn must not wait on a disk. */
export function createTurnPricer(sources: PricerSources) {
  let table: Promise<PriceTable | null> | null = null;
  let instances: Promise<readonly ProviderInstance[]> | null = null;
  return {
    async price(model: string, metrics: Parameters<typeof costFields>[1]): Promise<CostFields> {
      const ref = parseRef(model);
      table ??= sources.table().catch(swallowed("chat", "the turn is kept without a price", null));
      instances ??= sources.instances().catch(() => []);
      const [loadedTable, list] = await Promise.all([table, instances]);
      const instance = ref.kind === "remote" ? list.find((item) => item.id === ref.instanceId) : undefined;
      return costFields(model, metrics, instance, loadedTable);
    },
    /** Forget the lookups, after the table is refreshed or a provider is added. */
    reset() {
      table = null;
      instances = null;
    },
  };
}

/** The pricer wired to the app's own bridges. */
export const turnPricer = createTurnPricer({
  table: async () => {
    const answer = await window.electronAPI?.pricing?.table();
    return answer?.success ? (answer.table ?? null) : null;
  },
  instances: async () => (await window.electronAPI?.providers?.list?.()) ?? [],
});
