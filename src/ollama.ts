import type { ContextBreakdown } from "./agent/contextBreakdown";
import { safeJsonParse } from "./utils";

/** How long the GGUF engine is asked to keep a model resident. The engine itself has no such
 * setting; kept only so callers built around the idea need no changes. */
export const KEEP_ALIVE = "30m";

export const FALLBACK_CONTEXT_LENGTH = 8192;

export const CONTEXT_BUCKETS = [4096, 8192, 16384, 32768, 65536, 131072];

export interface ModelInfo {
  contextLength: number | null;
  capabilities: string[];
  parameterCount: number | null;
  quantization: string | null;
}

export interface GenerationMetrics {
  promptTokens: number;
  responseTokens: number;
  promptMs: number;
  responseMs: number;
  loadMs: number;
  totalMs: number;
  tokensPerSecond: number;
  timeToFirstTokenMs: number | null;
  contextWindow: number;
  model: string;
  gpuPercent: number | null;
  breakdown?: ContextBreakdown;
}

export interface LoadedModel {
  name: string;
  size: number;
  sizeVram: number;
  gpuPercent: number;
}

export interface InstalledModel {
  name: string;
  size: number;
  parameterSize: string;
  family: string;
  /** What the model can do, worked out from its chat template. Tools and completion for every model,
   * thinking for one whose template supports it. */
  capabilities: string[];
}

/** A model identifier with any leading "gguf:" stripped, matching the filename the engine was
 * given when it was started. */
function bareModelName(model: string): string {
  return model.toLowerCase().startsWith("gguf:") ? model.slice(5) : model;
}

const modelInfoCache = new Map<string, Promise<ModelInfo | null>>();

async function fetchModelInfo(model: string): Promise<ModelInfo | null> {
  if (typeof window === "undefined") return null;

  try {
    const models = await window.electronAPI?.gguf?.listModels();
    if (!Array.isArray(models)) return null;

    const target = bareModelName(model);
    const entry = models.find((m) => m.filename === target || m.filename === model);
    if (!entry) return null;

    return {
      contextLength: entry.contextLength,
      capabilities: entry.capabilities ?? ["tools", "completion"],
      parameterCount: null,
      quantization: entry.fileType !== null && entry.fileType !== undefined ? String(entry.fileType) : null,
    };
  } catch {
    return null;
  }
}

/** A model's capabilities from the last probe, kept in the database, so a slow start at launch
 * does not drop a capable model into text mode. */
const CAPABILITY_KEY = "modelCapabilities";

let rememberedCapabilities: Record<string, string[]> | null = null;

async function capabilityRecord(): Promise<Record<string, string[]>> {
  if (rememberedCapabilities) return rememberedCapabilities;

  // The voice worker and the tests run this module without a window at all.
  if (typeof window === "undefined") return (rememberedCapabilities = {});

  // A stub bridge in a test has a `db` with nothing in it, so the function
  // itself is what has to be checked, not just the object holding it.
  const get = window.electronAPI?.db?.get;

  const stored =
    typeof get === "function"
      ? await get(CAPABILITY_KEY).catch(() => undefined)
      : undefined;

  rememberedCapabilities =
    (stored?.value ? safeJsonParse<Record<string, string[]>>(stored.value) : null) ??
    {};

  return rememberedCapabilities;
}

async function rememberCapabilities(model: string, capabilities: string[]) {
  const record = await capabilityRecord();

  const known = record[model];
  if (known && known.join() === capabilities.join()) return;

  record[model] = capabilities;
  if (typeof window === "undefined") return;

  const set = window.electronAPI?.db?.set;
  if (typeof set !== "function") return;

  await set(CAPABILITY_KEY, JSON.stringify(record)).catch(() => undefined);
}

export async function recalledCapabilities(model: string): Promise<string[]> {
  return (await capabilityRecord())[model] ?? [];
}

export function getModelInfo(model: string): Promise<ModelInfo | null> {
  const cached = modelInfoCache.get(model);
  if (cached) return cached;

  const pending = fetchModelInfo(model).then(async (value) => {
    if (value === null) {
      modelInfoCache.delete(model);
      return value;
    }

    await rememberCapabilities(model, value.capabilities);
    return value;
  });

  modelInfoCache.set(model, pending);
  return pending;
}

export function forgetModelInfo(model: string) {
  modelInfoCache.delete(model);
}

export function hasCapability(
  info: ModelInfo | null,
  capability: string,
): boolean {
  return info?.capabilities.includes(capability) ?? false;
}

export function needsTextModeTools(info: ModelInfo | null): boolean {
  return info !== null && !hasCapability(info, "tools");
}

/** How far a model's window can grow: its own maximum, or the fallback a turn is held to without one.
 * Never less than what is already loaded. */
export function windowCeiling(maxContext: number | null, loaded = 0): number {
  return Math.max(loaded, maxContext ?? FALLBACK_CONTEXT_LENGTH);
}

export function pickContextSize(
  charEstimate: number,
  maxContext: number | null,
): number {
  const cap = windowCeiling(maxContext);
  const needed = Math.ceil(charEstimate / 4) + 2048;

  for (const bucket of CONTEXT_BUCKETS) {
    if (bucket >= needed) return Math.min(bucket, cap);
  }
  return cap;
}

