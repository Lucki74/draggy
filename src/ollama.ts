import { safeJsonParse } from "./utils";

export const OLLAMA_HOST = "http://127.0.0.1:11434";

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
  /**
   * What Ollama says this model can do. Empty when the server could not be
   * asked, which every reader treats as "no information" rather than "no".
   */
  capabilities: string[];
}

const modelInfoCache = new Map<string, Promise<ModelInfo | null>>();

/**
 * How long to wait for Ollama to describe a model.
 *
 * Reading a manifest off the local disk takes milliseconds, so this is not a
 * budget so much as a limit on how wrong things can go. `listInstalledModels`
 * asks about every installed model at once and the startup screen waits on the
 * answer, so a server that accepts the connection and then says nothing would
 * otherwise hold the splash screen open indefinitely. Timing out is safe: the
 * result is an empty capability list, which every reader treats as "unknown"
 * rather than as "no", and the failure is not cached.
 */
const MODEL_INFO_TIMEOUT_MS = 5000;

async function fetchModelInfo(model: string): Promise<ModelInfo | null> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model }),
      signal: AbortSignal.timeout(MODEL_INFO_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const info: Record<string, unknown> = data?.model_info || {};

    const readNumber = (suffix: string): number | null => {
      const key = Object.keys(info).find((entry) => entry.endsWith(suffix));
      const value = key ? info[key] : undefined;
      return typeof value === "number" && value > 0 ? value : null;
    };

    const contextLength = readNumber(".context_length");

    const parameters = data?.details?.parameter_size;
    const parsedParameters =
      typeof parameters === "string"
        ? Number(parameters.replace(/[^\d.]/g, "")) || null
        : null;

    return {
      contextLength,
      capabilities: Array.isArray(data?.capabilities) ? data.capabilities : [],
      parameterCount: parsedParameters,
      quantization: data?.details?.quantization_level ?? null,
    };
  } catch {
    return null;
  }
}

export function getModelInfo(model: string): Promise<ModelInfo | null> {
  const cached = modelInfoCache.get(model);
  if (cached) return cached;

  const pending = fetchModelInfo(model).then((value) => {
    if (value === null) modelInfoCache.delete(model);
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

export function pickContextSize(
  charEstimate: number,
  maxContext: number | null,
): number {
  const cap = maxContext ?? FALLBACK_CONTEXT_LENGTH;
  const needed = Math.ceil(charEstimate / 4) + 2048;

  for (const bucket of CONTEXT_BUCKETS) {
    if (bucket >= needed) return Math.min(bucket, cap);
  }
  return cap;
}

export interface ContextUse {
  usedTokens: number;
  windowTokens: number;
  percent: number;
  measured: boolean;
}

export function describeContextUse(input: {
  measuredTokens: number | null;
  draftChars: number;
  historyChars: number;
  maxContext: number | null;
}): ContextUse {
  const draftTokens = Math.ceil(Math.max(0, input.draftChars) / 4);

  const usedTokens =
    input.measuredTokens !== null && input.measuredTokens > 0
      ? input.measuredTokens + draftTokens
      : Math.ceil(Math.max(0, input.historyChars + input.draftChars) / 4);

  const windowTokens = input.maxContext ?? FALLBACK_CONTEXT_LENGTH;

  return {
    usedTokens,
    windowTokens,
    percent: windowTokens > 0 ? (usedTokens / windowTokens) * 100 : 0,
    measured: input.measuredTokens !== null && input.measuredTokens > 0,
  };
}

export function isCloudModel(name: string): boolean {
  const tag = name.toLowerCase().split(":").pop() || "";
  return tag === "cloud" || tag.endsWith("-cloud");
}

export async function listInstalledModels(): Promise<InstalledModel[]> {
  const res = await fetch(`${OLLAMA_HOST}/api/tags`);
  if (!res.ok) throw new Error(`Ollama returned ${res.status}`);

  const data = await res.json();
  const listed: Omit<InstalledModel, "capabilities">[] = (data?.models || [])
    .map(
      (m: {
        name: string;
        size?: number;
        details?: { parameter_size?: string; family?: string };
      }) => ({
        name: m.name,
        size: m.size || 0,
        parameterSize: m.details?.parameter_size || "",
        family: m.details?.family || "",
      }),
    )
    .filter((m: { name: string }) => !isCloudModel(m.name));

  // `/api/tags` says nothing about what a model can do, so each one is asked
  // separately. The calls go out together and `getModelInfo` caches them, so
  // the price is paid once per model for as long as the app is open.
  const info = await Promise.all(listed.map((m) => getModelInfo(m.name)));

  return listed.map((model, index) => ({
    ...model,
    capabilities: info[index]?.capabilities ?? [],
  }));
}

export async function describeLoadedModels(): Promise<LoadedModel[]> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/ps`);
    if (!res.ok) return [];

    const data = await res.json();
    return (data?.models || []).map(
      (entry: { name: string; size?: number; size_vram?: number }) => {
        const size = entry.size || 0;
        const sizeVram = entry.size_vram || 0;
        return {
          name: entry.name,
          size,
          sizeVram,
          gpuPercent: size > 0 ? Math.round((sizeVram / size) * 100) : 0,
        };
      },
    );
  } catch {
    return [];
  }
}

export async function gpuShareFor(model: string): Promise<number | null> {
  const loaded = await describeLoadedModels();
  const base = model.split(":")[0];
  const match =
    loaded.find((entry) => entry.name === model) ||
    loaded.find((entry) => entry.name.split(":")[0] === base);
  return match ? match.gpuPercent : null;
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

export async function warmModel(name: string, keepAlive: string): Promise<void> {
  await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: name,
      stream: false,
      think: false,
      keep_alive: keepAlive,
      options: { num_predict: 1 },
      messages: [{ role: "user", content: "hi" }],
    }),
  });
}

export async function deleteModel(name: string): Promise<void> {
  const res = await fetch(`${OLLAMA_HOST}/api/delete`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Could not remove ${name}`);
  forgetModelInfo(name);
}

export async function readNdjsonStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onValue: (value: Record<string, unknown>) => boolean | void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = safeJsonParse<Record<string, unknown>>(trimmed);
      if (parsed && onValue(parsed) === false) return;
    }
  }

  const tail = buffer.trim();
  if (tail) {
    const parsed = safeJsonParse<Record<string, unknown>>(tail);
    if (parsed) onValue(parsed);
  }
}

