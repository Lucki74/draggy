import { describe, expect, it } from "vitest";
import {
  accumulateToolCalls,
  finalizeToolCalls,
  drainToolCalls,
  ggufErrorMessage,
  toLlamaMessages,
  readLlamaMetrics,
  readLlamaSseStream,
  sseToOllamaChunks,
} from "../ai/llamaStream";
import type { StreamChunk } from "../ai/llamaStream";

describe("llamaStream tool accumulator", () => {
  it("accumulates fragmented argument deltas across multiple chunks", () => {
    const pending = new Map();

    accumulateToolCalls(pending, [
      { index: 0, id: "call_1", function: { name: "readFile", arguments: '{"path":' } },
    ]);
    accumulateToolCalls(pending, [
      { index: 0, function: { arguments: ' "notes.txt"}' } },
    ]);

    const finalized = finalizeToolCalls(pending);
    expect(finalized).toHaveLength(1);
    expect(finalized[0].name).toBe("readFile");
    expect(finalized[0].args).toEqual({ path: "notes.txt" });
  });

  it("handles multiple interleaved tool calls by index", () => {
    const pending = new Map();

    accumulateToolCalls(pending, [
      { index: 0, id: "call_a", function: { name: "toolA", arguments: '{"a": 1' } },
      { index: 1, id: "call_b", function: { name: "toolB", arguments: '{"b":' } },
    ]);
    accumulateToolCalls(pending, [
      { index: 0, function: { arguments: "}" } },
      { index: 1, function: { arguments: ' "hello"}' } },
    ]);

    const finalized = finalizeToolCalls(pending);
    expect(finalized).toHaveLength(2);
    expect(finalized[0]).toEqual({ name: "toolA", args: { a: 1 } });
    expect(finalized[1]).toEqual({ name: "toolB", args: { b: "hello" } });
  });

  it("gracefully falls back to empty object on invalid JSON arguments", () => {
    const pending = new Map();
    accumulateToolCalls(pending, [
      { index: 0, function: { name: "brokenTool", arguments: "{incomplete json..." } },
    ]);

    const finalized = finalizeToolCalls(pending);
    expect(finalized).toHaveLength(1);
    expect(finalized[0].name).toBe("brokenTool");
    expect(finalized[0].args).toEqual({});
  });
});

describe("llamaStream metrics parser", () => {
  it("extracts generation metrics from timings payload", () => {
    const metrics = readLlamaMetrics(
      {
        timings: {
          prompt_n: 15,
          prompt_ms: 30,
          prompt_per_second: 500,
          predicted_n: 50,
          predicted_ms: 500,
          predicted_per_second: 100,
        },
      },
      "qwen2.5:7b",
      8192,
      120,
    );

    expect(metrics).not.toBeNull();
    expect(metrics?.promptTokens).toBe(15);
    expect(metrics?.responseTokens).toBe(50);
    expect(metrics?.tokensPerSecond).toBe(100);
    expect(metrics?.timeToFirstTokenMs).toBe(120);
    expect(metrics?.contextWindow).toBe(8192);
  });
});

describe("readLlamaSseStream", () => {
  function createMockReader(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
    const encoder = new TextEncoder();
    let index = 0;

    return {
      read: async () => {
        if (index >= chunks.length) return { done: true, value: undefined };
        const value = encoder.encode(chunks[index++]);
        return { done: false, value };
      },
      releaseLock: () => {},
      cancel: async () => {},
      closed: Promise.resolve(undefined),
    };
  }

  it("streams text, reasoning, and finalized tool calls", async () => {
    const sseLines = [
      'data: {"choices":[{"index":0,"delta":{"content":"Hello "}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"reasoning_content":"Thinking... "}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"name":"search","arguments":"{\\"q\\":\\"test\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      "data: [DONE]\n\n",
    ];

    const reader = createMockReader(sseLines);
    const collected: StreamChunk[] = [];

    await readLlamaSseStream(reader, "qwen2.5:7b", 8192, (chunk) => {
      collected.push(chunk);
    });

    expect(collected.some((c) => c.content === "Hello ")).toBe(true);
    expect(collected.some((c) => c.reasoning === "Thinking... ")).toBe(true);

    const toolChunk = collected.find((c) => c.toolCalls && c.toolCalls.length > 0);
    expect(toolChunk).toBeDefined();
    expect(toolChunk?.toolCalls?.[0]).toEqual({ name: "search", args: { q: "test" } });
  });

  it("yields Ollama-compatible chunks through sseToOllamaChunks", async () => {
    const sseLines = [
      'data: {"choices":[{"index":0,"delta":{"content":"Hi "}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":"there"}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
      "data: [DONE]\n\n",
    ];

    const reader = createMockReader(sseLines);
    const chunks = [];
    for await (const chunk of sseToOllamaChunks(reader)) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].message?.content).toBe("Hi ");
    expect(chunks[1].message?.content).toBe("there");
    expect(chunks[2].done).toBe(true);
    expect(chunks[2].prompt_eval_count).toBe(5);
  });
});

