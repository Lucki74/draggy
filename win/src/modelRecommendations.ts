import { USABLE_VRAM_FRACTION } from "./vram";

export interface ModelRecommendation {
  /** Dense: the VRAM it needs to run fast. MoE: the smallest card that holds its active weights and context. */
  vram: number;
  /** A Hugging Face repository and quantisation, which is also what the downloader resolves. */
  model: string;
  label: string;
  params: string;
  /** The download, in gigabytes, checked against the repository when the rung was written. */
  sizeGB: number;
  /** A dense model lives on the card; an MoE keeps its experts in RAM and the rest on the card. */
  kind: "dense" | "moe";
  /** All the memory it needs, card and RAM together, in GB. */
  memory: number;
  /** Needs a llama.cpp build upstream does not ship yet, so it is never picked. */
  pending: boolean;
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

/** Dense rungs on a machine with no card stop here: past it the CPU answers too slowly, and an MoE does better. */
export const CPU_ONLY_DENSE_CAP_GB = 8;

/** Unified memory macOS lets the GPU wire, leaving the rest to the system. */
export const USABLE_UNIFIED_RAM_FRACTION = 0.75;

const dense = (vram: number, model: string, label: string, params: string, sizeGB: number): ModelRecommendation =>
  ({ vram, model, label, params, sizeGB, kind: "dense", memory: vram, pending: false });
const moe = (vram: number, memory: number, model: string, label: string, params: string, sizeGB: number, pending = false): ModelRecommendation =>
  ({ vram, model, label, params, sizeGB, kind: "moe", memory, pending });

/** Ascending by quality, so the best rung that fits is the last one that does. */
export const ggufLadder: ModelRecommendation[] = [
  dense(1,    "unsloth/Qwen3.5-0.8B-GGUF:Q4_K_M",                    "Qwen 3.5 0.8B",     "0.8B", 0.53),
  dense(2,    "unsloth/Qwen3.5-2B-GGUF:Q4_K_M",                      "Qwen 3.5 2B",       "2B",   1.28),
  dense(3.5,  "unsloth/Qwen3.5-4B-GGUF:Q4_K_M",                      "Qwen 3.5 4B",       "4B",   2.74),
  dense(6,    "unsloth/gemma-4-E4B-it-GGUF:Q4_K_M",                  "Gemma 4 E4B",       "4B",   4.98),
  dense(7.5,  "unsloth/Qwen3.5-9B-GGUF:UD-Q4_K_XL",                  "Qwen 3.5 9B",       "9B",   5.97),
  dense(9.5,  "unsloth/gemma-4-12b-it-GGUF:UD-Q4_K_XL",              "Gemma 4 12B",       "12B",  7.37),
  dense(11,   "mistralai/Ministral-3-14B-Instruct-2512-GGUF:Q4_K_M", "Ministral 3 14B",   "14B",  8.24),
  moe(0, 14,  "ggml-org/gpt-oss-20b-GGUF:MXFP4",                     "GPT-OSS 20B",       "20B MoE", 12.11),
  moe(0, 19,  "unsloth/gemma-4-26B-A4B-it-GGUF:UD-Q4_K_XL",          "Gemma 4 26B",       "26B MoE", 17.01),
  moe(0, 25,  "unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_XL",             "Qwen 3.6 35B",      "35B MoE", 22.36),
  moe(0, 30,  "unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q5_K_XL",             "Qwen 3.6 35B Q5",   "35B MoE", 26.59),
  moe(0, 33,  "unsloth/Qwen3.6-35B-A3B-GGUF:Q6_K",                   "Qwen 3.6 35B Q6",   "35B MoE", 29.31),
  moe(0, 40,  "unsloth/Qwen3.6-35B-A3B-GGUF:Q8_0",                   "Qwen 3.6 35B Q8",   "35B MoE", 36.9),
  dense(15.5, "unsloth/Qwen3.8-27B-GGUF:UD-Q3_K_XL",                 "Qwen 3.8 27B Q3",   "27B",  13.15),
  moe(8, 61,  "unsloth/Qwen3.5-122B-A10B-GGUF:UD-Q3_K_XL",           "Qwen 3.5 122B Q3",  "122B MoE", 56.97),
  moe(8, 82,  "unsloth/Qwen3.5-122B-A10B-GGUF:UD-Q4_K_XL",           "Qwen 3.5 122B",     "122B MoE", 77.03),
  dense(20,   "unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL",                 "Qwen 3.8 27B",      "27B",  17.56),
  dense(23,   "unsloth/Qwen3.8-27B-GGUF:UD-Q5_K_XL",                 "Qwen 3.8 27B Q5",   "27B",  20.88),
  dense(32,   "unsloth/Qwen3.8-27B-GGUF:Q8_0",                       "Qwen 3.8 27B Q8",   "27B",  29.05),
  moe(8, 94,  "unsloth/Qwen3.8-Flash-Next-GGUF:UD-Q3_K_XL",          "Qwen 3.8 Flash-Next Q3", "125B MoE", 89.99),
  moe(8, 116, "unsloth/Qwen3.8-Flash-Next-GGUF:UD-Q4_K_XL",          "Qwen 3.8 Flash-Next",    "125B MoE", 111.33),
  moe(10, 135, "unsloth/DeepSeek-V4-Flash-GGUF:UD-Q3_K_XL",          "DeepSeek V4 Flash Q3",   "284B MoE", 129.45),
  moe(10, 162, "unsloth/DeepSeek-V4-Flash-GGUF:UD-Q4_K_XL",          "DeepSeek V4 Flash",      "284B MoE", 155.1),
  moe(12, 210, "unsloth/GLM-5.3-Flash-GGUF:UD-Q4_K_XL",              "GLM-5.3-Flash",          "320B MoE", 199.71),
  moe(12, 250, "unsloth/GLM-5.3-Flash-GGUF:UD-Q5_K_XL",              "GLM-5.3-Flash Q5",       "320B MoE", 240.31),
  moe(16, 410, "unsloth/DeepSeek-V4.1-Flash-1017-GGUF:UD-IQ3_XXS",   "DeepSeek V4.1 Flash Q3", "552B MoE", 394.7, true),
  moe(16, 520, "unsloth/DeepSeek-V4.1-Flash-1017-GGUF:UD-Q4_K_XL",   "DeepSeek V4.1 Flash",    "552B MoE", 500.7, true),
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

/** The whole unified pool on a Mac. Its real memory wins over the `vram` copy `getSystemSpecs` reports. */
function unifiedMemory(vram: number, target: RuntimeTarget): number {
  return target.ram && target.ram > 0 ? target.ram : vram;
}

/** What a dense rung is held to: the card, floored on a slice of RAM when there is none, capped by RAM. */
function denseBudget(vram: number, ram: number): number {
  if (ram <= 0) return vram;
  const floor = vram < 2 ? Math.min(ram * CPU_ONLY_RAM_FRACTION, CPU_ONLY_DENSE_CAP_GB) : 0;
  return Math.min(Math.max(vram, floor), ram * USABLE_RAM_FRACTION);
}

/** Dense rungs need the card; an MoE needs card and RAM together, plus a card big enough for its active part. */
export function rungFits(rung: ModelRecommendation, vram: number, target: RuntimeTarget = {}): boolean {
  const safeVram = Number.isFinite(vram) && vram > 0 ? vram : 0;
  if (isAppleSilicon(target)) return rung.memory <= unifiedMemory(safeVram, target) * USABLE_UNIFIED_RAM_FRACTION;
  const ram = target.ram && target.ram > 0 ? target.ram : 0;
  if (rung.kind === "dense") return rung.vram <= denseBudget(safeVram, ram);
  return safeVram >= rung.vram && rung.memory <= safeVram * USABLE_VRAM_FRACTION + ram * USABLE_RAM_FRACTION;
}

export function getRecommendedModel(vram: number, target: RuntimeTarget = {}): string {
  const index = ggufLadder.findLastIndex((rung) => !rung.pending && rungFits(rung, vram, target));
  if (index < 0) return ggufLadder[0].model;

  // A Max or Ultra die has the bandwidth for the rung above, if all its memory can hold it.
  const next = ggufLadder[index + 1];
  const wide = isAppleSilicon(target) && ["max", "ultra"].includes(chipClassOf(target.cpuModel));
  const whole = unifiedMemory(Number.isFinite(vram) && vram > 0 ? vram : 0, target);
  return wide && next && !next.pending && next.memory <= whole ? next.model : ggufLadder[index].model;
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
