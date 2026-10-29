import type { MetricRow } from "../types";

/** What the stored turns cost, as arithmetic. Pure, so the statistics page only lays the numbers out.
 *
 * Three different amounts are kept apart on purpose: `spent` is what API keys were billed, `account` is what
 * plan-covered replies would have cost through the API (never billed, never counted against a budget), and
 * `saved` is what local replies would have cost on a reference model. */

/** A turn priced after the fact, from its model name. Always an estimate. */
export type LegacyPrice =
  | { kind: "billed" | "account"; providerId: string | null; micros: number }
  | { kind: "local"; providerId: string | null }
  | null;

export interface CostSummaryOptions {
  /** Prices a row recorded before costs were kept. Left out, such rows count as unpriced. */
  priceLegacy?: (row: MetricRow) => LegacyPrice;
  /** What a local row's tokens would have cost on the reference model, or null when that is unknown. */
  priceReference?: (row: MetricRow) => number | null;
}

export interface CostBucket {
  key: string;
  turns: number;
  spentMicros: number;
  accountMicros: number;
  /** True when part of the figure was worked out from a model name instead of recorded. */
  estimated: boolean;
}

export interface CostDay {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
  spentMicros: number;
  accountMicros: number;
}

export interface CostSummary {
  spentMicros: number;
  accountMicros: number;
  savedMicros: number;
  /** Turns billed or on an account with no known price: left out of the sums above, never counted as free. */
  unpricedTurns: number;
  /** Turns that were billed or on an account, priced or not. */
  paidTurns: number;
  /** Part of `spentMicros` or `accountMicros` is an estimate. */
  estimated: boolean;
  byProvider: CostBucket[];
  byModel: CostBucket[];
  byWorkspace: CostBucket[];
  daily: CostDay[];
}

/** Local calendar day of a timestamp. */
export function dayOf(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Every day from the first to the last, so a quiet day shows as a zero instead of a gap. */
export function fillDays(days: CostDay[], from: number, to: number): CostDay[] {
  const byDay = new Map(days.map((entry) => [entry.day, entry]));
  const out: CostDay[] = [];
  const cursor = new Date(from);
  cursor.setHours(12, 0, 0, 0);
  const end = new Date(to);
  end.setHours(12, 0, 0, 0);
  while (cursor <= end) {
    const day = dayOf(cursor.getTime());
    out.push(byDay.get(day) ?? { day, spentMicros: 0, accountMicros: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

const bySize = (a: CostBucket, b: CostBucket) =>
  b.spentMicros + b.accountMicros - (a.spentMicros + a.accountMicros) || b.turns - a.turns || a.key.localeCompare(b.key);

function add(map: Map<string, CostBucket>, key: string, kind: "billed" | "account", micros: number, estimated: boolean) {
  const bucket = map.get(key) ?? { key, turns: 0, spentMicros: 0, accountMicros: 0, estimated: false };
  bucket.turns += 1;
  if (kind === "billed") bucket.spentMicros += micros;
  else bucket.accountMicros += micros;
  bucket.estimated ||= estimated;
  map.set(key, bucket);
}

export function summarizeCost(rows: MetricRow[], options: CostSummaryOptions = {}): CostSummary {
  const providers = new Map<string, CostBucket>();
  const models = new Map<string, CostBucket>();
  const workspaces = new Map<string, CostBucket>();
  const days = new Map<string, CostDay>();

  let spentMicros = 0;
  let accountMicros = 0;
  let savedMicros = 0;
  let unpricedTurns = 0;
  let paidTurns = 0;
  let estimated = false;

  for (const row of rows) {
    let kind: "billed" | "account" | "local" | null = row.kind ?? null;
    let micros: number | null = row.costMicros ?? null;
    let providerId: string | null = row.providerId ?? null;
    let guessed = row.costSource === "estimated";

    if (kind === null) {
      const legacy = options.priceLegacy?.(row) ?? null;
      if (legacy) {
        kind = legacy.kind;
        providerId = legacy.providerId;
        micros = legacy.kind === "local" ? null : legacy.micros;
        guessed = true;
      }
    }

    if (kind === "local") {
      const saved = options.priceReference?.(row) ?? null;
      if (saved !== null) savedMicros += saved;
      continue;
    }

    // A row nobody could price (an old row of an unknown model, a custom server) is counted, not guessed at.
    if (kind === null) {
      unpricedTurns += 1;
      continue;
    }

    paidTurns += 1;
    if (micros === null) {
      unpricedTurns += 1;
      continue;
    }

    if (kind === "billed") spentMicros += micros;
    else accountMicros += micros;
    estimated ||= guessed;

    add(providers, providerId ?? "—", kind, micros, guessed);
    add(models, row.model, kind, micros, guessed);
    add(workspaces, row.workspaceId || "default", kind, micros, guessed);

    const day = dayOf(row.recordedAt);
    const entry = days.get(day) ?? { day, spentMicros: 0, accountMicros: 0 };
    if (kind === "billed") entry.spentMicros += micros;
    else entry.accountMicros += micros;
    days.set(day, entry);
  }

  return {
    spentMicros,
    accountMicros,
    savedMicros,
    unpricedTurns,
    paidTurns,
    estimated,
    byProvider: [...providers.values()].sort(bySize),
    byModel: [...models.values()].sort(bySize),
    byWorkspace: [...workspaces.values()].sort(bySize),
    daily: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
  };
}
