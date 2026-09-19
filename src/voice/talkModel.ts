import { pullModel, warmModel } from "../llama";
import { installedMatch } from "../embedModel";
import { KEEP_ALIVE } from "./constants";

export { installedMatch };

/** The model that does the talking, on its own VRAM-sized ladder. It stops early: a spoken answer
 * is two sentences, and past fourteen billion parameters it costs a turn to be no better. */

export interface TalkTier {
  /** Least VRAM, in gigabytes, that this rung is meant for. */
  vram: number;
  /** The family name a file on disk starts with, so any build of it counts as installed. */
  model: string;
  /** What the downloader resolves: a Hugging Face repository and the quantisation to fetch. */
  reference: string;
  label: string;
  params: string;
  /** What the first run has to download, in gigabytes. */
  downloadGB: number;
}

/** Every rung is tuned to chat rather than to reason: built for on-device conversation (Liquid, the
 * Gemma E-series) or an instruct model that answers at once. Reasoning models are absent. */
export const TALK_TIERS: readonly TalkTier[] = [
  // The floor is for machines with no usable graphics memory at all, where the
  // reply is generated on the processor and size is the whole latency budget.
  { vram: 0, model: "lfm2.5-1.2b-instruct", reference: "LiquidAI/LFM2.5-1.2B-Instruct-GGUF:Q4_K_M", label: "LFM 2.5 1.2B", params: "1.2B", downloadGB: 0.73 },
  { vram: 2, model: "lfm2.5-2.6b", reference: "LiquidAI/LFM2.5-2.6B-GGUF:Q4_K_M", label: "LFM 2.5 2.6B", params: "2.6B", downloadGB: 1.67 },
  { vram: 3, model: "ministral-3-3b-instruct", reference: "mistralai/Ministral-3-3B-Instruct-2512-GGUF:Q4_K_M", label: "Ministral 3 3B", params: "3B", downloadGB: 2.15 },
  { vram: 4, model: "gemma-4-e2b-it", reference: "unsloth/gemma-4-E2B-it-GGUF:Q4_K_M", label: "Gemma 4 E2B", params: "2B", downloadGB: 3.11 },
  { vram: 6, model: "gemma-4-e4b-it", reference: "unsloth/gemma-4-E4B-it-GGUF:Q4_K_M", label: "Gemma 4 E4B", params: "4B", downloadGB: 4.98 },
  { vram: 8, model: "ministral-3-8b-instruct", reference: "mistralai/Ministral-3-8B-Instruct-2512-GGUF:Q4_K_M", label: "Ministral 3 8B", params: "8B", downloadGB: 5.2 },
  { vram: 12, model: "gemma-4-12b-it", reference: "unsloth/gemma-4-12b-it-GGUF:Q4_K_M", label: "Gemma 4 12B", params: "12B", downloadGB: 7.12 },
  { vram: 16, model: "ministral-3-14b-instruct", reference: "mistralai/Ministral-3-14B-Instruct-2512-GGUF:Q4_K_M", label: "Ministral 3 14B", params: "14B", downloadGB: 8.24 },
];

export function tierFor(vram: number): TalkTier {
  const affordable = TALK_TIERS.filter(
    (tier) => Number.isFinite(vram) && vram >= tier.vram,
  );
  return affordable[affordable.length - 1] ?? TALK_TIERS[0];
}

export function tierOf(model: string): TalkTier | null {
  return TALK_TIERS.find((tier) => tier.model === model || tier.reference === model) ?? null;
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

/** What Talk runs, and what it must fetch. A pinned model that is gone reverts to automatic:
 * removing it was not a request to download it again. */
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

/** Puts the planned model on the machine. A failed download falls back to the chat model, which is
 * installed by definition, and the interface says so. */
export async function provideTalkModel(
  plan: TalkPlan,
  options: ProvideOptions,
): Promise<ProvidedModel> {
  if (!plan.download) return { model: plan.model, substituted: false };

  try {
    await pullModel(
      plan.download.reference,
      (progress) =>
        options.onProgress?.({
          percent: Math.min(100, Math.round(progress.percent)),
          model: plan.model,
        }),
      options.signal,
    );

    // The file keeps the name its repository gave it, so it is looked up again once it has landed.
    const files = (await window.electronAPI?.gguf?.listModels()) ?? [];
    const landed = installedMatch(plan.download.model, files.map((file) => file.filename));
    if (!landed) throw new Error(`${plan.download.label} was downloaded but is not in the models folder.`);
    return { model: landed, substituted: false };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    if (!options.fallback) throw error;
    return { model: options.fallback, substituted: true };
  }
}

/** Loads the weights before the first question, or the user pays seconds inside their first spoken
 * turn. Failing is harmless; it loads on the real request. */
export async function warmTalkModel(model: string): Promise<void> {
  try {
    await warmModel(model, KEEP_ALIVE);
  } catch {
    /* the first reply pays for the load instead */
  }
}