const PULL_PROGRESS_INTERVAL_MS = 100;

/**
 * What a pull is doing, whatever wording Ollama happens to use for it.
 *
 * Reading the wording directly is what broke the startup bar: the progress
 * lines say "pulling a3de86cd1c13", not "downloading", so a check for the word
 * "downloading" never matched and the bar sat at nought bytes forever while
 * the heading showed a raw digest.
 */
export type PullPhase = "preparing" | "downloading" | "verifying" | "done";

/**
 * The translation key each phase is shown as, so every screen that downloads a
 * model words it the same way and none of them show a digest.
 */
export const PULL_PHASE_KEYS: Record<PullPhase, string> = {
  preparing: "preparingDownload",
  downloading: "downloadingModel",
  verifying: "verifyingDownload",
  done: "verifyingDownload",
};

export interface PullProgress {
  /** The line exactly as Ollama sent it. */
  status: string;
  phase: PullPhase;
  /** Bytes transferred across every layer announced so far. */
  completed: number;
  /** Bytes to transfer across every layer announced so far. */
  total: number;
  /** 0 to 100 for the pull as a whole. */
  percent: number;
}

function phaseFromStatus(status: string, current: PullPhase): PullPhase {
  const text = status.toLowerCase();
  if (text.startsWith("success")) return "done";
  if (text.includes("pulling manifest")) return "preparing";
  if (
    text.startsWith("verifying") ||
    text.startsWith("writing") ||
    text.startsWith("removing")
  ) {
    return "verifying";
  }
  // Wording we do not recognise says nothing about what changed, so carry on
  // with whatever was already happening rather than inventing a phase.
  return current;
}

/**
 * Turns Ollama's pull stream into one figure for the whole download.
 *
 * Every progress line describes a single layer, so reading `completed`/`total`
 * straight off the line measures whichever layer is in flight rather than the
 * job. A model is several layers, so that number restarts part-way through and
 * lands on a 1 kB layer at the end, which is how a finished 5 GB download can
 * report a couple of kilobytes. Layers are therefore added up by digest.
 *
 * The lines that carry no byte counts at all — "verifying sha256 digest",
 * "writing manifest" — must leave the totals alone. Zeroing on those is what
 * made the bar fall back to its indeterminate state right at the end.
 */
export function createPullTracker(): (
  line: Record<string, unknown>,
) => PullProgress {
  const layers = new Map<string, { completed: number; total: number }>();
  let completed = 0;
  let total = 0;
  let percent = 0;
  let phase: PullPhase = "preparing";

  return (line) => {
    const status = typeof line.status === "string" ? line.status : "";
    const lineTotal = Number(line.total) || 0;

    if (lineTotal > 0) {
      // Ollama names the layer by digest; the status holds an abbreviation of
      // the same digest, which serves if the field is ever missing.
      const key = typeof line.digest === "string" ? line.digest : status;
      const seen = layers.get(key);
      layers.set(key, {
        total: lineTotal,
        // Reports can arrive out of order; a layer never un-downloads.
        completed: Math.max(seen?.completed ?? 0, Number(line.completed) || 0),
      });

      const previousTotal = total;
      completed = 0;
      total = 0;
      for (const layer of layers.values()) {
        completed += layer.completed;
        total += layer.total;
      }

      const measured = total > 0 ? (completed / total) * 100 : 0;
      // A newly announced layer makes the job bigger, and going back is then
      // the honest thing to show. While the job stays the same size the figure
      // only ever grows.
      percent = total === previousTotal ? Math.max(percent, measured) : measured;
      phase = "downloading";
    } else {
      phase = phaseFromStatus(status, phase);
      if (phase === "done") {
        percent = 100;
        completed = total;
      }
    }

    return { status, phase, completed, total, percent };
  };
}

export async function pullModel(
  name: string,
  onProgress: (progress: PullProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (isCloudModel(name)) throw new Error(`${name} is not a local model`);

  const res = await fetch(`${OLLAMA_HOST}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, stream: true }),
    signal,
  });

  if (!res.ok) throw new Error(`Could not download ${name}`);
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Stream reader unavailable.");

  let failure: string | null = null;
  let lastPaint = 0;
  let lastPhase: PullPhase | null = null;

  const track = createPullTracker();

  await readNdjsonStream(reader, (parsed) => {
    if (typeof parsed.error === "string") {
      failure = parsed.error;
      return false;
    }

    const progress = track(parsed);
    const now = performance.now();

    // Throttling exists to spare the renderer thousands of byte updates, but a
    // change of phase happens once and has to get through, or the screen is
    // left saying "downloading" while Ollama is writing the manifest.
    const changedPhase = progress.phase !== lastPhase;
    if (!changedPhase && now - lastPaint < PULL_PROGRESS_INTERVAL_MS) return;

    lastPaint = now;
    lastPhase = progress.phase;
    onProgress(progress);
  });

  if (failure) throw new Error(failure);
  forgetModelInfo(name);
}
