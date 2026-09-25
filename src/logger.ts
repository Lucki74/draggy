import type { LogEntry } from "./types";
import { generateId } from "./utils";

/** Mirrors electron/logger.cjs's SENSITIVE_KEYS so a value logged on both sides is redacted the same way. */
const SENSITIVE_KEYS = new Set([
  "prompt",
  "content",
  "text",
  "rawChunk",
  "streamBuffer",
  "response",
  "reply",
  "input",
  "userPrompt",
  "body",
]);

const SANITIZE_PREFIX = 50;

function sanitizeString(value: string): string {
  if (value.length <= SANITIZE_PREFIX) return value;
  return `${value.slice(0, SANITIZE_PREFIX)}... [${value.length} chars]`;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[Depth]";
  if (typeof value === "string") return sanitizeString(value);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Error) return { name: value.name, message: sanitizeString(value.message) };
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, depth + 1));

  const sanitized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    sanitized[key] =
      SENSITIVE_KEYS.has(key) && typeof val === "string" ? sanitizeString(val) : sanitizeValue(val, depth + 1);
  }
  return sanitized;
}

const FLUSH_INTERVAL_MS = 500;

let queue: LogEntry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function send(entries: LogEntry[]) {
  if (typeof window === "undefined") return;
  window.electronAPI?.logBatch?.(entries);
}

function flush() {
  timer = null;
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  send(batch);
}

function enqueue(entry: LogEntry) {
  queue.push(entry);
  if (timer === null) timer = setTimeout(flush, FLUSH_INTERVAL_MS);
}

/** Flushes immediately instead of waiting for the batch timer. For tests and page unload. */
export function flushLogs(): void {
  if (timer !== null) clearTimeout(timer);
  flush();
}

/** One id per user-visible turn, so every line it produces can be joined back together. */
export const newCorrelationId = generateId;

export function logNetwork(
  url: string,
  method: string,
  status: number,
  durationMs: number,
  correlationId?: string | null,
): void {
  enqueue({
    level: status >= 400 || status === 0 ? "ERROR" : "INFO",
    context: "network",
    message: `${method} ${url} -> ${status}`,
    correlationId,
    data: { durationMs },
  });
}

/** Wraps `fetch` so every engine call is timed and logged without touching each call site's parsing. */
export async function loggedFetch(
  url: string,
  init: RequestInit = {},
  correlationId?: string | null,
): Promise<Response> {
  const startedAt = performance.now();
  try {
    const response = await fetch(url, init);
    logNetwork(url, init.method ?? "GET", response.status, performance.now() - startedAt, correlationId);
    return response;
  } catch (error) {
    logNetwork(url, init.method ?? "GET", 0, performance.now() - startedAt, correlationId);
    throw error;
  }
}

export function logLlamaInference(params: Record<string, unknown>, correlationId: string): void {
  enqueue({
    level: "INFO",
    context: "llama",
    message: "inference",
    correlationId,
    data: sanitizeValue(params),
  });
}

export function logLlamaMetrics(metrics: object, correlationId: string): void {
  enqueue({ level: "INFO", context: "llama", message: "metrics", correlationId, data: metrics });
}

// Length only: a token's hash is reversed by hashing the vocabulary,
// and the stream of chunks would otherwise rebuild the whole reply in debug.log.
export function logStreamChunk(chunk: string, correlationId: string): void {
  enqueue({
    level: "DEBUG",
    context: "llama",
    message: "chunk",
    correlationId,
    data: { chars: chunk.length },
  });
}

export function logGgufInference(params: Record<string, unknown>, correlationId: string): void {
  enqueue({
    level: "INFO",
    context: "gguf",
    message: "inference",
    correlationId,
    data: sanitizeValue(params),
  });
}

export function logGgufMetrics(metrics: object, correlationId: string): void {
  enqueue({ level: "INFO", context: "gguf", message: "metrics", correlationId, data: metrics });
}

export function logGgufChunk(chunk: string, correlationId: string): void {
  enqueue({
    level: "DEBUG",
    context: "gguf",
    message: "chunk",
    correlationId,
    data: { chars: chunk.length },
  });
}

export function logAgentStep(
  step: string,
  details?: Record<string, unknown>,
  correlationId?: string | null,
): void {
  enqueue({
    level: "INFO",
    context: "agent",
    message: `step:${step}`,
    correlationId,
    data: details ? sanitizeValue(details) : undefined,
  });
}

export function logToolCall(
  name: string,
  status: "start" | "complete" | "error",
  details?: Record<string, unknown>,
  correlationId?: string | null,
): void {
  enqueue({
    level: status === "error" ? "ERROR" : "INFO",
    context: "tools",
    message: `${name}:${status}`,
    correlationId,
    data: details ? sanitizeValue(details) : undefined,
  });
}

export function logRendererEvent(
  context: string,
  level: "INFO" | "WARN" | "ERROR" | "DEBUG",
  message: string,
  data?: Record<string, unknown>,
  correlationId?: string | null,
): void {
  enqueue({
    level,
    context,
    message,
    correlationId,
    data: data ? sanitizeValue(data) : undefined,
  });
}
