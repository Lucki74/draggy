/** What one request used, in buckets a price can be applied to one by one. The input buckets are disjoint
 * (cache hits are not inside `input`), and `reasoning` is not inside `output`, so the sum of the five is the
 * whole bill with no double counting. Built by the providers in electron/providers/usage.cjs. */

export type UsageSource = "reported" | "derived" | "estimated";

export interface TokenUsage {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  source: UsageSource;
  /** What the provider says it charged, in USD (OpenRouter's `usage.cost`). It wins over any price table. */
  costUsd?: number;
}

const SOURCES: ReadonlySet<string> = new Set(["reported", "derived", "estimated"]);

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;

/** The split from a stream payload, or undefined when the provider sent none (a local engine). */
export function readTokenUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const usage: TokenUsage = {
    input: count(raw.input),
    cacheRead: count(raw.cacheRead),
    cacheWrite: count(raw.cacheWrite),
    output: count(raw.output),
    reasoning: count(raw.reasoning),
    source: typeof raw.source === "string" && SOURCES.has(raw.source) ? (raw.source as UsageSource) : "derived",
  };
  if (typeof raw.costUsd === "number" && Number.isFinite(raw.costUsd) && raw.costUsd >= 0) usage.costUsd = raw.costUsd;
  return usage;
}

/** The prompt side as the context window sees it: everything the model read. */
export const promptOf = (usage: TokenUsage): number => usage.input + usage.cacheRead + usage.cacheWrite;

/** Several requests as one: the buckets add, and the result is only as certain as its least certain part. */
export function sumTokenUsage(parts: readonly TokenUsage[]): TokenUsage {
  const total: TokenUsage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, source: "reported" };
  for (const part of parts) {
    total.input += part.input;
    total.cacheRead += part.cacheRead;
    total.cacheWrite += part.cacheWrite;
    total.output += part.output;
    total.reasoning += part.reasoning;
    if (part.source !== "reported") total.source = part.source === "estimated" || total.source === "estimated" ? "estimated" : "derived";
    if (part.costUsd !== undefined) total.costUsd = (total.costUsd ?? 0) + part.costUsd;
  }
  return total;
}
