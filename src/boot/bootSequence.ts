import type { SystemSpecs } from "../types";
import { getRecommendedDownload, ggufLadder, type ModelRecommendation } from "../modelRecommendations";
import { selectableModels } from "../modelKinds";
import { describeInstalled, isCloudModel, pullModel } from "../llama";
import { describeFit, type ModelFit } from "../vram";

/** The start of a new install, shared by the splash, the setup's Skip and its Ready screen. Each
 * step takes the bridge, so it runs the same wherever it is called from. */

type Api = NonNullable<Window["electronAPI"]>;

export type BootBridge = Partial<
  Pick<Api, "getSystemSpecs" | "checkInternet" | "checkDiskSpace" | "resolveModelUrl">
> & { gguf?: Api["gguf"] };

export interface BootProgress {
  percent: number;
  completed: number;
  total: number;
  label: string;
}

/** Null clears the bar, as the splash does once the engine is in place. */
export type ProgressFn = (progress: BootProgress | null) => void;

/** Receives translation keys, so each screen words them in its own language. */
export type StatusFn = (key: string) => void;

/** A failure worth a sentence: a translation key, what it was about, and whether it is the disk. */
export class BootError extends Error {
  readonly key: string;
  readonly detail?: string;
  readonly disk: boolean;

  constructor(key: string, detail?: string, disk = false) {
    super(detail ? `${key}: ${detail}` : key);
    this.name = "BootError";
    this.key = key;
    this.detail = detail;
    this.disk = disk;
  }
}

/** What the splash prints for a failure: the key's sentence, the detail after it, or the error's own words. */
export function bootErrorText(error: unknown, t: (key: string) => string): string {
  if (error instanceof BootError) return error.detail !== undefined ? `${t(error.key)}: ${error.detail}` : t(error.key);
  return error instanceof Error ? error.message : t("initializationFailed");
}

export interface EngineResult {
  ready: boolean;
  /** True when it had to be set up during this call. */
  installed: boolean;
}

export async function ensureEngine(
  api: BootBridge,
  onProgress: ProgressFn,
  onStatus?: StatusFn,
): Promise<EngineResult> {
  let status = await api.gguf?.status();
  if (status?.hasBinary && status?.ready) return { ready: true, installed: false };

  onStatus?.("installingService");
  onProgress({ percent: 0, completed: 0, total: 100, label: "AI Engine" });
  await api.gguf?.setupEngine?.();

  status = await api.gguf?.status();
  if (!status?.hasBinary || !status?.ready) return { ready: false, installed: false };
  onProgress(null);
  return { ready: true, installed: true };
}

/** The saved model if it is on disk, else the first one that can chat. An embedding model cannot answer anything. */
export async function adoptInstalled(api: BootBridge, preferred: string): Promise<string | null> {
  const listing = await Promise.resolve()
    .then(() => api.gguf?.listModels())
    .catch(() => []);
  const installed = describeInstalled(listing);
  if (preferred && installed.some((entry) => entry.name === preferred)) return preferred;
  return selectableModels(installed)[0]?.name ?? null;
}

/** Free space as the splash has always read it: small numbers are gigabytes, and zero means unknown. */
export function normalizeFreeBytes(freeSpace: unknown): number {
  if (typeof freeSpace !== "number" || freeSpace <= 0) return 0;
  return freeSpace < 100_000 ? freeSpace * 1024 ** 3 : freeSpace;
}

/** Room for the download and what it unpacks next to it. Unknown free space never refuses. */
export function fitsOnDisk(freeBytes: number, sizeBytes: number): boolean {
  return freeBytes === 0 || freeBytes >= sizeBytes * 1.5;
}

export interface DownloadOption {
  reference: string;
  label: string;
  params: string;
  sizeBytes: number;
  fit: ModelFit;
  fitsOnDisk: boolean;
}

export interface FirstDownloadPlan {
  specs: SystemSpecs | null;
  recommended: DownloadOption;
  lighter?: DownloadOption;
  stronger?: DownloadOption;
  freeBytes: number;
}

const byBudget = [...ggufLadder].sort((a, b) => a.vram - b.vram);

function optionFor(rung: ModelRecommendation, specs: SystemSpecs | null, freeBytes: number): DownloadOption {
  const sizeBytes = Math.round(rung.sizeGB * 1e9);
  return {
    reference: rung.model,
    label: rung.label,
    params: rung.params,
    sizeBytes,
    fit: describeFit({ modelBytes: sizeBytes, vramGB: specs?.vram || 0, unifiedMemory: specs?.unifiedMemory }),
    fitsOnDisk: fitsOnDisk(freeBytes, sizeBytes),
  };
}

