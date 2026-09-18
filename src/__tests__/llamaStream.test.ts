import { describe, expect, it } from "vitest";
import {
  accumulateToolCalls,
  finalizeToolCalls,
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
