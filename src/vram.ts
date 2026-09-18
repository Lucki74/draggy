export interface FitInput {
  modelBytes: number;
  vramGB: number;
  unifiedMemory?: boolean;
}

export interface ModelFit {
  tone: "green" | "amber" | "red" | "unknown";
  gpuPercent: number;
  sizeGB: number;
  neededGB: number;
  usableGB: number;
}

const BYTES_PER_GB = 1024 ** 3;

export const RUNTIME_OVERHEAD_GB = 0.8;

export const USABLE_VRAM_FRACTION = 0.9;

export const USABLE_UNIFIED_FRACTION = 0.95;

export function describeFit(input: FitInput): ModelFit {
  const sizeGB = input.modelBytes / BYTES_PER_GB;
  const neededGB = sizeGB + RUNTIME_OVERHEAD_GB;

  if (!input.vramGB || input.vramGB <= 0) {
    return { tone: "unknown", gpuPercent: 0, sizeGB, neededGB, usableGB: 0 };
  }

  const usableGB =
    input.vramGB *
    (input.unifiedMemory ? USABLE_UNIFIED_FRACTION : USABLE_VRAM_FRACTION);

  const fraction = Math.min(1, usableGB / neededGB);
  const gpuPercent = Math.round(fraction * 100);

  return {
    tone: fraction >= 0.98 ? "green" : fraction >= 0.6 ? "amber" : "red",
    gpuPercent,
    sizeGB,
    neededGB,
    usableGB,
  };
}

export function describeSplit(fit: ModelFit): string {
  if (fit.tone === "unknown") return "";
  if (fit.gpuPercent >= 100) return "100% GPU";
  return `${fit.gpuPercent}% GPU / ${100 - fit.gpuPercent}% CPU`;
}
