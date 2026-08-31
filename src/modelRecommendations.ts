export interface ModelRecommendation {
  vram: number;
  model: string;
  label: string;
  params: string;
}

export const modelRecommendations: ModelRecommendation[] = [
  { vram: 0.5,  model: "smollm2:360m",       label: "SmolLM2 360M",         params: "360M"    },
  { vram: 1.0,  model: "qwen3:0.6b",         label: "Qwen 3 0.6B",         params: "0.6B"    },
  { vram: 1.5,  model: "qwen3:1.7b",         label: "Qwen 3 1.7B",         params: "1.7B"    },
  { vram: 2.0,  model: "gemma4:e2b",          label: "Gemma 4 E2B",         params: "2B eff." },
  { vram: 3.0,  model: "llama3.2:3b",         label: "Llama 3.2 3B",        params: "3B"      },
  { vram: 4.0,  model: "phi4-mini",            label: "Phi-4 Mini",          params: "3.8B"    },
  { vram: 5.0,  model: "qwen3:4b",            label: "Qwen 3 4B",           params: "4B"      },
  { vram: 6.0,  model: "gemma4:e4b",           label: "Gemma 4 E4B",         params: "4B eff." },
  { vram: 8.0,  model: "qwen3:8b",            label: "Qwen 3 8B",           params: "8B"      },
  { vram: 10.0, model: "gemma4:12b",           label: "Gemma 4 12B",         params: "12B"     },
  { vram: 12.0, model: "phi4",                 label: "Phi-4",               params: "14B"     },
  { vram: 14.0, model: "qwen3:14b",           label: "Qwen 3 14B",          params: "14B"     },
  { vram: 16.0, model: "gemma4:26b",           label: "Gemma 4 26B MoE",     params: "26B MoE" },
  { vram: 20.0, model: "qwen3:32b",           label: "Qwen 3 32B",          params: "32B"     },
  { vram: 24.0, model: "gemma4:31b",           label: "Gemma 4 31B",         params: "31B"     },
  { vram: 48.0, model: "qwen3:235b-a22b",     label: "Qwen 3 235B MoE",     params: "235B MoE"},
];

export function getRecommendedModel(vram: number): string {
  const sorted = [...modelRecommendations]
    .filter((r) => r.vram <= vram)
    .sort((a, b) => a.vram - b.vram);

  const recommendation = sorted[sorted.length - 1];
  return recommendation ? recommendation.model : "qwen3:0.6b";
}
