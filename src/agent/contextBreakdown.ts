import { CHARS_PER_TOKEN, COMPACT_AT } from "./compaction";

/** What the context window is spent on. The model reports one number; the parts are measured from
 * what Draggy sent and scaled to add up to it. */

export type ContextCategory =
  | "messages"
  | "system"
  | "tools"
  | "memory"
  | "skills"
  | "summary";

export type ContextBreakdown = Record<ContextCategory, number>;

/** Characters of each fixed part of the prompt, as sent. */
export interface PromptParts {
  systemChars: number;
  toolChars: number;
  memoryChars: number;
  skillChars: number;
  summaryChars: number;
}

export const CATEGORY_ORDER: ContextCategory[] = [
  "messages",
  "system",
  "tools",
  "memory",
  "skills",
  "summary",
];

const tokensOf = (chars: number) => Math.max(0, Math.ceil(chars / CHARS_PER_TOKEN));

/** Splits a measured count: fixed parts estimated from length, the conversation gets the rest.
 * Overshooting estimates are scaled down together, never below zero. */
export function measureBreakdown(
  parts: PromptParts,
  measuredTokens: number,
  conversationChars = 0,
): ContextBreakdown {
  const fixed = {
    system: tokensOf(parts.systemChars),
    tools: tokensOf(parts.toolChars),
    memory: tokensOf(parts.memoryChars),
    skills: tokensOf(parts.skillChars),
    summary: tokensOf(parts.summaryChars),
  };

  const fixedTotal = fixed.system + fixed.tools + fixed.memory + fixed.skills + fixed.summary;

  // Nothing measured: an estimate of everything is the best there is.
  if (!(measuredTokens > 0)) {
    return { ...fixed, messages: tokensOf(conversationChars) };
  }

  if (fixedTotal <= measuredTokens) {
    return { ...fixed, messages: measuredTokens - fixedTotal };
  }

  const scale = measuredTokens / fixedTotal;
  const scaled = {
    system: Math.floor(fixed.system * scale),
    tools: Math.floor(fixed.tools * scale),
    memory: Math.floor(fixed.memory * scale),
    skills: Math.floor(fixed.skills * scale),
    summary: Math.floor(fixed.summary * scale),
  };

  const scaledTotal =
    scaled.system + scaled.tools + scaled.memory + scaled.skills + scaled.summary;

  return { ...scaled, messages: Math.max(0, measuredTokens - scaledTotal) };
}

export interface ContextRow {
  id: ContextCategory | "draft" | "free";
  tokens: number;
  /** Share of the whole window, 0 to 100. */
  percent: number;
}

export interface ContextWindowView {
  /** Whether anything has been measured yet. Before that there is nothing honest to show. */
  measured: boolean;
  /** False while a reply streams and the figure is an estimate between two counts. */
  exact: boolean;
  usedTokens: number;
  windowTokens: number;
  percent: number;
  /** Each part that has anything in it, then what is still free. */
  rows: ContextRow[];
  /** Where the conversation gets folded into notes, in tokens. */
  compactAtTokens: number;
  /** Whether that point was chosen by the user or worked out by Draggy. */
  compactSource: "auto" | "limit";
}

export interface ContextWindowInput {
  /** The parts, adding up to what the model counted. Null when nothing has been measured. */
  breakdown: ContextBreakdown | null;
  /** How much of the conversation part is the message not yet sent, when that was measured. */
  draftTokens: number;
  /** False for an estimate made while a reply streams. */
  exact: boolean;
  /** The most the model can take, which is also what automatic folding is measured against. */
  windowTokens: number;
  /** The user's own limit, when they set one. */
  limitTokens: number | null;
}

/** Where automatic folding happens, in tokens. Measured against how far the window can grow, not the
 * smaller window loaded now: that one only grows past a size the fold would already have cut back. */
export function compactThreshold(
  windowTokens: number,
  limitTokens: number | null,
): { tokens: number; source: "auto" | "limit" } {
  if (limitTokens !== null && limitTokens > 0) {
    return { tokens: Math.min(limitTokens, maxLimitFor(windowTokens)), source: "limit" };
  }

  return { tokens: Math.floor(windowTokens * COMPACT_AT), source: "auto" };
}

/** The lowest limit accepted. Below it every turn would be folded away. */
export const MIN_COMPACT_LIMIT = 1000;

/** The highest limit worth honouring. Past this the reply itself stops fitting, so a limit above it
 * would only move the wall rather than the fold. */
export function maxLimitFor(windowTokens: number): number {
  return Math.floor(windowTokens * 0.9);
}

export function describeContextWindow(input: ContextWindowInput): ContextWindowView {
  const windowTokens = Math.max(1, input.windowTokens);
  const share = (tokens: number) => (tokens / windowTokens) * 100;

  const breakdown: ContextBreakdown = input.breakdown ?? {
    messages: 0,
    system: 0,
    tools: 0,
    memory: 0,
    skills: 0,
    summary: 0,
  };

  // The draft was counted as part of the conversation; it is shown on a row of its own.
  const draft = Math.max(0, Math.min(Math.round(input.draftTokens), breakdown.messages));

  const rows: ContextRow[] = [];

  for (const id of CATEGORY_ORDER) {
    const tokens = id === "messages" ? breakdown.messages - draft : breakdown[id];
    if (tokens > 0) rows.push({ id, tokens, percent: share(tokens) });
  }

  if (draft > 0) rows.push({ id: "draft", tokens: draft, percent: share(draft) });

  const usedTokens = rows.reduce((total, row) => total + row.tokens, 0);
  const free = Math.max(0, windowTokens - usedTokens);

  rows.push({ id: "free", tokens: free, percent: share(free) });

  const threshold = compactThreshold(windowTokens, input.limitTokens);

  return {
    measured: input.breakdown !== null,
    exact: input.exact,
    usedTokens,
    windowTokens,
    percent: share(usedTokens),
    rows,
    compactAtTokens: threshold.tokens,
    compactSource: threshold.source,
  };
}

/** Reads a typed token count ("20000", "20k", "1.5k", "2m"). "auto" and "off" return null; anything
 * else returns undefined. */
export function parseTokenCount(raw: string): number | null | undefined {
  const text = String(raw || "").trim().toLowerCase().replace(/[,_\s]/g, "");

  if (!text) return undefined;
  if (text === "auto" || text === "off" || text === "default") return null;

  const match = /^(\d+(?:\.\d+)?)(k|m)?(?:tokens?)?$/.exec(text);
  if (!match) return undefined;

  const multiplier = match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
  const value = Math.round(Number(match[1]) * multiplier);

  return value > 0 ? value : undefined;
}

/** "27.6k", "203k", "950". The same shape everywhere a count is shown. */
export function formatTokenCount(tokens: number): string {
  const value = Math.max(0, Math.round(tokens));

  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 100_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}
