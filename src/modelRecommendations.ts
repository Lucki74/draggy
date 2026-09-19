export interface ModelRecommendation {
  vram: number;
  /** A Hugging Face repository and quantisation, which is also what the downloader resolves. */
  model: string;
  label: string;
  params: string;
  /** The download, in gigabytes, checked against the repository when the rung was written. */
  sizeGB: number;
}

/** Enough about the machine to pick a ladder, and nothing else. Kept as plain data so the choice
 * can be tested without a Mac or a card. */
export interface RuntimeTarget {
  platform?: string;
  arch?: string;
  ram?: number;
  cpuModel?: string;
  llamaVersion?: string | null;
}

/** The GGUF engine has to read the whole model into RAM before the GPU can use any of it, so a
 * machine short on system memory cannot run a model its VRAM alone would suggest. */
export const USABLE_RAM_FRACTION = 0.8;

/** No dedicated GPU still means a real machine with a real CPU: floor the choice on a slice of
 * RAM instead of leaving every integrated-graphics laptop on the smallest model there is. */
export const CPU_ONLY_RAM_FRACTION = 0.5;

/** Apple Silicon chip classes, widest memory bandwidth last. A base or Pro die and a Max or Ultra
 * one sold with the same unified memory do not run the same size model at a usable speed. */
export type ChipClass = "base" | "pro" | "max" | "ultra";

/** Reads "Apple M2 Pro" style strings from os.cpus(). Unknown and non-Apple CPUs default to
 * "base", the class that asks least of the memory it is given. */
export function chipClassOf(cpuModel: string | null | undefined): ChipClass {
  const match = /Apple\s+M\d+\s*(Pro|Max|Ultra)?/i.exec(cpuModel ?? "");
  const variant = match?.[1]?.toLowerCase();
  return variant === "pro" || variant === "max" || variant === "ultra" ? variant : "base";
}

export const ggufLadder: ModelRecommendation[] = [
  { vram: 1.0,  model: "unsloth/Qwen3.5-0.8B-GGUF:Q4_K_M",                    label: "Qwen 3.5 0.8B",   params: "0.8B",     sizeGB: 0.53 },
  { vram: 2.0,  model: "unsloth/Qwen3.5-2B-GGUF:Q4_K_M",                      label: "Qwen 3.5 2B",     params: "2B",       sizeGB: 1.28 },
  { vram: 3.0,  model: "unsloth/Qwen3.5-4B-GGUF:Q4_K_M",                      label: "Qwen 3.5 4B",     params: "4B",       sizeGB: 2.74 },
  { vram: 4.0,  model: "unsloth/gemma-4-E2B-it-GGUF:Q4_K_M",                  label: "Gemma 4 E2B",     params: "2B",       sizeGB: 3.11 },
  { vram: 6.0,  model: "unsloth/gemma-4-E4B-it-GGUF:Q4_K_M",                  label: "Gemma 4 E4B",     params: "4B",       sizeGB: 4.98 },
  { vram: 8.0,  model: "unsloth/Qwen3.5-9B-GGUF:Q4_K_M",                      label: "Qwen 3.5 9B",     params: "9B",       sizeGB: 5.68 },
  { vram: 10.0, model: "unsloth/gemma-4-12b-it-GGUF:Q4_K_M",                  label: "Gemma 4 12B",     params: "12B",      sizeGB: 7.12 },
  { vram: 12.0, model: "mistralai/Ministral-3-14B-Instruct-2512-GGUF:Q4_K_M", label: "Ministral 3 14B", params: "14B",      sizeGB: 8.24 },
  { vram: 16.0, model: "ggml-org/gpt-oss-20b-GGUF:MXFP4",                     label: "GPT-OSS 20B",     params: "20B MoE",  sizeGB: 12.11 },
  { vram: 20.0, model: "unsloth/Qwen3.8-27B-GGUF:Q4_K_M",                     label: "Qwen 3.8 27B",    params: "27B",      sizeGB: 16.46 },
  { vram: 24.0, model: "unsloth/gemma-4-31B-it-GGUF:Q4_K_M",                  label: "Gemma 4 31B",     params: "31B",      sizeGB: 18.32 },
  { vram: 32.0, model: "unsloth/Qwen3.6-35B-A3B-GGUF:Q4_K_M",                 label: "Qwen 3.6 35B",    params: "35B MoE",  sizeGB: 22.13 },
  { vram: 40.0, model: "unsloth/Qwen3.8-27B-GGUF:Q8_0",                       label: "Qwen 3.8 27B Q8", params: "27B",      sizeGB: 29.05 },
  { vram: 48.0, model: "unsloth/Qwen3.6-35B-A3B-GGUF:Q8_0",                   label: "Qwen 3.6 35B Q8", params: "35B MoE",  sizeGB: 36.9 },
  { vram: 80.0, model: "ggml-org/gpt-oss-120b-GGUF:MXFP4",                    label: "GPT-OSS 120B",    params: "120B MoE", sizeGB: 63.39 },
  { vram: 96.0, model: "unsloth/Qwen3.5-122B-A10B-GGUF:Q4_K_M",               label: "Qwen 3.5 122B",   params: "122B MoE", sizeGB: 76.54 },
];

