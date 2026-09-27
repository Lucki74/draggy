import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { sseToLlamaChunks } from "../../src/ai/llamaStream";

const require = createRequire(import.meta.url);
const { createSse, completion } = require("./sse.cjs");
const { fromResponse, fromNetwork, isRetryable, retryAfterSeconds } = require("./errors.cjs");

/** Runs a writer script into a stream, and reads it back the way the renderer does. */
async function readBack(script) {
  let clock = 1000;
  const stream = new ReadableStream({
    start(controller) {
      const sse = createSse(controller, { now: () => (clock += 100) });
      script(sse);
    },
  });
  const chunks = [];
  for await (const chunk of sseToLlamaChunks(stream.getReader())) chunks.push(chunk);
  return chunks;
}

describe("a provider's answer, in llama-server's shape", () => {
  it("reads back as text, reasoning, tool calls and a finish with counts", async () => {
    const chunks = await readBack((sse) => {
      sse.delta({ reasoning: "hmm" });
      sse.delta({ content: "Hi" });
      sse.delta({ toolCalls: [{ index: 0, id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":' } }] });
      sse.delta({ toolCalls: [{ index: 0, function: { arguments: '"a"}' } }] });
      sse.finish("tool_calls", { promptTokens: 12, outputTokens: 5 });
      sse.done();
    });
    expect(chunks.map((c) => c.message?.thinking).join("")).toBe("hmm");
    expect(chunks.map((c) => c.message?.content).join("")).toBe("Hi");
    const calls = chunks.flatMap((c) => c.message?.tool_calls ?? []);
    expect(calls).toEqual([{ id: "call_1", function: { name: "read_file", arguments: { path: "a" } } }]);
    const last = chunks.find((c) => c.done);
    expect(last).toMatchObject({ done: true, done_reason: "tool_calls", prompt_eval_count: 12, eval_count: 5 });
  });

  it("carries a length stop through as `length`", async () => {
    const chunks = await readBack((sse) => {
      sse.delta({ content: "cut" });
      sse.finish("length", {});
      sse.done();
    });
    expect(chunks.find((c) => c.done)?.done_reason).toBe("length");
  });

  it("passes the gateway's own events to the reader", async () => {
    const chunks = await readBack((sse) => {
      sse.retry(1, 2, 4000);
      sse.providerState({ instanceId: "openai", state: { id: "r1" } });
      sse.error({ kind: "provider-rate-limited", status: 429, message: "slow down" });
      sse.done();
    });
    expect(chunks[0].retry).toEqual({ attempt: 1, of: 2, retryAfterMs: 4000 });
    expect(chunks[1].provider_state).toEqual({ instanceId: "openai", state: { id: "r1" } });
    expect(chunks[2].error.kind).toBe("provider-rate-limited");
  });

  it("writes nothing for an empty delta, and nothing after done", async () => {
    const chunks = await readBack((sse) => {
      sse.delta({});
      sse.finish("stop");
      sse.done();
      sse.delta({ content: "late" });
    });
    expect(chunks.map((c) => c.message?.content ?? "").join("")).toBe("");
  });

  it("answers a non-streaming request as choices[0].message with usage", () => {
    expect(completion({ content: "ok", usage: { promptTokens: 3, outputTokens: 1 } })).toEqual({
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    });
  });
});

describe("naming a provider's failure", () => {
  const body = (message, extra = {}) => JSON.stringify({ error: { message, ...extra } });

  it("tells the common failures apart", () => {
    expect(fromResponse(401, body("Incorrect API key provided")).kind).toBe("provider-invalid-key");
    expect(fromResponse(429, body("You exceeded your current quota", { code: "insufficient_quota" })).kind).toBe("provider-no-credit");
    expect(fromResponse(429, body("Rate limit reached")).kind).toBe("provider-rate-limited");
    expect(fromResponse(404, body("The model `gpt-x` does not exist")).kind).toBe("provider-model-not-found");
    expect(fromResponse(400, body("This model's maximum context length is 8192 tokens")).kind).toBe("provider-context-too-long");
    expect(fromResponse(403, body("Country, region, or territory not supported")).kind).toBe("provider-region-unavailable");
    expect(fromResponse(400, body("flagged by content filter")).kind).toBe("provider-refused");
    expect(fromResponse(500, "upstream exploded")).toMatchObject({ kind: "provider-unknown-error", providerMessage: "upstream exploded" });
  });

  it("keeps the provider's words and when to try again", () => {
    const failure = fromResponse(429, body("Rate limit reached"), { "retry-after": "7" });
    expect(failure).toMatchObject({ status: 429, providerMessage: "Rate limit reached", retryAfter: 7 });
  });

  it("names a request that got no answer as unreachable", () => {
    expect(fromNetwork(new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") }))).toMatchObject({ kind: "provider-unreachable", providerMessage: "ECONNREFUSED" });
  });

  it("retries overload and rate limits, never an exhausted quota or a bad request", () => {
    expect(isRetryable(fromResponse(429, body("Rate limit reached")))).toBe(true);
    expect(isRetryable(fromResponse(503, "busy"))).toBe(true);
    expect(isRetryable(fromResponse(529, "overloaded"))).toBe(true);
    expect(isRetryable(fromResponse(429, body("quota", { code: "insufficient_quota" })))).toBe(false);
    expect(isRetryable(fromResponse(400, body("bad")))).toBe(false);
  });

  it("reads Retry-After as seconds or as a date", () => {
    expect(retryAfterSeconds("3")).toBe(3);
    expect(retryAfterSeconds(new Date(Date.now() + 5000).toUTCString())).toBeGreaterThanOrEqual(4);
    expect(retryAfterSeconds(undefined)).toBeUndefined();
  });
});
