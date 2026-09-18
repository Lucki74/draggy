export interface ModelRecommendation {
  vram: number;
  model: string;
  label: string;
  params: string;
}

/** Enough about the machine to pick a ladder, and nothing else. Kept as plain data so the choice
 * can be tested without a Mac, a card or a running Ollama. */
export interface RuntimeTarget {
  platform?: string;
  arch?: string;
  ollamaVersion?: string | null;
  /** Total system memory in GB, the number a spec sheet shows. On a PC it raises or caps the
   * choice VRAM alone would make; on a Mac, with no separate VRAM, it is the whole budget. */
  ram?: number;
  /** os.cpus()[0].model, e.g. "Apple M2 Pro". Only the Mac branch reads it, to tell a base chip
   * from the wider-bandwidth Pro, Max and Ultra dies that ship with the same memory sizes. */
  cpuModel?: string;
}

export const MLX_MIN_OLLAMA = [0, 19];

/** Ollama has to read the whole model into RAM before the GPU can use any of it, so a machine
 * short on system memory cannot run a model its VRAM alone would suggest. */
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

/** Raw unified memory, the number printed on the box: every configuration Apple has actually
 * sold since the first M1 in 2020, rounded to where the ladder needs a rung. */
export const mlxLadder: ModelRecommendation[] = [
  { vram: 8.0,   model: "qwen3.5:2b-mlx",           label: "Qwen 3.5 2B",     params: "2B"      },
  { vram: 16.0,  model: "qwen3.5:4b-mlx",           label: "Qwen 3.5 4B",     params: "4B"      },
  { vram: 24.0,  model: "qwen3.5:9b-mlx",           label: "Qwen 3.5 9B",     params: "9B"      },
  { vram: 32.0,  model: "qwen3.5:27b-mlx",          label: "Qwen 3.5 27B",    params: "27B MoE" },
  { vram: 48.0,  model: "gemma4:31b-mlx",           label: "Gemma 4 31B",     params: "31B"     },
  { vram: 64.0,  model: "qwen3.5:35b-mlx",          label: "Qwen 3.5 35B",    params: "35B MoE" },
  { vram: 96.0,  model: "glm-4.7-flash:latest-mlx", label: "GLM 4.7 Flash",   params: "30B MoE" },
  { vram: 128.0, model: "qwen3.5:122b-mlx",         label: "Qwen 3.5 122B",   params: "122B MoE"},
];

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

/** Kept as the name the rest of the app knows: the ladder for a plain PC. */
export const modelRecommendations = ggufLadder;

function atLeast(version: string | null | undefined, minimum: number[]): boolean {
  if (!version) return false;

  const parts = version.trim().replace(/^v/i, "").split(/[.\-+]/);

  for (let index = 0; index < minimum.length; index++) {
    const part = Number.parseInt(parts[index] ?? "", 10);
    if (Number.isNaN(part)) return false;
    if (part !== minimum[index]) return part > minimum[index];
  }

  return true;
}

/** MLX is Apple's framework and needs Apple's silicon: an Intel Mac has no unified memory and runs
 * the same GGUF builds a PC does. */
export function supportsMlx(target: RuntimeTarget = {}): boolean {
  return (
    target.platform === "darwin" &&
    target.arch === "arm64" &&
    atLeast(target.ollamaVersion, MLX_MIN_OLLAMA)
  );
}

export function ladderFor(target: RuntimeTarget = {}): ModelRecommendation[] {
  return supportsMlx(target) ? mlxLadder : ggufLadder;
}

/** What the ladder is climbed against. A Mac with its memory known ignores the VRAM argument
 * entirely, since unified memory is the only pool there: `getSystemSpecs` reports it as
 * `vram` too, but the ladder should be read against the real, whole number, not that copy. */
function effectiveBudget(vram: number, target: RuntimeTarget): number {
  const safeVram = Number.isFinite(vram) && vram > 0 ? vram : 0;

  if (supportsMlx(target)) {
    return target.ram && target.ram > 0 ? target.ram : safeVram;
  }

  if (!target.ram || target.ram <= 0) return safeVram;

  const ceiling = target.ram * USABLE_RAM_FRACTION;
  const floor = safeVram < 2 ? target.ram * CPU_ONLY_RAM_FRACTION : 0;
  return Math.min(Math.max(safeVram, floor), ceiling);
}

export function getRecommendedModel(vram: number, target: RuntimeTarget = {}): string {
  const ladder = ladderFor(target);
  const budget = effectiveBudget(vram, target);

  const climbing = [...ladder].sort((a, b) => a.vram - b.vram);
  const affordable = climbing.filter((entry) => entry.vram <= budget);
  if (affordable.length === 0) return climbing[0].model;

  // A wide-bandwidth Max or Ultra die pushes the same memory size through the model a base or Pro
  // chip would only just manage, so it takes the rung above what the raw number alone affords.
  const index = climbing.indexOf(affordable[affordable.length - 1]);
  const chipClass = supportsMlx(target) ? chipClassOf(target.cpuModel) : "base";
  const bump = chipClass === "max" || chipClass === "ultra" ? 1 : 0;

  return climbing[Math.min(index + bump, climbing.length - 1)].model;
}
