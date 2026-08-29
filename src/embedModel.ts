/**
 * Choosing the model that turns a file into vectors.
 *
 * Indexing has a latency budget a chat model does not: a folder of a few
 * hundred files has to finish in a reasonable sitting, and no single file
 * should make someone wonder if the app has hung. Ten seconds for the
 * largest file this app will chunk (400 passages, batched sixteen at a
 * time — see `MAX_CHUNKS_PER_FILE` and `EMBED_BATCH` in
 * `electron/library.cjs`) is the target every rung below is picked to meet.
 *
 * That budget is also why this ladder can climb further per gigabyte of
 * VRAM than `voice/talkModel.ts`'s does. A chat reply pays for every
 * parameter on every generated token; a passage is a single forward pass
 * through the encoder, so a bigger embedding model costs one pass, not one
 * pass per word out.
 *
 * Every rung is a real, fetchable Ollama tag, sized against what it
 * actually downloads today rather than a raw parameter count.
 */

export interface EmbedTier {
  /** Least VRAM, in gigabytes, that this rung is meant for. */
  vram: number;
  model: string;
  label: string;
  params: string;
  /** What the first run has to download, in gigabytes. */
  downloadGB: number;
}

export const EMBED_TIERS: readonly EmbedTier[] = [
  // The floor is for machines with no usable graphics memory at all, where
  // embedding runs on the processor and every extra parameter is paid for
  // in wall-clock time.
  { vram: 0, model: "all-minilm", label: "All-MiniLM", params: "33M", downloadGB: 0.05 },
  { vram: 2, model: "nomic-embed-text", label: "Nomic Embed Text", params: "137M", downloadGB: 0.27 },
  { vram: 4, model: "mxbai-embed-large", label: "MxBai Embed Large", params: "335M", downloadGB: 0.65 },
  { vram: 8, model: "qwen3-embedding:0.6b", label: "Qwen 3 Embedding 0.6B", params: "0.6B", downloadGB: 0.62 },
  { vram: 16, model: "qwen3-embedding:4b", label: "Qwen 3 Embedding 4B", params: "4B", downloadGB: 2.5 },
  { vram: 24, model: "qwen3-embedding:8b", label: "Qwen 3 Embedding 8B", params: "8B", downloadGB: 4.7 },
];

export function tierForEmbed(vram: number): EmbedTier {
  const affordable = EMBED_TIERS.filter(
    (tier) => Number.isFinite(vram) && vram >= tier.vram,
  );
  return affordable[affordable.length - 1] ?? EMBED_TIERS[0];
}

export function tierOfEmbed(model: string): EmbedTier | null {
  return EMBED_TIERS.find((tier) => tier.model === model) ?? null;
}

/**
 * Whether something already on disk counts as the model we wanted.
 *
 * Ollama names a re-quantised build "qwen3-embedding:0.6b-q8_0", which is
 * the same model to anyone indexing with it. Treating that as a miss would
 * download a second copy of weights already on the machine.
 */
function installedMatch(wanted: string, installed: readonly string[]): string | null {
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

export interface EmbedPlan {
  /** The model indexing will run with, once it is on the machine. */
  model: string;
  /** Set when this rung was picked from the hardware rather than by the user. */
  tier: EmbedTier | null;
  source: "chosen" | "sized";
  /** The download that has to happen before indexing can start, if any. */
  download: EmbedTier | null;
}

export interface EmbedPlanInput {
  /** The model the user pinned in the interface. Empty means automatic. */
  override?: string;
  installed: readonly string[];
  vram: number;
}

/**
 * What indexing will run with, and what it has to fetch first.
 *
 * A pinned model that is no longer installed quietly reverts to automatic
 * rather than sending the user to a download they never asked for: they
 * chose from a list of what they had, and removing it is not a request to
 * get it back.
 */
export function planEmbedModel(input: EmbedPlanInput): EmbedPlan {
  const pinned = input.override?.trim() ?? "";
  const owned = pinned ? installedMatch(pinned, input.installed) : null;

  if (owned) {
    return { model: owned, tier: tierOfEmbed(pinned), source: "chosen", download: null };
  }

  const tier = tierForEmbed(input.vram);
  const ready = installedMatch(tier.model, input.installed);

  return {
    model: ready ?? tier.model,
    tier,
    source: "sized",
    download: ready ? null : tier,
  };
}