describe("ggufErrorMessage", () => {
  it("reads the message out of llama-server's error object instead of printing [object Object]", () => {
    const body = JSON.stringify({ error: { code: 500, message: "Failed to parse tool call arguments", type: "server_error" } });
    expect(ggufErrorMessage(body, "Internal Server Error")).toBe("Failed to parse tool call arguments");
  });

  it("still accepts a plain string error", () => {
    expect(ggufErrorMessage(JSON.stringify({ error: "model not loaded" }), "Bad Request")).toBe("model not loaded");
  });

  it("falls back to the raw body, then the status text", () => {
    expect(ggufErrorMessage("upstream exploded", "Bad Gateway")).toBe("upstream exploded");
    expect(ggufErrorMessage("", "Bad Gateway")).toBe("Bad Gateway");
  });
});

describe("toLlamaMessages", () => {
  const history = [
    { role: "user", content: "read it" },
    { role: "assistant", content: "", tool_calls: [{ function: { name: "read_file", arguments: { path: "a.ts" } } }] },
    { role: "tool", content: "export const a = 1;" },
  ];

  it("adds the function type llama-server rejects a replayed tool call without", () => {
    const [, assistant] = toLlamaMessages(history);
    expect(assistant.tool_calls).toEqual([
      { type: "function", function: { name: "read_file", arguments: { path: "a.ts" } } },
    ]);
  });

  it("leaves messages without tool calls, and the input, untouched", () => {
    const converted = toLlamaMessages(history);
    expect(converted[0]).toBe(history[0]);
    expect(converted[2]).toBe(history[2]);
    expect(history[1].tool_calls?.[0]).not.toHaveProperty("type");
  });

  it("keeps a type that is already there", () => {
    const [call] = toLlamaMessages([{ tool_calls: [{ type: "function", function: { name: "x" } }] }])[0].tool_calls ?? [];
    expect(call).toEqual({ type: "function", function: { name: "x" } });
  });
});

describe("tool calls are delivered once", () => {
  const finish = [
    'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"name":"read_file","arguments":"{\\"path\\":\\"a.ts\\"}"}}]}}]}\n\n',
    'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"function":{"name":"search_files","arguments":"{\\"q\\":\\"x\\"}"}}]}}]}\n\n',
    'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
    "data: [DONE]\n\n",
  ];

  function readerOf(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
    const encoder = new TextEncoder();
    let index = 0;
    return {
      read: async () =>
        index >= chunks.length
          ? { done: true, value: undefined }
          : { done: false, value: encoder.encode(chunks[index++]) },
      releaseLock: () => {},
      cancel: async () => {},
      closed: Promise.resolve(undefined),
    } as ReadableStreamDefaultReader<Uint8Array>;
  }

  it("hands each call to readLlamaSseStream once, not again at [DONE]", async () => {
    const delivered: string[] = [];
    await readLlamaSseStream(readerOf(finish), "m", 8192, (chunk) => {
      for (const call of chunk.toolCalls ?? []) delivered.push(call.name);
    });

    expect(delivered).toEqual(["read_file", "search_files"]);
  });

  it("hands each call to sseToOllamaChunks once, not again at [DONE]", async () => {
    const delivered: string[] = [];
    for await (const chunk of sseToOllamaChunks(readerOf(finish))) {
      for (const call of chunk.message?.tool_calls ?? []) delivered.push(call.function.name);
    }

    expect(delivered).toEqual(["read_file", "search_files"]);
  });

  it("still delivers calls from a stream that ends without a finish reason", async () => {
    const delivered: string[] = [];
    for await (const chunk of sseToOllamaChunks(readerOf([finish[0], "data: [DONE]\n\n"]))) {
      for (const call of chunk.message?.tool_calls ?? []) delivered.push(call.function.name);
    }

    expect(delivered).toEqual(["read_file"]);
  });

  it("drainToolCalls empties the map it reads", () => {
    const pending = new Map([[0, { id: "", name: "read_file", argsString: "{}" }]]);

    expect(drainToolCalls(pending)).toHaveLength(1);
    expect(drainToolCalls(pending)).toHaveLength(0);
  });
});