/** Kept as the name the rest of the app knows: there is only the one ladder now, since the GGUF
 * engine cannot load anything else. */
export const modelRecommendations = ggufLadder;
export const mlxLadder: ModelRecommendation[] = ggufLadder;

export function supportsMlx(_target?: RuntimeTarget): boolean {
  return false;
}

export function ladderFor(_target?: RuntimeTarget): ModelRecommendation[] {
  return ggufLadder;
}

function isAppleSilicon(target: RuntimeTarget): boolean {
  return target.platform === "darwin" && target.arch === "arm64";
}

/** What the ladder is climbed against. A Mac with its memory known ignores the VRAM argument
 * entirely, since unified memory is the only pool there: `getSystemSpecs` reports it as
 * `vram` too, but the ladder should be read against the real, whole number, not that copy. */
function effectiveBudget(vram: number, target: RuntimeTarget): number {
  const safeVram = Number.isFinite(vram) && vram > 0 ? vram : 0;

  if (isAppleSilicon(target)) {
    return target.ram && target.ram > 0 ? target.ram : safeVram;
  }

  if (!target.ram || target.ram <= 0) return safeVram;

  const ceiling = target.ram * USABLE_RAM_FRACTION;
  const floor = safeVram < 2 ? target.ram * CPU_ONLY_RAM_FRACTION : 0;
  return Math.min(Math.max(safeVram, floor), ceiling);
}

export function getRecommendedModel(vram: number, target: RuntimeTarget = {}): string {
  const ladder = ggufLadder;
  const budget = effectiveBudget(vram, target);

  const climbing = [...ladder].sort((a, b) => a.vram - b.vram);
  const affordable = climbing.filter((entry) => entry.vram <= budget);
  if (affordable.length === 0) return climbing[0].model;

  // A wide-bandwidth Max or Ultra die pushes the same memory size through the model a base or Pro
  // chip would only just manage, so it takes the rung above what the raw number alone affords.
  const index = climbing.indexOf(affordable[affordable.length - 1]);
  const chipClass = isAppleSilicon(target) ? chipClassOf(target.cpuModel) : "base";
  const bump = chipClass === "max" || chipClass === "ultra" ? 1 : 0;

  return climbing[Math.min(index + bump, climbing.length - 1)].model;
}

export interface RecommendedDownload {
  model: string;
  label: string;
  /** What the downloader resolves into files, split ones included. */
  reference: string;
  /** Roughly what it takes on disk, in bytes, for checking free space before asking anywhere. */
  size: number;
}

/** The rung the machine can carry, as something the downloader understands. */
export function getRecommendedDownload(
  vram: number,
  target: RuntimeTarget = {},
): RecommendedDownload {
  const modelName = getRecommendedModel(vram, target);
  const rung = ggufLadder.find((entry) => entry.model === modelName) ?? ggufLadder[0];

  return {
    model: rung.model,
    label: rung.label,
    reference: rung.model,
    size: Math.round(rung.sizeGB * 1e9),
  };
}
