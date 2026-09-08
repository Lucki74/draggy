export interface ModelRecommendation {
  vram: number;
  model: string;
  label: string;
  params: string;
}

/**
 * Enough about the machine to pick a ladder, and nothing else. Kept as plain
 * data so the choice can be tested without a Mac, a card or a running Ollama.
 */
export interface RuntimeTarget {
  platform?: string;
  arch?: string;
  ollamaVersion?: string | null;
}

export const MLX_MIN_OLLAMA = [0, 19];

export const mlxLadder: ModelRecommendation[] = [
  { vram: 4.0,  model: "qwen3.5:2b-mlx",   label: "Qwen 3.5 2B",   params: "2B"      },
  { vram: 5.0,  model: "qwen3.5:4b-mlx",   label: "Qwen 3.5 4B",   params: "4B"      },
  { vram: 10.0, model: "qwen3.5:9b-mlx",   label: "Qwen 3.5 9B",   params: "9B"      },
  { vram: 21.0, model: "qwen3.5:27b-mlx",  label: "Qwen 3.5 27B",  params: "27B MoE" },
  { vram: 23.0, model: "qwen3.5:35b-mlx",  label: "Qwen 3.5 35B",  params: "35B MoE" },
];

export const ggufLadder: ModelRecommendation[] = [
  { vram: 2.0,  model: "qwen3.5:0.8b",     label: "Qwen 3.5 0.8B", params: "0.8B"     },
  { vram: 4.0,  model: "qwen3.5:2b",       label: "Qwen 3.5 2B",   params: "2B"       },
  { vram: 5.0,  model: "qwen3.5:4b",       label: "Qwen 3.5 4B",   params: "4B"       },
  { vram: 8.0,  model: "qwen3.5:9b",       label: "Qwen 3.5 9B",   params: "9B"       },
  { vram: 10.0, model: "gemma4:12b",       label: "Gemma 4 12B",   params: "12B"      },
  { vram: 20.0, model: "qwen3.5:27b",      label: "Qwen 3.5 27B",  params: "27B MoE"  },
  { vram: 24.0, model: "gemma4:31b",       label: "Gemma 4 31B",   params: "31B"      },
  { vram: 32.0, model: "qwen3.5:35b",      label: "Qwen 3.5 35B",  params: "35B MoE"  },
  { vram: 96.0, model: "qwen3.5:122b",     label: "Qwen 3.5 122B", params: "122B MoE" },
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

/**
 * MLX is Apple's framework and needs Apple's silicon: an Intel Mac has no
 * unified memory and runs the same GGUF builds a PC does.
 */
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

export function getRecommendedModel(
  vram: number,
  target: RuntimeTarget = {},
): string {
  const ladder = ladderFor(target);

  const climbing = [...ladder].sort((a, b) => a.vram - b.vram);
  const affordable = climbing.filter((entry) => entry.vram <= vram);

  return (affordable[affordable.length - 1] ?? climbing[0]).model;
}