/** The window each model is loaded at. Changing context size restarts the server,
 * so it is kept once per model and only resets when fixed settings change. */
const loadedContextSizes = new Map<string, number>();
let activeFixedContext: number | "max" | null | undefined;

function syncFixedContext(fixedContext?: number | "max" | null): void {
  if (fixedContext !== activeFixedContext) {
    loadedContextSizes.clear();
    activeFixedContext = fixedContext;
  }
}

export function contextSizeFor(
  model: string,
  charEstimate: number,
  maxContext: number | null,
  fixedContext?: number | "max" | null,
): number {
  syncFixedContext(fixedContext);
  if (fixedContext === "max") {
    const size = maxContext ?? FALLBACK_CONTEXT_LENGTH;
    loadedContextSizes.set(model, size);
    return size;
  }
  if (typeof fixedContext === "number") {
    loadedContextSizes.set(model, fixedContext);
    return fixedContext;
  }
  const size = Math.max(
    loadedContextSizes.get(model) ?? 0,
    pickContextSize(charEstimate, maxContext),
  );
  loadedContextSizes.set(model, size);
  return size;
}

/** The window a turn would ask for, without committing to it. For a look that must not grow the
 * tally, and with it force a reload later. */
export function peekContextSize(
  model: string,
  charEstimate: number,
  maxContext: number | null,
  fixedContext?: number | "max" | null,
): number {
  if (fixedContext === "max") {
    return maxContext ?? FALLBACK_CONTEXT_LENGTH;
  }
  if (typeof fixedContext === "number") {
    return fixedContext;
  }
  return Math.max(loadedContextSizes.get(model) ?? 0, pickContextSize(charEstimate, maxContext));
}

/** Requests generating right now, anywhere in the app. A measurement waits for none of them and
 * gives way to all of them, so it never slows a reply. */
let generating = 0;
const workListeners = new Set<() => void>();

export function beginOllamaWork(): () => void {
  generating++;
  for (const listener of workListeners) listener();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    generating--;
    for (const listener of workListeners) listener();
  };
}

export const ollamaIsBusy = () => generating > 0;

export function onOllamaWork(listener: () => void): () => void {
  workListeners.add(listener);
  return () => {
    workListeners.delete(listener);
  };
}

export function forgetContextSize(model: string) {
  loadedContextSizes.delete(model);
}

export function isCloudModel(name: string): boolean {
  const tag = name.toLowerCase().split(":").pop() || "";
  return tag === "cloud" || tag.endsWith("-cloud");
}

export async function listInstalledModels(): Promise<InstalledModel[]> {
  if (typeof window === "undefined") return [];

  try {
    const models = await window.electronAPI?.gguf?.listModels();
    if (!Array.isArray(models)) return [];

    return models.map((m) => ({
      name: m.filename,
      size: m.size,
      parameterSize: m.blockCount ? `${m.blockCount}L` : "",
      family: m.architecture || "gguf",
      capabilities: m.capabilities ?? ["tools", "completion"],
    }));
  } catch {
    return [];
  }
}

/** The model the GGUF engine currently has loaded, if any. Only ever one at a time, so the list
 * is at most a single entry. */
export async function describeLoadedModels(): Promise<LoadedModel[]> {
  if (typeof window === "undefined") return [];

  try {
    const status = await window.electronAPI?.gguf?.status();
    if (!status?.running || !status.model) return [];
    return [{ name: status.model, size: 0, sizeVram: 0, gpuPercent: 0 }];
  } catch {
    return [];
  }
}

export async function gpuShareFor(model: string): Promise<number | null> {
  const loaded = await describeLoadedModels();
  const target = bareModelName(model);
  const match = loaded.find((entry) => entry.name === target || entry.name === model);
  return match ? match.gpuPercent : null;
}

/** Stops the GGUF engine, which unloads whatever model it was holding. */
export async function unloadModel(_model: string): Promise<void> {
  if (typeof window === "undefined") return;
  await window.electronAPI?.gguf?.stop();
}

/** Whether the model is already loaded at this window. Null when the engine could not say. */
export async function isLoadedAt(
  model: string,
  contextSize: number,
): Promise<boolean | null> {
  if (typeof window === "undefined") return null;

  try {
    const status = await window.electronAPI?.gguf?.status();
    if (!status) return null;
    if (!status.running || !status.model) return false;

    const target = bareModelName(model);
    if (status.model !== target && status.model !== model) return false;

    return status.contextSize === contextSize;
  } catch {
    return null;
  }
}

const NS_PER_MS = 1e6;

