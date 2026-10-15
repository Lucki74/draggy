/** The model that turns a file into vectors. Every rung is picked to index the largest chunkable
 * file in ten seconds; a passage is one forward pass. */

export interface EmbedTier {
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

export const EMBED_TIERS: readonly EmbedTier[] = [
  // The floor is for machines with no usable graphics memory, where every
  // extra parameter is paid for in wall-clock time on the processor.
  { vram: 0, model: "all-minilm", reference: "second-state/All-MiniLM-L6-v2-Embedding-GGUF:Q8_0", label: "All-MiniLM", params: "22M", downloadGB: 0.025 },
  { vram: 1, model: "embeddinggemma-300m", reference: "ggml-org/embeddinggemma-300M-GGUF:Q8_0", label: "EmbeddingGemma", params: "300M", downloadGB: 0.33 },
  { vram: 2, model: "nomic-embed-text", reference: "nomic-ai/nomic-embed-text-v1.5-GGUF:Q8_0", label: "Nomic Embed Text", params: "137M", downloadGB: 0.15 },
  { vram: 3, model: "mxbai-embed-large", reference: "ChristianAzinn/mxbai-embed-large-v1-gguf:Q8_0", label: "MxBai Embed Large", params: "335M", downloadGB: 0.36 },
  { vram: 4, model: "bge-m3", reference: "ggml-org/bge-m3-Q8_0-GGUF:Q8_0", label: "BGE-M3", params: "568M", downloadGB: 0.63 },
  { vram: 6, model: "qwen3-embedding-0.6b", reference: "Qwen/Qwen3-Embedding-0.6B-GGUF:Q8_0", label: "Qwen 3 Embedding 0.6B", params: "0.6B", downloadGB: 0.64 },
  { vram: 10, model: "qwen3-embedding-4b", reference: "Qwen/Qwen3-Embedding-4B-GGUF:Q4_K_M", label: "Qwen 3 Embedding 4B", params: "4B", downloadGB: 2.5 },
  { vram: 16, model: "qwen3-embedding-8b", reference: "Qwen/Qwen3-Embedding-8B-GGUF:Q4_K_M", label: "Qwen 3 Embedding 8B", params: "8B", downloadGB: 4.68 },
];

export function tierForEmbed(vram: number): EmbedTier {
  const affordable = EMBED_TIERS.filter(
    (tier) => Number.isFinite(vram) && vram >= tier.vram,
  );
  return affordable[affordable.length - 1] ?? EMBED_TIERS[0];
}

export function tierOfEmbed(model: string): EmbedTier | null {
  return EMBED_TIERS.find((tier) => tier.model === model || tier.reference === model) ?? null;
}

/** Whether a download is an embedding model. The Library tab shares its download state with the
 * Models tab, so it needs this to ignore chat models. */
export function isEmbedModel(modelName: string, override?: string): boolean {
  if (override && modelName.trim().toLowerCase() === override.trim().toLowerCase()) return true;
  if (tierOfEmbed(modelName) !== null) return true;
  return /(?:embed|bge-|minilm|gte-)/i.test(modelName);
}

/** Whether something on disk counts as the model wanted. A re-quantised build is the same model
 * here, and treating it as a miss re-downloads the weights. */
export function installedMatch(wanted: string, installed: readonly string[]): string | null {
  const target = wanted.trim().toLowerCase();
  if (!target) return null;

  const stem = (name: string) => name.trim().toLowerCase().replace(/\.gguf$/, "");
  const exact = installed.find((name) => name.trim().toLowerCase() === target || stem(name) === target);
  if (exact) return exact;

  return installed.find((name) => stem(name).startsWith(target)) ?? null;
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

/** What indexing runs with, and what it must fetch. A pinned model that is gone reverts to
 * automatic: removing it was not a request to download it again. */
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
