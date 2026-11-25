export interface FitInput {
  modelBytes: number;
  vramGB: number;
  unifiedMemory?: boolean;
  /** System RAM in GB. Only `describeVerdict` reads it. */
  ramGB?: number;
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

/** The status dot beside a model, the same wherever a fit is shown. */
export const FIT_STATUS = { green: "ok", amber: "warn", red: "danger" } as const;

export function describeSplit(fit: ModelFit): string {
  if (fit.tone === "unknown") return "";
  if (fit.gpuPercent >= 100) return "100% GPU";
  return `${fit.gpuPercent}% GPU / ${100 - fit.gpuPercent}% CPU`;
}

export type FitVerdict = "fast" | "partial" | "exceeds" | "unknown";

/** Share of system RAM that spilled layers may use, leaving room for the OS and the KV cache. */
export const RAM_USABLE_FRACTION = 0.75;

/** Translation key for each verdict badge. */
export const FIT_VERDICT_KEY = {
  fast: "fitFast",
  partial: "fitPartial",
  exceeds: "fitExceeds",
} as const;

/** Whether a model runs fully on the card, spills into RAM, or fits in neither. */
export function describeVerdict(input: FitInput): FitVerdict {
  const fit = describeFit(input);
  if (fit.tone === "unknown") return "unknown";
  if (fit.gpuPercent >= 98) return "fast";
  const spillGB = Math.max(0, fit.neededGB - fit.usableGB);
  if (input.ramGB && input.ramGB > 0 && spillGB > input.ramGB * RAM_USABLE_FRACTION) return "exceeds";
  return "partial";
}

export interface MemoryLoad {
  tone: "green" | "amber" | "red" | "unknown";
  sizeGB: number;
  /** Model size plus runtime overhead, over all memory the machine has. */
  occupied: number;
}

/** Green up to 75% of total memory (VRAM plus RAM, never disk), amber up to 100%, red beyond. */
export function describeMemoryLoad(input: FitInput): MemoryLoad {
  const sizeGB = input.modelBytes / BYTES_PER_GB;
  const vram = input.vramGB > 0 ? input.vramGB : 0;
  const ram = input.ramGB && input.ramGB > 0 ? input.ramGB : 0;
  const totalGB = input.unifiedMemory ? Math.max(vram, ram) : vram + ram;
  if (totalGB <= 0) return { tone: "unknown", sizeGB, occupied: 0 };
  const occupied = (sizeGB + RUNTIME_OVERHEAD_GB) / totalGB;
  return { tone: occupied <= 0.75 ? "green" : occupied < 1 ? "amber" : "red", sizeGB, occupied };
}
