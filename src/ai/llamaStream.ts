import { safeJsonParse } from "../utils";
import type { GenerationMetrics } from "../llama";

/** llama-server speaks the OpenAI shape, which wants a type on every tool call a history replays. */
export function toLlamaMessages<M extends { tool_calls?: object[] }>(messages: M[]): M[] {
  return messages.map((message) =>
    message.tool_calls
      ? { ...message, tool_calls: message.tool_calls.map((call) => ({ type: "function", ...call })) }
      : message,
  );
}

/** llama-server reports failures as {"error": {"code", "message", "type"}}, an object, not a string. */
export function ggufErrorMessage(body: string, fallback: string): string {
  const error = safeJsonParse<{ error?: string | { message?: string } }>(body)?.error;
  const message = typeof error === "string" ? error : error?.message;
  return message || body || fallback;
}

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

export interface AdaptedLlamaChunk {
  message?: {
    content?: string;
    thinking?: string;
    tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  prompt_eval_duration?: number;
  eval_duration?: number;
  total_duration?: number;
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

/** Finalizes the tool calls and empties the map, so each reaches the caller once. llama-server sends
 * the finish reason and then `[DONE]`, and both used to hand over the same calls: every tool ran twice. */
export function drainToolCalls(pending: Map<number, PartialToolCall>): ParsedToolCall[] {
  const calls = finalizeToolCalls(pending);
  pending.clear();
  return calls;
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
        const finalTools = drainToolCalls(pendingTools);
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
        ? drainToolCalls(pendingTools)
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

  const finalTools = drainToolCalls(pendingTools);
  if (finalTools.length > 0) {
    onChunk({ toolCalls: finalTools });
  }
}

/** Yields normalized chunks matching Draggy's chunk format from an SSE stream. */
export async function* sseToLlamaChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<AdaptedLlamaChunk, void, unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  const pendingTools = new Map<number, PartialToolCall>();

  let lastUsage: SseRawPayload["usage"];
  let lastTimings: SseRawPayload["timings"];
  let yieldedDone = false;

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
        const remaining = drainToolCalls(pendingTools);
        if (remaining.length > 0) {
          yield {
            message: {
              tool_calls: remaining.map((t) => ({ function: { name: t.name, arguments: t.args } })),
            },
          };
        }
        if (!yieldedDone) {
          yield {
            done: true,
            prompt_eval_count: lastUsage?.prompt_tokens ?? lastTimings?.prompt_n,
            eval_count: lastUsage?.completion_tokens ?? lastTimings?.predicted_n,
            prompt_eval_duration:
              lastTimings?.prompt_ms !== undefined ? lastTimings.prompt_ms * 1e6 : undefined,
            eval_duration:
              lastTimings?.predicted_ms !== undefined ? lastTimings.predicted_ms * 1e6 : undefined,
          };
        }
        return;
      }

      const payload = safeJsonParse<SseRawPayload>(data);
      if (!payload) continue;
      if (payload.usage) lastUsage = payload.usage;
      if (payload.timings) lastTimings = payload.timings;

      const choice = payload.choices?.[0];
      const delta = choice?.delta;

      if (delta?.tool_calls) {
        accumulateToolCalls(pendingTools, delta.tool_calls);
      }

      const isToolFinish = choice?.finish_reason === "tool_calls";
      const readyTools = isToolFinish ? drainToolCalls(pendingTools) : [];

      if (choice?.finish_reason) yieldedDone = true;

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
        prompt_eval_count: payload.usage?.prompt_tokens ?? payload.timings?.prompt_n,
        eval_count: payload.usage?.completion_tokens ?? payload.timings?.predicted_n,
        prompt_eval_duration:
          payload.timings?.prompt_ms !== undefined ? payload.timings.prompt_ms * 1e6 : undefined,
        eval_duration:
          payload.timings?.predicted_ms !== undefined ? payload.timings.predicted_ms * 1e6 : undefined,
        total_duration:
          payload.timings?.prompt_ms !== undefined || payload.timings?.predicted_ms !== undefined
            ? ((payload.timings?.prompt_ms ?? 0) + (payload.timings?.predicted_ms ?? 0)) * 1e6
            : undefined,
      };
    }
  }
}
