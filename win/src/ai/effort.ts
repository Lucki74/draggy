import type { AppMode } from "../app/modes";
import type { EffortLevel } from "../types";

// The effort levels, from no reasoning up to the most reasoning a model is asked for. The Rust core
// mirrors these rules in core/crates/agent/src/effort.rs; shared/fixtures/agent/effort.json holds
// the cases both sides must agree on.

export const EFFORT_ORDER: readonly EffortLevel[] = ["off", "low", "medium", "high", "max"];
export const EFFORT_DEFAULT: EffortLevel = "medium";

/** Reasoning tokens a local model may spend per level, before the context-size cap. */
export const LOCAL_BUDGET: Record<Exclude<EffortLevel, "off">, number> = {
  low: 1024,
  medium: 4096,
  high: 12288,
  max: 32768,
};

/** Chat stops at High unless the user allows Max there: Max is the slowest and costliest level. */
export const CHAT_MAX_LEVEL: EffortLevel = "high";

export type EffortReason = "unsupported" | "chatCap" | "noThinking" | "slow";

export interface EffectiveEffort {
  asked: EffortLevel;
  sent: EffortLevel;
  reason?: EffortReason;
}

export function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === "string" && (EFFORT_ORDER as readonly string[]).includes(value);
}

/** Anything unknown reads as the default, so a damaged setting never leaves the model without a level. */
export function normalizeEffort(value: unknown): EffortLevel {
  return isEffortLevel(value) ? value : EFFORT_DEFAULT;
}

export function isThinking(level: EffortLevel): boolean {
  return level !== "off";
}

/** The levels a mode may use. Chat drops Max unless the user allowed it. */
export function allowedEfforts(mode: AppMode, allowMaxInChat: boolean): EffortLevel[] {
  if (mode === "code" || allowMaxInChat) return [...EFFORT_ORDER];
  return EFFORT_ORDER.filter((level) => level !== "max");
}

/** The next level in the cycle, wrapping back to Off. A level the mode does not allow is skipped. */
export function nextEffort(level: EffortLevel, options: { mode: AppMode; allowMaxInChat: boolean }): EffortLevel {
  const allowed = allowedEfforts(options.mode, options.allowMaxInChat);
  const at = allowed.indexOf(level);
  if (at < 0) return highestAtOrBelow(level, allowed) ?? allowed[0];
  return allowed[(at + 1) % allowed.length];
}

/** The highest supported level that is not above `level`, else the lowest supported one. */
export function clampEffort(level: EffortLevel, supported: readonly EffortLevel[]): EffortLevel {
  if (supported.length === 0) return level;
  if (supported.includes(level)) return level;
  return highestAtOrBelow(level, supported) ?? supported[0];
}

function highestAtOrBelow(level: EffortLevel, levels: readonly EffortLevel[]): EffortLevel | undefined {
  const ceiling = EFFORT_ORDER.indexOf(level);
  let best: EffortLevel | undefined;
  for (const candidate of levels) {
    const rank = EFFORT_ORDER.indexOf(candidate);
    if (rank <= ceiling && (best === undefined || rank > EFFORT_ORDER.indexOf(best))) best = candidate;
  }
  return best;
}

/** The reasoning token budget for a local model: the level's budget, never more than a quarter of the context. */
export function localBudget(level: EffortLevel, numCtx: number): number | null {
  if (level === "off") return null;
  return Math.min(LOCAL_BUDGET[level], Math.floor(numCtx / 4));
}

export interface EffortInput {
  asked: EffortLevel;
  mode: AppMode;
  allowMaxInChat: boolean;
  /** Null when the model's capabilities are not known yet: the asked level is kept. */
  canThink: boolean | null;
  /** Null when the model's levels are not known: nothing is clamped. */
  supported: readonly EffortLevel[] | null;
  /** True when a slow model may not think: thinking is off until the user turns it on. */
  slowBlocksThinking: boolean;
}

/**
 * The level a turn actually runs at, and why it differs from the one asked. Rules run in this
 * order: a model that cannot think gets none; Chat caps Max; a slow model gets none; then the
 * level clamps to what the model supports. The first rule that changes the level gives the reason.
 */
export function effectiveEffort(input: EffortInput): EffectiveEffort {
  const { asked, mode, allowMaxInChat, canThink, supported, slowBlocksThinking } = input;

  if (canThink === false) {
    return isThinking(asked)
      ? { asked, sent: "off", reason: "noThinking" }
      : { asked, sent: "off" };
  }

  let sent = asked;
  let reason: EffortReason | undefined;

  if (mode === "chat" && !allowMaxInChat && sent === "max") {
    sent = CHAT_MAX_LEVEL;
    reason = "chatCap";
  }

  if (slowBlocksThinking && isThinking(sent)) {
    sent = "off";
    reason ??= "slow";
  }

  if (supported && isThinking(sent) && !supported.includes(sent)) {
    const clamped = clampEffort(sent, supported);
    if (clamped !== sent) {
      sent = clamped;
      reason ??= "unsupported";
    }
  }

  return reason ? { asked, sent, reason } : { asked, sent };
}

/**
 * Reads a level from settings saved before the five levels. Old "low" meant thinking off, so it
 * maps to off; the other old names keep their meaning.
 */
export function effortFromLegacy(value: unknown): EffortLevel | undefined {
  if (value === "low") return "off";
  if (value === "medium" || value === "high") return value;
  return undefined;
}
