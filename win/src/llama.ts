import type { ContextBreakdown } from "./agent/contextBreakdown";
import { isRemote, parseRef, remoteModelInfo } from "./ai/providers";
import { safeJsonParse } from "./utils";
import type { PromptProfile } from "./prompts";
import { newCorrelationId, swallowed } from "./logger";

/** How long the GGUF engine is asked to keep a model resident. The engine itself has no such
 * setting; kept only so callers built around the idea need no changes. */
export const KEEP_ALIVE = "30m";

export const FALLBACK_CONTEXT_LENGTH = 8192;

export const CONTEXT_BUCKETS = [4096, 8192, 16384, 32768, 65536, 131072, 262144];

export interface ModelInfo {
  contextLength: number | null;
  capabilities: string[];
  parameterCount: number | null;
  quantization: string | null;
  /** A provider's model only; the built-in engine always gets the compact prompt. */
  promptProfile?: PromptProfile;
  /** A provider's model that runs on someone else's servers, and is billed or counted there. */
  cloud?: boolean;
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
  /** What the window held when the turn ended: the last pass's prompt and reply. */
  contextTokens?: number;
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
  contextLength?: number | null;
  /** The weight format. A record without it is GGUF. MLX models exist only on Apple silicon Macs. */
  format?: "gguf" | "mlx";
}

/** A model identifier with any leading "gguf:" stripped, matching the filename the engine was
 * given when it was started. */
function bareModelName(model: string): string {
  return model.toLowerCase().startsWith("gguf:") ? model.slice(5) : model;
}

/** The engine reports the full path of the file it serves; the app names models by file name. */
function servedFileName(served: string): string {
  return served.split(/[\\/]/).pop() || served;
}

/** The quantization a GGUF file name carries, such as Q4_K_M or BF16. */
export function quantizationOf(name: string): string {
  const match = name.match(/(?:^|[-_.:])(I?Q\d(?:_[A-Z0-9]+)*|BF16|F16|F32)(?=$|[-.])/i);
  return match ? match[1].toUpperCase() : "";
}

/** A model's name as shown to people: a split model's part counter says nothing to whoever picks it,
 * nor a provider's `@instance/` prefix, which the pill's icon and title name instead. */
export function displayModelName(model: string): string {
  const ref = parseRef(model);
  if (ref.kind === "remote") return ref.modelId || model;
  return model
    .replace(/-\d{5}-of-\d{5}(?=\.gguf$)/i, "")
    .replace(/\.gguf$/i, "")
    .replace(/[-_.](?:I?Q\d(?:_[A-Z0-9]+)*|BF16|F16|F32)$/i, "");
}

/** Formats a model's context ceiling into a compact label, such as "128k" or "8k". */
export function formatContextCeiling(tokens: number): string {
  if (tokens >= 1024 && tokens % 1024 === 0) {
    const k = tokens / 1024;
    if (k >= 1024 && k % 1024 === 0) return `${k / 1024}M`;
    return `${k}k`;
  }
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return String(tokens);
}

/** Labels for installed models, numbering duplicates with the same clean name and parameters
 * so different quants or ceilings remain distinct. */
export function installedModelDisplayNames(models: InstalledModel[]): Map<string, string> {
  const counts = new Map<string, number>();
  const names = new Map<string, string>();
  for (const model of models) {
    const base = displayModelName(model.name);
    const key = `${base.toLowerCase()}::${(model.parameterSize || "").toLowerCase()}`;
    const seen = counts.get(key) || 0;
    counts.set(key, seen + 1);
    names.set(model.name, seen === 0 ? base : `${base} (${seen})`);
  }
  return names;
}

/** The short name people recognise: no extension, quantisation tag or split counter, dashes as spaces. */
export function modelLabel(model: string): string {
  const name = displayModelName(model);
  const ref = parseRef(model);
  if (ref.kind === "remote") return name;
  const short = name.replace(/[-_]+/g, " ").trim();
  return short || name;
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
      ? await get(CAPABILITY_KEY).catch(swallowed("app", "the capability cache is optional"))
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

  await set(CAPABILITY_KEY, JSON.stringify(record)).catch(swallowed("app", "the capability cache is optional"));
}

export async function recalledCapabilities(model: string): Promise<string[]> {
  return (await capabilityRecord())[model] ?? [];
}