export function readMetrics(
  chunk: Record<string, unknown>,
  model: string,
  contextWindow: number,
  timeToFirstTokenMs: number | null,
): GenerationMetrics | null {
  const responseTokens = Number(chunk.eval_count) || 0;
  const responseNs = Number(chunk.eval_duration) || 0;
  if (responseTokens === 0 && responseNs === 0) return null;

  const responseMs = responseNs / NS_PER_MS;

  return {
    promptTokens: Number(chunk.prompt_eval_count) || 0,
    responseTokens,
    promptMs: (Number(chunk.prompt_eval_duration) || 0) / NS_PER_MS,
    responseMs,
    loadMs: (Number(chunk.load_duration) || 0) / NS_PER_MS,
    totalMs: (Number(chunk.total_duration) || 0) / NS_PER_MS,
    tokensPerSecond: responseMs > 0 ? (responseTokens / responseMs) * 1000 : 0,
    timeToFirstTokenMs,
    contextWindow,
    model,
    gpuPercent: null,
  };
}

export function mergeMetrics(
  a: GenerationMetrics | null,
  b: GenerationMetrics | null,
): GenerationMetrics | null {
  if (!a) return b;
  if (!b) return a;

  const responseTokens = a.responseTokens + b.responseTokens;
  const responseMs = a.responseMs + b.responseMs;

  return {
    promptTokens: Math.max(a.promptTokens, b.promptTokens),
    responseTokens,
    promptMs: a.promptMs + b.promptMs,
    responseMs,
    loadMs: Math.max(a.loadMs, b.loadMs),
    totalMs: a.totalMs + b.totalMs,
    tokensPerSecond: responseMs > 0 ? (responseTokens / responseMs) * 1000 : 0,
    timeToFirstTokenMs: a.timeToFirstTokenMs ?? b.timeToFirstTokenMs,
    contextWindow: Math.max(a.contextWindow, b.contextWindow),
    model: a.model,
    gpuPercent: b.gpuPercent ?? a.gpuPercent,
  };
}

/** What the prompt and tool catalogue add to a turn: 5.4 to 8.5 KB, so this is the middle. Guessing
 * low costs one reload; guessing high spills to the CPU. */
const SYSTEM_PROMPT_CHARS = 6000;

/** Starts the engine on this model ahead of a turn, at the size that turn will ask for. Warming
 * without `charEstimate` did not merely waste time: it forced a reload. */
export async function warmModel(
  name: string,
  _keepAlive: string,
  charEstimate = 0,
  fixedContext?: number | "max" | null,
): Promise<void> {
  if (typeof window === "undefined") return;

  const info = await getModelInfo(name);
  const numCtx = contextSizeFor(
    name,
    charEstimate + SYSTEM_PROMPT_CHARS,
    info?.contextLength ?? null,
    fixedContext,
  );

  await window.electronAPI?.gguf?.start({
    modelPath: bareModelName(name),
    contextSize: numCtx,
  });
}

export async function deleteModel(name: string): Promise<void> {
  if (typeof window === "undefined") throw new Error(`Could not remove ${name}`);

  const removed = await window.electronAPI?.gguf?.deleteModel(bareModelName(name));
  if (!removed) throw new Error(`Could not remove ${name}`);

  forgetModelInfo(name);
  forgetContextSize(name);
}

/** What a download is doing, as the GGUF engine reports it. */
export type PullPhase = "preparing" | "downloading" | "done";

/** The translation key each phase is shown as, so every screen that downloads a model words it the
 * same way. */
export const PULL_PHASE_KEYS: Record<PullPhase, string> = {
  preparing: "preparingDownload",
  downloading: "downloadingModel",
  done: "verifyingDownload",
};

export interface PullProgress {
  phase: PullPhase;
  /** Bytes transferred so far. */
  completed: number;
  /** Bytes to transfer in total. */
  total: number;
  /** 0 to 100 for the download as a whole. */
  percent: number;
  /** Estimated seconds until the download finishes, or null while there is no speed to go on. */
  remainingSeconds?: number | null;
}

/** Downloads a GGUF model from Hugging Face or direct URL and tracks progress until complete. */
export async function pullModel(
  reference: string,
  onProgress: (progress: PullProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (typeof window === "undefined" || !window.electronAPI?.gguf) {
    throw new Error("Downloading a model requires the desktop app.");
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  let downloadUrl = reference;
  let filename = reference.split("/").pop() || "model.gguf";

  if (!reference.startsWith("http://") && !reference.startsWith("https://")) {
    const resolved = await window.electronAPI.resolveModelUrl?.(reference);
    if (resolved?.url) {
      downloadUrl = resolved.url;
      filename = resolved.filename;
    }
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const unsubscribe = window.electronAPI.gguf.onProgress((progress) => {
    // Downloads run side by side on one channel, and the engine setup reports here too.
    if (progress.label && progress.label !== filename) return;
    onProgress({
      phase: progress.phase,
      completed: progress.completed,
      total: progress.total,
      percent: progress.percent,
      remainingSeconds: progress.remainingSeconds,
    });
  });

  try {
    const download = window.electronAPI.gguf.downloadModel({ url: downloadUrl, filename });
    const result = signal
      ? await Promise.race([
          download,
          new Promise<never>((_, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                window.electronAPI?.gguf?.cancelDownload?.(filename)?.catch(() => undefined);
                reject(new DOMException("Aborted", "AbortError"));
              },
              { once: true },
            );
          }),
        ])
      : await download;

    if (!result?.success) throw new Error(`Could not download ${filename}`);
  } finally {
    unsubscribe?.();
  }
}
