import { pullModel, warmModel } from "../ollama";
import { KEEP_ALIVE } from "./constants";

/**
 * Choosing the model that does the talking.
 *
 * A spoken reply is a different job from a written one. It is two sentences
 * long, it has to start arriving within a few hundred milliseconds of the user
 * falling silent, and nobody ever reads it back. The model that writes essays
 * and calls tools in the chat window is the wrong shape for that: it is loaded
 * for context length and reasoning depth, both of which are paid for in time to
 * first token.
 *
 * The fast helper the router uses is the wrong shape too, in the other
 * direction. It is sized to emit one word of classification, and a 360M model
 * asked to hold a conversation produces replies that are quick and wrong.
 *
 * So Talk gets its own ladder, sized to the graphics card. Every rung is a
 * small instruction-tuned model that answers conversationally and loads in a
 * couple of seconds, and the rung is picked from the VRAM actually present and
 * downloaded on first use. The ladder deliberately stops climbing early: past
 * about four billion parameters a spoken answer is not noticeably better, and
 * the extra weights are paid for on every single turn.
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

export const TALK_TIERS: readonly TalkTier[] = [
  // The floor is for machines with no usable graphics memory at all, where the
  // reply is generated on the processor and size is the whole latency budget.
  { vram: 0, model: "smollm2:360m", label: "SmolLM2 360M", params: "360M", downloadGB: 0.3 },
  { vram: 2, model: "llama3.2:1b", label: "Llama 3.2 1B", params: "1B", downloadGB: 1.3 },
  { vram: 4, model: "qwen3:1.7b", label: "Qwen 3 1.7B", params: "1.7B", downloadGB: 1.4 },
  { vram: 6, model: "llama3.2:3b", label: "Llama 3.2 3B", params: "3B", downloadGB: 2.0 },
  { vram: 8, model: "qwen3:4b", label: "Qwen 3 4B", params: "4B", downloadGB: 2.6 },
  { vram: 16, model: "qwen3:8b", label: "Qwen 3 8B", params: "8B", downloadGB: 5.2 },
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
 * Whether something already on disk counts as the model we wanted.
 *
 * Ollama names a re-quantised build "qwen3:4b-instruct-q5_K_M", which is the
 * same model to anyone talking to it. Treating that as a miss would download a
 * second copy of weights the user already has.
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
 * What Talk will run, and what it has to fetch first.
 *
 * A pinned model that is no longer installed quietly reverts to automatic
 * rather than sending the user to a download they never asked for: they chose
 * from a list of what they had, and removing it is not a request to get it
 * back.
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
 * Puts the planned model on the machine and into memory.
 *
 * A failed download is not a reason to lose the conversation. The chat model is
 * already installed by definition, so it answers instead and the interface says
 * which model is actually speaking.
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
 * Loads the weights before the first question rather than during it.
 *
 * Without this the user pays the load time — seconds, for anything above a
 * billion parameters — inside their first spoken turn, which is exactly the
 * moment the conversation feels broken. Failure here is harmless: the model
 * loads on the first real request instead.
 */
export async function warmTalkModel(model: string): Promise<void> {
  try {
    await warmModel(model, KEEP_ALIVE);
  } catch {
    /* the first reply pays for the load instead */
  }
}
