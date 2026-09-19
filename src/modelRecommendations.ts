export interface ModelRecommendation {
  vram: number;
  model: string;
  label: string;
  params: string;
}

/** Enough about the machine to pick a ladder, and nothing else. Kept as plain data so the choice
 * can be tested without a Mac or a card. */
export interface RuntimeTarget {
  platform?: string;
  arch?: string;
  ram?: number;
  cpuModel?: string;
  ollamaVersion?: string | null;
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
  { vram: 2.0,  model: "qwen3.5:0.8b",         label: "Qwen 3.5 0.8B",      params: "0.8B"     },
  { vram: 4.0,  model: "qwen3.5:2b",           label: "Qwen 3.5 2B",        params: "2B"       },
  { vram: 5.0,  model: "gemma4:e4b",           label: "Gemma 4 E4B",        params: "4B"       },
  { vram: 6.0,  model: "mistral:7b",           label: "Mistral 7B",         params: "7B"       },
  { vram: 8.0,  model: "qwen3.5:9b",           label: "Qwen 3.5 9B",        params: "9B"       },
  { vram: 10.0, model: "gemma4:12b",           label: "Gemma 4 12B",        params: "12B"      },
  { vram: 12.0, model: "phi4:14b",             label: "Phi-4 14B",          params: "14B"      },
  { vram: 16.0, model: "gpt-oss:20b",          label: "GPT-OSS 20B",        params: "20B MoE"  },
  { vram: 20.0, model: "qwen3.5:27b",          label: "Qwen 3.5 27B",       params: "27B MoE"  },
  { vram: 22.0, model: "glm-4.7-flash:latest", label: "GLM 4.7 Flash",      params: "30B MoE"  },
  { vram: 24.0, model: "gemma4:31b",           label: "Gemma 4 31B",        params: "31B"      },
  { vram: 32.0, model: "qwen3.5:35b",          label: "Qwen 3.5 35B",       params: "35B MoE"  },
  { vram: 96.0, model: "qwen3.5:122b",         label: "Qwen 3.5 122B",      params: "122B MoE" },
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
  filename: string;
  url: string;
  size: number;
}

export const RECOMMENDED_DOWNLOADS: Record<
  string,
  { filename: string; url: string; size: number }
> = {
  "qwen3.5:0.8b": {
    filename: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
    url: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf?download=true",
    size: 398000000,
  },
  "qwen3.5:2b": {
    filename: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
    url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf?download=true",
    size: 986000000,
  },
  "gemma4:e4b": {
    filename: "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    url: "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf?download=true",
    size: 2020000000,
  },
  "mistral:7b": {
    filename: "Mistral-7B-Instruct-v0.3-Q4_K_M.gguf",
    url: "https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf?download=true",
    size: 4370000000,
  },
  "qwen3.5:9b": {
    filename: "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
    url: "https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf?download=true",
    size: 4920733696,
  },
  "gemma4:12b": {
    filename: "phi-4-Q4_K_M.gguf",
    url: "https://huggingface.co/bartowski/phi-4-GGUF/resolve/main/phi-4-Q4_K_M.gguf?download=true",
    size: 9140000000,
  },
  "phi4:14b": {
    filename: "phi-4-Q4_K_M.gguf",
    url: "https://huggingface.co/bartowski/phi-4-GGUF/resolve/main/phi-4-Q4_K_M.gguf?download=true",
    size: 9140000000,
  },
};

const DEFAULT_DOWNLOAD = {
  filename: "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
  url: "https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf?download=true",
  size: 4920733696,
};

/** Resolves a recommended Hugging Face download package sized for the machine's hardware. */
export function getRecommendedDownload(
  vram: number,
  target: RuntimeTarget = {},
): RecommendedDownload {
  const modelName = getRecommendedModel(vram, target);
  const ladderEntry = ggufLadder.find((entry) => entry.model === modelName);
  const download = RECOMMENDED_DOWNLOADS[modelName] || DEFAULT_DOWNLOAD;

  return {
    model: modelName,
    label: ladderEntry?.label || "Recommended Model",
    filename: download.filename,
    url: download.url,
    size: download.size,
  };
}
