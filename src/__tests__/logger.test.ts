// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  flushLogs,
  loggedFetch,
  logNetwork,
  logOllamaInference,
  logOllamaMetrics,
  logStreamChunk,
  logGgufInference,
  logGgufMetrics,
  logGgufChunk,
  logAgentStep,
  logToolCall,
  newCorrelationId,
} from "../logger";

/** The renderer logger batches everything through one timer, so a leftover batch or a real timer
 * from one test would otherwise leak into the next. */
afterEach(() => {
  flushLogs();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

function stubApi() {
  const logBatch = vi.fn();
  (window as unknown as { electronAPI: { logBatch: typeof logBatch } }).electronAPI = { logBatch };
  return logBatch;
}

describe("batching", () => {
  it("holds entries until the flush timer fires", () => {
    vi.useFakeTimers();
    const logBatch = stubApi();

    logNetwork("http://x/api/tags", "GET", 200, 5);
    expect(logBatch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(logBatch).toHaveBeenCalledTimes(1);
    expect(logBatch.mock.calls[0][0]).toHaveLength(1);
  });

  it("flushes immediately on demand instead of waiting for the timer", () => {
    vi.useFakeTimers();
    const logBatch = stubApi();

    logNetwork("http://x/api/tags", "GET", 200, 5);
    flushLogs();

    expect(logBatch).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no bridge is present", () => {
    vi.useFakeTimers();
    logNetwork("http://x/api/tags", "GET", 200, 5);
    expect(() => vi.advanceTimersByTime(500)).not.toThrow();
  });
});

describe("logNetwork", () => {
  it("marks a successful response INFO", () => {
    const logBatch = stubApi();
    logNetwork("http://x/api/tags", "GET", 200, 12);
    flushLogs();

    const [entry] = logBatch.mock.calls[0][0];
    expect(entry.level).toBe("INFO");
    expect(entry.message).toBe("GET http://x/api/tags -> 200");
    expect(entry.data).toEqual({ durationMs: 12 });
  });

  it("marks a failed response or a request that never landed ERROR", () => {
    const logBatch = stubApi();
    logNetwork("http://x/api/chat", "POST", 500, 3);
    logNetwork("http://x/api/chat", "POST", 0, 3);
    flushLogs();

    const [first, second] = logBatch.mock.calls[0][0];
    expect(first.level).toBe("ERROR");
    expect(second.level).toBe("ERROR");
  });
});

describe("loggedFetch", () => {
  it("logs the outcome and returns the response untouched", async () => {
    const logBatch = stubApi();
    const response = new Response("{}", { status: 200 });
    vi.stubGlobal("fetch", vi.fn(async () => response));

    const result = await loggedFetch("http://x/api/tags", {}, "corr-1");
    flushLogs();

    expect(result).toBe(response);
    const [entry] = logBatch.mock.calls[0][0];
    expect(entry.correlationId).toBe("corr-1");
    expect(entry.message).toContain("-> 200");
  });

  it("logs a status of 0 and rethrows when the request itself fails", async () => {
    const logBatch = stubApi();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    await expect(loggedFetch("http://x/api/tags")).rejects.toThrow("ECONNREFUSED");
    flushLogs();

    const [entry] = logBatch.mock.calls[0][0];
    expect(entry.message).toContain("-> 0");
    expect(entry.level).toBe("ERROR");
  });
});

describe("ollama turn logging", () => {
  it("tags inference, metrics and stream chunks with the same correlation id", () => {
    const logBatch = stubApi();
    const id = newCorrelationId();

    logOllamaInference({ model: "llama3", numCtx: 8192 }, id);
    logStreamChunk("hello", id);
    logOllamaMetrics({ promptTokens: 10, responseTokens: 20 }, id);
    flushLogs();

    const entries = logBatch.mock.calls[0][0];
    expect(entries.every((entry: { correlationId: string }) => entry.correlationId === id)).toBe(true);
    expect(entries.map((entry: { context: string }) => entry.context)).toEqual([
      "ollama",
      "ollama",
      "ollama",
    ]);
  });

  it("redacts a long sensitive field before it ever reaches the bridge", () => {
    const logBatch = stubApi();
    const longPrompt = "x".repeat(200);

    logOllamaInference({ model: "llama3", content: longPrompt }, "corr-2");
    flushLogs();

    const [entry] = logBatch.mock.calls[0][0];
    expect(entry.data.content).not.toBe(longPrompt);
    expect(entry.data.content).toContain("200 chars");
    expect(entry.data.model).toBe("llama3");
  });
});

describe("gguf and agent turn logging", () => {
  it("tags gguf inference, metrics and stream chunks with correlation id", () => {
    const logBatch = stubApi();
    const id = newCorrelationId();

    logGgufInference({ model: "qwen2.5.gguf", contextSize: 8192 }, id);
    logGgufChunk("token", id);
    logGgufMetrics({ tokensPerSecond: 45 }, id);
    flushLogs();

    const entries = logBatch.mock.calls[0][0];
    expect(entries.every((entry: { correlationId: string }) => entry.correlationId === id)).toBe(true);
    expect(entries.map((entry: { context: string }) => entry.context)).toEqual([
      "gguf",
      "gguf",
      "gguf",
    ]);
  });

  it("records agent steps and tool execution timings", () => {
    const logBatch = stubApi();
    const id = newCorrelationId();

    logAgentStep("turn_start", { model: "llama3" }, id);
    logToolCall("readFile", "start", { path: "test.txt" }, id);
    logToolCall("readFile", "complete", { durationMs: 15 }, id);
    logAgentStep("turn_complete", { loops: 1 }, id);
    flushLogs();

    const entries = logBatch.mock.calls[0][0];
    expect(entries).toHaveLength(4);
    expect(entries[0].context).toBe("agent");
    expect(entries[0].message).toBe("step:turn_start");
    expect(entries[1].context).toBe("tools");
    expect(entries[1].message).toBe("readFile:start");
    expect(entries[2].context).toBe("tools");
    expect(entries[2].message).toBe("readFile:complete");
    expect(entries[3].context).toBe("agent");
    expect(entries[3].message).toBe("step:turn_complete");
  });
});
