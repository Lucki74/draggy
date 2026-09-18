import type { MetricRow } from "../types";

/** The statistics as arithmetic, worked out here from stored rows so the page only lays numbers out
 * and this is where they are tested. */

export type StatsRange = "7d" | "30d" | "all";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The earliest time a range covers. */
export function sinceFor(range: StatsRange, now = Date.now()): number {
  if (range === "7d") return now - 7 * DAY_MS;
  if (range === "30d") return now - 30 * DAY_MS;
  return 0;
}

export interface ModelStats {
  model: string;
  turns: number;
  /** Generated tokens over generating time, so a long reply weighs more than a short one. */
  tokensPerSecond: number;
  /** Mean time to the first token, over the turns that reported one. */
  firstTokenMs: number | null;
  responseTokens: number;
  promptTokens: number;
}

export interface ToolStats {
  name: string;
  calls: number;
  /** In how many turns it was used at all. */
  turns: number;
}

export type DurationBucket = "under5s" | "under15s" | "under1m" | "under5m" | "over5m";

export interface TaskStats {
  count: number;
  averageMs: number;
  medianMs: number;
  p90Ms: number;
  longestMs: number;
  buckets: { id: DurationBucket; count: number }[];
}

export interface StatsSummary {
  turns: number;
  promptTokens: number;
  responseTokens: number;
  tokensPerSecond: number;
  models: ModelStats[];
  tools: ToolStats[];
  tasks: TaskStats;
  firstAt: number | null;
  lastAt: number | null;
}

/** The value at a share of a sorted list, by nearest rank. */
export function percentile(sorted: number[], share: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(Math.min(1, Math.max(0, share)) * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

const BUCKET_LIMITS: [DurationBucket, number][] = [
  ["under5s", 5_000],
  ["under15s", 15_000],
  ["under1m", 60_000],
  ["under5m", 300_000],
  ["over5m", Number.POSITIVE_INFINITY],
];

export function bucketFor(ms: number): DurationBucket {
  for (const [id, limit] of BUCKET_LIMITS) {
    if (ms < limit) return id;
  }
  return "over5m";
}

const rate = (tokens: number, ms: number) => (ms > 0 ? (tokens / ms) * 1000 : 0);

export function summarize(rows: MetricRow[]): StatsSummary {
  const models = new Map<
    string,
    { turns: number; tokens: number; ms: number; prompt: number; firstTotal: number; firstCount: number }
  >();
  const tools = new Map<string, ToolStats>();
  const durations: number[] = [];

  let promptTokens = 0;
  let responseTokens = 0;
  let responseMs = 0;
  let firstAt: number | null = null;
  let lastAt: number | null = null;

  for (const row of rows) {
    promptTokens += row.promptTokens || 0;
    responseTokens += row.responseTokens || 0;
    responseMs += row.responseMs || 0;

    firstAt = firstAt === null ? row.recordedAt : Math.min(firstAt, row.recordedAt);
    lastAt = lastAt === null ? row.recordedAt : Math.max(lastAt, row.recordedAt);

    const model = models.get(row.model) ?? {
      turns: 0,
      tokens: 0,
      ms: 0,
      prompt: 0,
      firstTotal: 0,
      firstCount: 0,
    };

    model.turns += 1;
    model.tokens += row.responseTokens || 0;
    model.ms += row.responseMs || 0;
    model.prompt += row.promptTokens || 0;
    if (typeof row.firstTokenMs === "number") {
      model.firstTotal += row.firstTokenMs;
      model.firstCount += 1;
    }
    models.set(row.model, model);

    for (const [name, calls] of Object.entries(row.tools || {})) {
      if (!(calls > 0)) continue;
      const tool = tools.get(name) ?? { name, calls: 0, turns: 0 };
      tool.calls += calls;
      tool.turns += 1;
      tools.set(name, tool);
    }

    if (row.taskMs > 0) durations.push(row.taskMs);
  }

  durations.sort((a, b) => a - b);

  const buckets = BUCKET_LIMITS.map(([id]) => ({ id, count: 0 }));
  for (const ms of durations) {
    const bucket = buckets.find((entry) => entry.id === bucketFor(ms));
    if (bucket) bucket.count += 1;
  }

  return {
    turns: rows.length,
    promptTokens,
    responseTokens,
    tokensPerSecond: rate(responseTokens, responseMs),
    models: [...models.entries()]
      .map(([model, entry]) => ({
        model,
        turns: entry.turns,
        tokensPerSecond: rate(entry.tokens, entry.ms),
        firstTokenMs: entry.firstCount > 0 ? entry.firstTotal / entry.firstCount : null,
        responseTokens: entry.tokens,
        promptTokens: entry.prompt,
      }))
      .sort((a, b) => b.turns - a.turns || a.model.localeCompare(b.model)),
    tools: [...tools.values()].sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name)),
    tasks: {
      count: durations.length,
      averageMs: durations.length ? durations.reduce((sum, ms) => sum + ms, 0) / durations.length : 0,
      medianMs: percentile(durations, 0.5),
      p90Ms: percentile(durations, 0.9),
      longestMs: durations.at(-1) ?? 0,
      buckets,
    },
    firstAt,
    lastAt,
  };
}

/** "850 ms", "4.2 s", "1 min 12 s", "1 h 3 min". */
export function formatDuration(ms: number): string {
  const value = Math.max(0, ms);

  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")} s`;

  const totalSeconds = Math.round(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours} h ${minutes} min`;
  return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
}
