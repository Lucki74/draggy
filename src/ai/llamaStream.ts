import { safeJsonParse } from "../utils";
import type { GenerationMetrics } from "../ollama";

export interface PartialToolCall {
  id: string;
  name: string;
  argsString: string;
}

export interface ToolCallDelta {
  index: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface ParsedToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface StreamChunk {
  content?: string;
  reasoning?: string;
  toolCalls?: ParsedToolCall[];
  metrics?: GenerationMetrics;
  done?: boolean;
}

export interface AdaptedOllamaChunk {
  message?: {
    content?: string;
    thinking?: string;
    tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

/** Accumulates fragmented streaming arguments into a per-index tool call map. */
export function accumulateToolCalls(
  pending: Map<number, PartialToolCall>,
  deltaToolCalls: ToolCallDelta[],
): Map<number, PartialToolCall> {
  for (const delta of deltaToolCalls) {
    const existing = pending.get(delta.index);

    if (!existing) {
      pending.set(delta.index, {
        id: delta.id ?? "",
        name: delta.function?.name ?? "",
        argsString: delta.function?.arguments ?? "",
      });
      continue;
    }

    if (delta.id) existing.id = delta.id;
    if (delta.function?.name) existing.name = delta.function.name;
    if (delta.function?.arguments) existing.argsString += delta.function.arguments;
  }

  return pending;
}

/** Converts completed streaming tool calls into parsed objects with fallback on malformed JSON. */
export function finalizeToolCalls(
  pending: Map<number, PartialToolCall>,
): ParsedToolCall[] {
  const result: ParsedToolCall[] = [];

  for (const call of pending.values()) {
    if (!call.name) continue;
    const parsedArgs = safeJsonParse<Record<string, unknown>>(call.argsString) ?? {};
    result.push({ name: call.name, args: parsedArgs });
  }

  return result;
}

export interface SseRawChoice {
  index: number;
  delta?: {
    content?: string;
    reasoning_content?: string;
    tool_calls?: ToolCallDelta[];
  };
  finish_reason?: string | null;
}

export interface SseRawPayload {
  choices?: SseRawChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  timings?: {
    prompt_n?: number;
    prompt_ms?: number;
    prompt_per_second?: number;
    predicted_n?: number;
    predicted_ms?: number;
    predicted_per_second?: number;
  };
}

/** Maps llama-server timings and usage payloads into Draggy's standard metrics shape. */
export function readLlamaMetrics(
  payload: SseRawPayload,
  model: string,
  contextWindow: number,
  timeToFirstTokenMs: number | null,
): GenerationMetrics | null {
  const timings = payload.timings;
  const usage = payload.usage;

  const responseTokens = timings?.predicted_n ?? usage?.completion_tokens ?? 0;
  const promptTokens = timings?.prompt_n ?? usage?.prompt_tokens ?? 0;
  const responseMs = timings?.predicted_ms ?? 0;
  const promptMs = timings?.prompt_ms ?? 0;
  const totalMs = promptMs + responseMs;

  if (responseTokens === 0 && promptTokens === 0) return null;

  return {
    promptTokens,
    responseTokens,
    promptMs,
    responseMs,
    loadMs: 0,
    totalMs,
    tokensPerSecond: responseMs > 0 ? (responseTokens / responseMs) * 1000 : (timings?.predicted_per_second ?? 0),
    timeToFirstTokenMs,
    contextWindow,
    model,
    gpuPercent: null,
  };
}

/** Reads a Server-Sent Events stream from llama-server and yields parsed chunks. */
export async function readLlamaSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  model: string,
  contextWindow: number,
  onChunk: (chunk: StreamChunk) => boolean | void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  const pendingTools = new Map<number, PartialToolCall>();
  let firstTokenReceived = false;
  const startMs = performance.now();
  let timeToFirstTokenMs: number | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;

      const dataStr = trimmed.slice(5).trim();
      if (dataStr === "[DONE]") {
        const finalTools = finalizeToolCalls(pendingTools);
        if (finalTools.length > 0) {
          onChunk({ toolCalls: finalTools });
        }
        onChunk({ done: true });
        return;
      }

      const payload = safeJsonParse<SseRawPayload>(dataStr);
      if (!payload) continue;

      const choice = payload.choices?.[0];
      const delta = choice?.delta;

      if (!firstTokenReceived && (delta?.content || delta?.reasoning_content || delta?.tool_calls)) {
        firstTokenReceived = true;
        timeToFirstTokenMs = performance.now() - startMs;
      }

      if (delta?.tool_calls) {
        accumulateToolCalls(pendingTools, delta.tool_calls);
      }

      const hasFinish = Boolean(choice?.finish_reason);
      const readyTools = hasFinish && choice?.finish_reason === "tool_calls"
        ? finalizeToolCalls(pendingTools)
        : undefined;

      const metrics = payload.timings || payload.usage
        ? readLlamaMetrics(payload, model, contextWindow, timeToFirstTokenMs)
        : undefined;

      const chunk: StreamChunk = {
        content: delta?.content,
        reasoning: delta?.reasoning_content,
        toolCalls: readyTools,
        metrics: metrics ?? undefined,
      };

      if (onChunk(chunk) === false) return;
    }
  }

  const finalTools = finalizeToolCalls(pendingTools);
  if (finalTools.length > 0) {
    onChunk({ toolCalls: finalTools });
  }
}

/** Yields normalized chunks matching Draggy's Ollama chunk format from an SSE stream. */
export async function* sseToOllamaChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<AdaptedOllamaChunk, void, unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  const pendingTools = new Map<number, PartialToolCall>();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    let sepIndex: number;

    while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);

      const dataLines = rawEvent
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart());

      if (dataLines.length === 0) continue;
      const data = dataLines.join("\n");
      if (data === "[DONE]") {
        const remaining = finalizeToolCalls(pendingTools);
        if (remaining.length > 0) {
          yield {
            message: {
              tool_calls: remaining.map((t) => ({ function: { name: t.name, arguments: t.args } })),
            },
          };
        }
        yield { done: true };
        return;
      }

      const payload = safeJsonParse<SseRawPayload>(data);
      if (!payload) continue;

      const choice = payload.choices?.[0];
      const delta = choice?.delta;

      if (delta?.tool_calls) {
        accumulateToolCalls(pendingTools, delta.tool_calls);
      }

      const isToolFinish = choice?.finish_reason === "tool_calls";
      const readyTools = isToolFinish ? finalizeToolCalls(pendingTools) : [];

      yield {
        message: {
          content: delta?.content || "",
          thinking: delta?.reasoning_content || "",
          tool_calls: readyTools.length > 0
            ? readyTools.map((t) => ({ function: { name: t.name, arguments: t.args } }))
            : undefined,
        },
        done: Boolean(choice?.finish_reason),
        done_reason: choice?.finish_reason || undefined,
        prompt_eval_count: payload.usage?.prompt_tokens,
        eval_count: payload.usage?.completion_tokens,
      };
    }
  }
}
