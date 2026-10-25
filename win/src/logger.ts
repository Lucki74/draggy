import type { LogEntry } from "./types";
import { generateId } from "./utils";

/** Mirrors electron/logger.cjs's SENSITIVE_KEYS. These pass through whole, since the renderer has
 * no sync SHA-256 and the main process hashes the full value for both log files. */
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
    sanitized[key] = SENSITIVE_KEYS.has(key) ? val : sanitizeValue(val, depth + 1);
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

const RECENT_MAX = 100;
const recent: string[] = [];

function remember(entry: LogEntry) {
  recent.push(`${new Date().toISOString().slice(11, 23)} ${entry.level} ${entry.context} ${entry.message}`.slice(0, 160));
  if (recent.length > RECENT_MAX) recent.shift();
}

/** The last lines this window logged, for attaching to a failure. */
export function recentRendererEvents(): string[] {
  return recent.slice();
}

function enqueue(entry: LogEntry) {
  remember(entry);
  queue.push(entry);
  if (timer === null) timer = setTimeout(flush, FLUSH_INTERVAL_MS);
}

/** Flushes immediately instead of waiting for the batch timer. For tests and page unload. */
export function flushLogs(): void {
  if (timer !== null) clearTimeout(timer);
  flush();
}

/** One id per user-visible turn, so every line it produces can be joined back together. */
export const newCorrelationId = (): string => generateId();

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
  // The engine gateway forwards the turn's id, so its lines and the engine's join the renderer's.
  if (correlationId && url.startsWith("draggy-ai://")) {
    init = { ...init, headers: { ...(init.headers as Record<string, string> | undefined), "X-Request-Id": correlationId } };
  }
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

/** An error dropped on purpose. DEBUG, so it costs nothing until someone raises the level. */
export function logSwallow(context: string, error: unknown, why: string): void {
  const code = (error as { code?: unknown } | null)?.code;
  logRendererEvent(context, "DEBUG", `swallowed: ${why}`, {
    error: error instanceof Error ? error.message : error === undefined ? undefined : String(error),
    code: typeof code === "string" || typeof code === "number" ? code : undefined,
  });
}

/** For `.catch(...)`: logs the dropped error and resolves to `fallback`. */
export function swallowed<T = undefined>(context: string, why: string, fallback?: T): (error: unknown) => T {
  return (error) => {
    logSwallow(context, error, why);
    return fallback as T;
  };
}

type RendererLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

function errorOf(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return { name: "Error", message: typeof error === "string" ? error : String(error) };
}

/** An error with its stack. The main process keeps the name, a cut message and the stack frames in app.log. */
export function logRendererError(
  context: string,
  message: string,
  error: unknown,
  data?: Record<string, unknown>,
  correlationId?: string | null,
): void {
  enqueue({
    level: "ERROR",
    context,
    message,
    correlationId,
    data: { ...(data ? (sanitizeValue(data) as Record<string, unknown>) : {}), recent: recentRendererEvents() },
    error: errorOf(error),
  });
}

const loggedOnce = new Set<string>();

/** For a line that would repeat per render or per chunk: the first call logs, the rest do nothing. */
export function logRendererOnce(
  key: string,
  context: string,
  level: RendererLevel,
  message: string,
  data?: Record<string, unknown>,
): void {
  if (loggedOnce.has(key)) return;
  loggedOnce.add(key);
  logRendererEvent(context, level, message, data);
}

let activeScreen = "boot";

export function currentScreen(): string {
  return activeScreen;
}

/** A screen, pane, modal or setting change. INFO, ids only, never content. */
export function logBreadcrumb(name: string, data?: Record<string, unknown>): void {
  if (name.startsWith("screen:")) activeScreen = name.slice("screen:".length);
  logRendererEvent("nav", "INFO", name, data);
}

const LONG_TASK_MS = 200;
let handlersInstalled = false;

/** Window-level safety nets: uncaught errors, rejected promises, long tasks, and a flush before the page goes away. */
export function installGlobalHandlers(target: Window = window): void {
  if (handlersInstalled) return;
  handlersInstalled = true;

  target.addEventListener("error", (event) => {
    logRendererError(
      "window",
      "uncaught error",
      event.error ?? event.message,
      { source: event.filename, line: event.lineno, column: event.colno, screen: activeScreen },
    );
    flushLogs();
  });
  target.addEventListener("unhandledrejection", (event) => {
    logRendererError("window", "unhandled rejection", event.reason, { screen: activeScreen });
    flushLogs();
  });
  target.addEventListener("beforeunload", flushLogs);
  target.addEventListener("pagehide", flushLogs);

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration >= LONG_TASK_MS) {
          logRendererEvent("perf", "DEBUG", "long task", { durMs: Math.round(entry.duration), screen: activeScreen });
        }
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
  } catch {
    // silent-ok: longtask entries are not available in every renderer
  }
}