/** The splash's own choice, plus the rung either side of it. The one above is left out when it would not run. */
export function planFromSpecs(specs: SystemSpecs | null, freeBytes: number): FirstDownloadPlan {
  const target = getRecommendedDownload(specs?.vram || 0, {
    platform: specs?.platform,
    arch: specs?.arch,
    ram: specs?.ram,
    cpuModel: specs?.cpu,
  });
  const index = byBudget.findIndex((rung) => rung.model === target.reference);
  const rung = byBudget[index] ?? byBudget[0];

  const recommended = optionFor(rung, specs, freeBytes);
  const lighter = index > 0 ? optionFor(byBudget[index - 1], specs, freeBytes) : undefined;
  const above = index >= 0 && index < byBudget.length - 1 ? optionFor(byBudget[index + 1], specs, freeBytes) : undefined;
  const stronger = above && above.fit.tone !== "red" ? above : undefined;

  return { specs, recommended, lighter, stronger, freeBytes };
}

export async function planFirstDownload(api: BootBridge): Promise<FirstDownloadPlan> {
  const specs = (await api.getSystemSpecs?.()) ?? null;
  const freeBytes = normalizeFreeBytes(await api.checkDiskSpace?.());
  return planFromSpecs(specs, freeBytes);
}

type Resolved = NonNullable<Awaited<ReturnType<Api["resolveModelUrl"]>>>;

async function transfer(
  reference: string,
  resolved: Resolved,
  onProgress: ProgressFn,
  signal?: AbortSignal,
): Promise<string> {
  try {
    await pullModel(
      reference,
      (progress) =>
        onProgress({
          percent: progress.percent,
          completed: progress.completed,
          total: progress.total,
          label: resolved.filename,
        }),
      signal,
    );
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new BootError("downloadFailed", err instanceof Error ? err.message : "");
  }
  return resolved.filename;
}

/** Resolves to the file the model was saved as, which is what settings remember it by. */
export async function downloadModel(
  api: BootBridge,
  reference: string,
  onProgress: ProgressFn,
  signal?: AbortSignal,
): Promise<string> {
  const resolved = await api.resolveModelUrl?.(reference);
  if (!resolved?.url) throw new BootError("downloadFailed", reference);
  onProgress({ percent: 0, completed: 0, total: resolved.size ?? 0, label: resolved.filename });
  return transfer(reference, resolved, onProgress, signal);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 700));

/** Today's first launch in one call: engine, the installed model, else the recommended one downloaded. */
export async function autoSetup(
  api: BootBridge,
  preferred: string,
  onStatus: StatusFn,
  onProgress: ProgressFn,
): Promise<string> {
  const saved = isCloudModel(preferred) ? "" : preferred;

  onStatus("checkingService");
  const engine = await ensureEngine(api, onProgress, onStatus);
  if (!engine.ready) throw new BootError("missingGgufEngine");

  onStatus("verifyingAssets");
  const installed = await adoptInstalled(api, saved);
  if (installed) {
    onStatus("startingService");
    onStatus("systemCheckComplete");
    await settle();
    return installed;
  }

  onStatus("checkingHardware");
  const specs = await api.getSystemSpecs?.();
  const target = getRecommendedDownload(specs?.vram || 0, {
    platform: specs?.platform,
    arch: specs?.arch,
    ram: specs?.ram,
    cpuModel: specs?.cpu,
  });

  onStatus("checkingInternet");
  if (!(await api.checkInternet?.())) throw new BootError("noInternetConnection");

  onStatus("checkingDisk");
  const freeBytes = normalizeFreeBytes(await api.checkDiskSpace?.());
  if (!fitsOnDisk(freeBytes, target.size)) throw new BootError("notEnoughSpace", undefined, true);

  onStatus("preparingDownload");
  const resolved = await api.resolveModelUrl?.(target.reference);
  if (!resolved?.url) throw new BootError("downloadFailed", target.label);
  onProgress({ percent: 0, completed: 0, total: resolved.size ?? target.size, label: resolved.filename });

  onStatus("downloadingModel");
  const filename = await transfer(target.reference, resolved, onProgress);

  onStatus("installingService");
  onStatus("systemCheckComplete");
  await settle();
  return filename;
}
