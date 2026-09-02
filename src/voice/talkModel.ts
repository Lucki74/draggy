import { pullModel, warmModel } from "../ollama";
import { KEEP_ALIVE } from "./constants";

/**
 * The model that does the talking, on its own VRAM-sized ladder. It stops early:
 * past four billion parameters a spoken answer is no better and costs a turn.
 */

export interface TalkTier {
  /** Least VRAM, in gigabytes, that this rung is meant for. */
  vram: number;
  model: string;
  label: string;
  params: string;
  /** Roughly what the first run has to download, in gigabytes. */
  downloadGB: number;
}

/**
 * Every rung answers immediately. Reasoning models are absent: asked to say
 * hello, Qwen 3 4B writes six hundred characters first, and cannot be stopped.
 */
export const TALK_TIERS: readonly TalkTier[] = [
  // The floor is for machines with no usable graphics memory at all, where the
  // reply is generated on the processor and size is the whole latency budget.
  { vram: 0, model: "smollm2:360m", label: "SmolLM2 360M", params: "360M", downloadGB: 0.3 },
  { vram: 2, model: "llama3.2:1b", label: "Llama 3.2 1B", params: "1B", downloadGB: 1.3 },
  { vram: 4, model: "llama3.2:3b", label: "Llama 3.2 3B", params: "3B", downloadGB: 2.0 },
  { vram: 8, model: "gemma3:4b", label: "Gemma 3 4B", params: "4B", downloadGB: 3.3 },
  { vram: 16, model: "llama3.1:8b", label: "Llama 3.1 8B", params: "8B", downloadGB: 4.7 },
];

export function tierFor(vram: number): TalkTier {
  const affordable = TALK_TIERS.filter(
    (tier) => Number.isFinite(vram) && vram >= tier.vram,
  );
  return affordable[affordable.length - 1] ?? TALK_TIERS[0];
}

export function tierOf(model: string): TalkTier | null {
  return TALK_TIERS.find((tier) => tier.model === model) ?? null;
}

/**
 * Whether something on disk counts as the model wanted. A re-quantised build is
 * the same model here, and calling it a miss re-downloads the weights.
 */
export function installedMatch(
  wanted: string,
  installed: readonly string[],
): string | null {
  const target = wanted.trim().toLowerCase();
  if (!target) return null;

  const exact = installed.find((name) => name.trim().toLowerCase() === target);
  if (exact) return exact;

  const [family, tag] = target.split(":");
  if (!tag) return null;

  return (
    installed.find((name) => {
      const [otherFamily, otherTag] = name.trim().toLowerCase().split(":");
      return otherFamily === family && otherTag?.startsWith(tag);
    }) ?? null
  );
}

export interface TalkPlan {
  /** The model that will answer, once it is on the machine. */
  model: string;
  /** Set when this rung was picked from the hardware rather than by the user. */
  tier: TalkTier | null;
  source: "chosen" | "sized";
  /** The download that has to happen before the first reply, if any. */
  download: TalkTier | null;
}

export interface TalkPlanInput {
  /** The model the user pinned in the interface. Empty means automatic. */
  override?: string;
  installed: readonly string[];
  vram: number;
}

/**
 * What Talk runs, and what it must fetch. A pinned model that is gone reverts
 * to automatic: removing it was not a request to download it again.
 */
export function planTalkModel(input: TalkPlanInput): TalkPlan {
  const pinned = input.override?.trim() ?? "";
  const owned = pinned ? installedMatch(pinned, input.installed) : null;

  if (owned) {
    return { model: owned, tier: tierOf(pinned), source: "chosen", download: null };
  }

  const tier = tierFor(input.vram);
  const ready = installedMatch(tier.model, input.installed);

  return {
    model: ready ?? tier.model,
    tier,
    source: "sized",
    download: ready ? null : tier,
  };
}

export interface TalkModelProgress {
  /** 0 to 100 across the whole download. */
  percent: number;
  model: string;
}

export interface ProvideOptions {
  /** Used when the download fails, so a conversation is still possible. */
  fallback: string;
  onProgress?: (progress: TalkModelProgress) => void;
  signal?: AbortSignal;
}

export interface ProvidedModel {
  model: string;
  /** True when the plan could not be met and the chat model stepped in. */
  substituted: boolean;
}

/**
 * Puts the planned model on the machine. A failed download falls back to the
 * chat model, which is installed by definition, and the interface says so.
 */
export async function provideTalkModel(
  plan: TalkPlan,
  options: ProvideOptions,
): Promise<ProvidedModel> {
  if (!plan.download) return { model: plan.model, substituted: false };

  try {
    await pullModel(
      plan.model,
      (progress) =>
        options.onProgress?.({
          percent: Math.min(100, Math.round(progress.percent)),
          model: plan.model,
        }),
      options.signal,
    );
    return { model: plan.model, substituted: false };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    if (!options.fallback) throw error;
    return { model: options.fallback, substituted: true };
  }
}

/**
 * Loads the weights before the first question, or the user pays seconds inside
 * their first spoken turn. Failing is harmless; it loads on the real request.
 */
export async function warmTalkModel(model: string): Promise<void> {
  try {
    await warmModel(model, KEEP_ALIVE);
  } catch {
    /* the first reply pays for the load instead */
  }
}