export function getModelInfo(model: string): Promise<ModelInfo | null> {
  const cached = modelInfoCache.get(model);
  if (cached) return cached;
  // A provider's model is described by its provider's listing, which main keeps for a day.
  if (isRemote(model)) {
    const remote = remoteModelInfo(model).then((found) => {
      if (!found) modelInfoCache.delete(model);
      return found
        ? { contextLength: found.contextLength, capabilities: found.capabilities, parameterCount: null, quantization: null, promptProfile: found.promptProfile, cloud: found.cloud }
        : null;
    });
    modelInfoCache.set(model, remote);
    return remote;
  }

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

const modelInfoListeners = new Set<() => void>();

/** Runs when what a model can do has changed under a screen that already asked. Returns the way to stop. */
export function onModelInfoChange(listener: () => void): () => void {
  modelInfoListeners.add(listener);
  return () => modelInfoListeners.delete(listener);
}

/** A provider was set up, changed or removed: what its models can do is asked again, by every screen. */
export function forgetRemoteModelInfo() {
  for (const model of [...modelInfoCache.keys()]) if (isRemote(model)) modelInfoCache.delete(model);
  for (const listener of modelInfoListeners) listener();
}

/** Whether an image projector's refusal at start-up should take vision off this model. The listing
 * cannot know: only the engine can say whether it reads the projector beside a model. */
export function noteEngineStart(
  model: string,
  started?: { projectorRefused?: boolean; contextSize?: number } | null,
) {
  // The engine may load a bigger window than asked when the card has room. Asking for that one from
  // now on keeps every later start a reuse, and the meter honest.
  if (started?.contextSize && started.contextSize > (loadedContextSizes.get(model) ?? 0)) {
    loadedContextSizes.set(model, started.contextSize);
  }
  if (!started?.projectorRefused) return;
  forgetModelInfo(model);
  for (const listener of modelInfoListeners) listener();
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
  return Math.min(cap, CONTEXT_BUCKETS[CONTEXT_BUCKETS.length - 1]);
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
  // A provider holds the whole window already: no buckets to grow through, and nothing to reload.
  if (isRemote(model)) return maxContext ?? FALLBACK_CONTEXT_LENGTH;
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

/** The next window above the one loaded, or null when the model cannot go higher. */
export function nextContextSize(model: string, maxContext: number | null, from = 0): number | null {
  if (isRemote(model)) return null;
  const loaded = Math.max(from, loadedContextSizes.get(model) ?? 0);
  const cap = windowCeiling(maxContext);
  return CONTEXT_BUCKETS.find((bucket) => bucket > loaded && bucket <= cap) ?? null;
}

/** Raises the window the next turn loads at, so a cut reply can continue instead of being cut again. */
export function growContext(model: string, maxContext: number | null, from = 0): number | null {
  const next = nextContextSize(model, maxContext, from);
  if (next !== null) loadedContextSizes.set(model, next);
  return next;
}

/** The window a turn would ask for, without committing to it. For a look that must not grow the
 * tally, and with it force a reload later. */
export function peekContextSize(
  model: string,
  charEstimate: number,
  maxContext: number | null,
  fixedContext?: number | "max" | null,
): number {
  if (isRemote(model) || fixedContext === "max") {
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

/** `model` leaves a provider's turn out of the count: it never touches the engine, so it neither
 * waits for local work nor holds it up. */
export function beginLlamaWork(model?: string): () => void {
  if (model && isRemote(model)) return () => {};
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

export const llamaIsBusy = () => generating > 0;

export function onLlamaWork(listener: () => void): () => void {
  workListeners.add(listener);
  return () => {
    workListeners.delete(listener);
  };
}

export function forgetContextSize(model: string) {
  loadedContextSizes.delete(model);
}

type GgufListing = Awaited<ReturnType<NonNullable<NonNullable<Window["electronAPI"]>["gguf"]>["listModels"]>>;

/** The engine's listing in the shape the rest of the app reads; empty for anything but a list. */
export function describeInstalled(models: GgufListing | null | undefined): InstalledModel[] {
  if (!Array.isArray(models)) return [];
  return models.map((m) => ({
    name: m.filename,
    size: m.size,
    parameterSize: m.blockCount ? `${m.blockCount}L` : "",
    family: m.architecture || "gguf",
    capabilities: m.capabilities ?? ["tools", "completion"],
    contextLength: m.contextLength ?? null,
  }));
}

export async function listInstalledModels(): Promise<InstalledModel[]> {
  if (typeof window === "undefined") return [];

  try {
    return describeInstalled(await window.electronAPI?.gguf?.listModels());
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
    return [{ name: servedFileName(status.model), size: 0, sizeVram: 0, gpuPercent: 0 }];
  } catch {
    return [];
  }
}

export async function gpuShareFor(model: string): Promise<number | null> {
  if (isRemote(model)) return null;
  const loaded = await describeLoadedModels();
  const target = bareModelName(model);
  const match = loaded.find((entry) => entry.name === target || entry.name === model);
  return match ? match.gpuPercent : null;
}

/** Stops the GGUF engine, which unloads whatever model it was holding. A provider's model is not in
 * it, and stopping the engine for one would take the local model away instead. */
export async function unloadModel(model: string): Promise<void> {
  if (typeof window === "undefined" || isRemote(model)) return;
  await window.electronAPI?.gguf?.stop();
}

/** Whether the model is already loaded at this window. Null when the engine could not say. */
export async function isLoadedAt(
  model: string,
  contextSize: number,
): Promise<boolean | null> {
  // Nothing loads locally for a provider's model, so no loading step is shown for one.
  if (isRemote(model)) return true;
  if (typeof window === "undefined") return null;

  try {
    const status = await window.electronAPI?.gguf?.status();
    if (!status) return null;
    if (!status.running || !status.model) return false;

    const target = bareModelName(model);
    const served = servedFileName(status.model);
    if (status.model !== target && status.model !== model && served !== target) return false;

    // A bigger window serves a smaller request: the engine reuses it rather than reloading.
    return status.contextSize >= contextSize;
  } catch {
    return null;
  }
}

/** Whether the engine holds this model at a smaller window, so loading it at `contextSize` is an extension. */
export async function isExtendingContext(model: string, contextSize: number): Promise<boolean> {
  if (isRemote(model) || typeof window === "undefined") return false;
  try {
    const status = await window.electronAPI?.gguf?.status();
    if (!status?.running || !status.model) return false;
    const target = bareModelName(model);
    const same = status.model === target || status.model === model || servedFileName(status.model) === target;
    return same && status.contextSize < contextSize;
  } catch {
    return false;
  }
}

const NS_PER_MS = 1e6;

export function readMetrics(
  chunk: Record<string, unknown>,
  model: string,
  contextWindow: number,
  timeToFirstTokenMs: number | null,
  durationFallbackMs?: number,
): GenerationMetrics | null {
  const responseTokens = Number(chunk.eval_count) || 0;
  const responseNs = Number(chunk.eval_duration) || 0;
  if (responseTokens === 0 && responseNs === 0) return null;

  const responseMs = responseNs > 0
    ? responseNs / NS_PER_MS
    : (durationFallbackMs !== undefined && durationFallbackMs > 0 ? durationFallbackMs : 0);

  const promptNs = Number(chunk.prompt_eval_duration) || 0;
  const promptMs = promptNs > 0
    ? promptNs / NS_PER_MS
    : (timeToFirstTokenMs !== null && timeToFirstTokenMs > 0 ? timeToFirstTokenMs : 0);

  const loadMs = (Number(chunk.load_duration) || 0) / NS_PER_MS;
  const totalNs = Number(chunk.total_duration) || 0;
  const totalMs = totalNs > 0 ? totalNs / NS_PER_MS : promptMs + responseMs + loadMs;

  return {
    promptTokens: Number(chunk.prompt_eval_count) || 0,
    responseTokens,
    promptMs,
    responseMs,
    loadMs,
    totalMs,
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
  if (typeof window === "undefined" || isRemote(name)) return;

  const info = await getModelInfo(name);
  const numCtx = contextSizeFor(
    name,
    charEstimate + SYSTEM_PROMPT_CHARS,
    info?.contextLength ?? null,
    fixedContext,
  );

  const started = await window.electronAPI?.gguf?.start({
    modelPath: bareModelName(name),
    contextSize: numCtx,
    exactContext: typeof fixedContext === "number",
  });
  noteEngineStart(name, started);
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

/** One file of a download; a model split into parts has several. */
interface DownloadPart {
  url: string;
  filename: string;
  size?: number;
}

/** Downloads a GGUF model from Hugging Face or direct URL and tracks progress until complete. A model
 * split into parts is fetched part by part and reported as one download. */
export async function pullModel(
  reference: string,
  onProgress: (progress: PullProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (typeof window === "undefined" || !window.electronAPI?.gguf) {
    throw new Error("Downloading a model requires the desktop app.");
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  let parts: DownloadPart[] = [{ url: reference, filename: reference.split("/").pop() || "model.gguf" }];

  if (!reference.startsWith("http://") && !reference.startsWith("https://")) {
    const resolved = await window.electronAPI.resolveModelUrl?.(reference, { includeDraft: true });
    // A bare name is not a URL: sent on as one, the downloader refuses it with a message about policy.
    if (!resolved?.url) throw new Error(`Could not find ${reference} on Hugging Face.`);
    parts = resolved.parts?.length ? resolved.parts : [{ url: resolved.url, filename: resolved.filename }];
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const combined = parts.length > 1;
  // What the server reports for a part beats the catalogue's figure; a part not reached yet counts
  // as the average of the others, so the total grows and shrinks a little instead of reading zero.
  const sizes = parts.map((part) => part.size ?? 0);
  let finishedParts = 0;
  let current = parts[0];
  let firstSample: { at: number; completed: number } | null = null;

  const unsubscribe = window.electronAPI.gguf.onProgress((progress) => {
    // Downloads run side by side on one channel, and the engine setup reports here too.
    if (progress.label && progress.label !== current.filename) return;
    if (!combined) {
      onProgress({
        phase: progress.phase,
        completed: progress.completed,
        total: progress.total,
        percent: progress.percent,
        remainingSeconds: progress.remainingSeconds,
      });
      return;
    }

    if (progress.total > 0) sizes[finishedParts] = progress.total;
    const known = sizes.filter((size) => size > 0);
    const average = known.length ? known.reduce((sum, size) => sum + size, 0) / known.length : 0;
    const totalBytes = Math.round(sizes.reduce((sum, size) => sum + (size > 0 ? size : average), 0));
    const before = sizes.slice(0, finishedParts).reduce((sum, size) => sum + size, 0);
    const completed = before + progress.completed;

    // Speed counts only what this session moved: bytes a resumed download already had are not progress.
    const now = Date.now();
    if (!firstSample && progress.completed > 0) firstSample = { at: now, completed };
    const elapsedSeconds = firstSample ? (now - firstSample.at) / 1000 : 0;
    const speed = firstSample && elapsedSeconds > 0.5 ? (completed - firstSample.completed) / elapsedSeconds : 0;

    onProgress({
      // Only the last part finishing finishes the model.
      phase: progress.phase === "done" && finishedParts < parts.length - 1 ? "downloading" : progress.phase,
      completed,
      total: totalBytes,
      percent: totalBytes > 0 ? Number(Math.min(100, (completed / totalBytes) * 100).toFixed(1)) : 0,
      remainingSeconds: speed > 0 ? Math.max(0, Math.round((totalBytes - completed) / speed)) : null,
    });
  });

  try {
    for (const [index, part] of parts.entries()) {
      current = part;
      finishedParts = index;
      const download = window.electronAPI.gguf.downloadModel({ url: part.url, filename: part.filename, cid: newCorrelationId() });
      const result = signal
        ? await Promise.race([
            download,
            new Promise<never>((_, reject) => {
              signal.addEventListener(
                "abort",
                () => {
                  window.electronAPI?.gguf?.cancelDownload?.(part.filename)?.catch(swallowed("app", "the main process already logged this call"));
                  reject(new DOMException("Aborted", "AbortError"));
                },
                { once: true },
              );
            }),
          ])
        : await download;

      if (result?.cancelled) throw new DOMException("Aborted", "AbortError");
      if (!result?.success) throw new Error(`Could not download ${part.filename}`);
    }
  } catch (error) {
    // Parts already on disk are useless without the rest, and would show up as a model that cannot load.
    if (parts.length > 1) await window.electronAPI?.gguf?.deleteModel?.(parts[0].filename)?.catch(swallowed("app", "the main process already logged this call"));
    throw error;
  } finally {
    unsubscribe?.();
  }
}
