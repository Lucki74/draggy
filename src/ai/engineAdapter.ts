import type { GenerationMetrics } from "../llama";
import { readLlamaSseStream } from "./llamaStream";
import type { ParsedToolCall } from "./llamaStream";
import { logGgufChunk, logGgufInference, logGgufMetrics, logNetwork } from "../logger";

export interface NormalizedTurnChunk {
  content?: string;
  thinking?: string;
  toolCalls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  metrics?: GenerationMetrics;
  done?: boolean;
}

export interface EngineTurnOptions {
  model: string;
  messages: { role: string; content: string }[];
  tools?: { type: string; function: { name: string; description: string; parameters: Record<string, unknown> } }[];
  contextSize?: number;
  temperature?: number;
  signal?: AbortSignal;
  correlationId?: string;
}

/** Tells whether a model identifier points to a local GGUF file or a bare model tag. */
export function isGgufModel(model: string): boolean {
  if (!model) return false;
  const lower = model.toLowerCase();
  return lower.endsWith(".gguf") || lower.startsWith("gguf:");
}

/** Strips gguf prefix if present to obtain clean filename or path. */
export function ggufModelName(model: string): string {
  if (model.toLowerCase().startsWith("gguf:")) {
    return model.slice(5);
  }
  return model;
}

/** Sends a chat turn through the active GGUF llama-server instance. */
export async function streamGgufTurn(
  options: EngineTurnOptions,
  onChunk: (chunk: NormalizedTurnChunk) => boolean | void,
): Promise<void> {
  const modelFile = ggufModelName(options.model);
  const contextSize = options.contextSize || 8192;
  const correlationId = options.correlationId || "gguf-turn";

  logGgufInference(
    {
      model: modelFile,
      contextSize,
      messageCount: options.messages.length,
      toolsCount: options.tools?.length || 0,
      temperature: options.temperature,
    },
    correlationId,
  );

  if (typeof window !== "undefined" && window.electronAPI?.gguf) {
    const started = await window.electronAPI.gguf.start({
      modelPath: modelFile,
      contextSize,
    });
    if (!started.success && !started.alreadyRunning) {
      throw new Error(started.error || "Could not start local GGUF runtime");
    }
  }

  const payload: Record<string, unknown> = {
    model: modelFile,
    messages: options.messages,
    stream: true,
    temperature: options.temperature ?? 0.7,
  };

  if (options.tools && options.tools.length > 0) {
    payload.tools = options.tools;
  }

  const fetchStart = performance.now();
  let res: Response;
  try {
    res = await fetch("http://127.0.0.1:11435/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: options.signal,
    });
    logNetwork(
      "http://127.0.0.1:11435/v1/chat/completions",
      "POST",
      res.status,
      performance.now() - fetchStart,
      correlationId,
    );
  } catch (err) {
    logNetwork(
      "http://127.0.0.1:11435/v1/chat/completions",
      "POST",
      0,
      performance.now() - fetchStart,
      correlationId,
    );
    throw err;
  }

  if (!res.ok) {
    throw new Error(`GGUF engine returned HTTP ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("Stream reader unavailable");

  await readLlamaSseStream(reader, modelFile, contextSize, (chunk) => {
    if (chunk.content) {
      logGgufChunk(chunk.content, correlationId);
    }
    if (chunk.metrics) {
      logGgufMetrics(chunk.metrics, correlationId);
    }

    const formattedTools = chunk.toolCalls?.map((t: ParsedToolCall) => ({
      function: { name: t.name, arguments: t.args },
    }));

    return onChunk({
      content: chunk.content,
      thinking: chunk.reasoning,
      toolCalls: formattedTools,
      metrics: chunk.metrics,
      done: chunk.done,
    });
  });
}
