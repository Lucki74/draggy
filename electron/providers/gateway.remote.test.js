import http from "node:http";
import { createRequire } from "node:module";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sseToLlamaChunks } from "../../src/ai/llamaStream";

const require = createRequire(import.meta.url);
const { createGateway } = require("./gateway.cjs");
const { createRegistry } = require("./registry.cjs");

/** A stand-in provider: answers each request with the next scripted reply, and notes what it was sent. */
const upstream = { replies: [], requests: [], closed: 0, server: null, base: "" };
const engine = { requests: [], server: null, port: 0 };

const sse = (...events) => ({ status: 200, type: "text/event-stream", body: events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("") });
const fail = (status, error, headers = {}) => ({ status, type: "application/json", body: JSON.stringify({ error }), headers });
const HELLO = sse({ choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] }, { choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 4, completion_tokens: 1 } }, "[DONE]");

beforeAll(async () => {
  upstream.server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      upstream.requests.push({ path: req.url, body: body ? JSON.parse(body) : null, authorization: req.headers.authorization });
      res.on("close", () => upstream.closed++);
      const reply = upstream.replies.shift() || { hang: true };
      if (reply.hang) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "x" } }] })}\n\n`);
        return;
      }
      res.writeHead(reply.status, { "Content-Type": reply.type, ...(reply.headers || {}) });
      res.end(reply.body);
    });
  });
  await new Promise((resolve) => upstream.server.listen(0, "127.0.0.1", resolve));
  upstream.base = `http://127.0.0.1:${upstream.server.address().port}`;
  engine.server = http.createServer((req, res) => {
    engine.requests.push(req.url);
    res.end("{}");
  });
  await new Promise((resolve) => engine.server.listen(0, "127.0.0.1", resolve));
  engine.port = engine.server.address().port;
});

afterAll(() => {
  upstream.server.closeAllConnections();
  upstream.server.close();
  engine.server.close();
});

let registry;
beforeEach(() => {
  upstream.replies = [];
  upstream.requests = [];
  engine.requests = [];
  const kv = new Map();
  const vault = new Map();
  registry = createRegistry({
    storage: { getValue: (key) => kv.get(key) ?? null, setValue: (key, value) => kv.set(key, String(value)) },
    secrets: { available: () => true, get: (owner) => vault.get(owner) ?? {}, set: (owner, values) => (vault.set(owner, values), true), remove: (owner) => vault.delete(owner) },
  });
  const custom = registry.add({ type: "custom", baseUrl: `${upstream.base}/v1` });
  registry.setKey(custom.id, "sk-test");
  registry.update(custom.id, { enabled: true });
  const ollama = registry.add({ type: "ollama", baseUrl: upstream.base });
  registry.update(ollama.id, { enabled: true });
});

const gateway = (reg = registry) => createGateway({ enginePort: () => engine.port, isAllowedOrigin: () => true, registry: reg });
const chat = (body) => new Request("draggy-ai://chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const RENDERER = { stream: true, think: true, options: { num_ctx: 8192, num_predict: -1 }, messages: [{ role: "user", content: "hi", draggy_ref: { id: "u1", hash: "h" } }] };

async function read(response) {
  const chunks = [];
  for await (const chunk of sseToLlamaChunks(response.body.getReader())) chunks.push(chunk);
  return chunks;
}

describe("a provider's model, routed", () => {
  it("goes to its own instance's address with Draggy's fields left behind, and reads back as llama-server", async () => {
    upstream.replies = [HELLO];
    const response = await gateway()(chat({ ...RENDERER, model: "@custom/some/model" }));
    expect(response.status).toBe(200);
    const chunks = await read(response);
    expect(chunks.map((c) => c.message?.content ?? "").join("")).toBe("Hello");
    expect(chunks.find((c) => c.done)).toMatchObject({ done_reason: "stop", prompt_eval_count: 4 });
    const sent = upstream.requests[0];
    expect(sent.path).toBe("/v1/chat/completions");
    expect(sent.authorization).toBe("Bearer sk-test");
    expect(sent.body.model).toBe("some/model");
    for (const field of ["think", "options", "draggy_ref"]) expect(JSON.stringify(sent.body)).not.toContain(`"${field}"`);
    expect(engine.requests).toEqual([]);
  });

  it("sends an Ollama model to Ollama's own chat, with its context size", async () => {
    upstream.replies = [{ status: 200, type: "application/x-ndjson", body: `${JSON.stringify({ message: { content: "ok" }, done: true, done_reason: "stop" })}\n` }];
    const chunks = await read(await gateway()(chat({ ...RENDERER, model: "@ollama/qwen3:8b" })));
    expect(chunks.map((c) => c.message?.content ?? "").join("")).toBe("ok");
    expect(upstream.requests[0]).toMatchObject({ path: "/api/chat", body: { model: "qwen3:8b", options: { num_ctx: 8192 } } });
  });

  it("refuses an unknown or switched-off instance before anything is sent", async () => {
    registry.update("ollama", { enabled: false });
    for (const model of ["@nobody/m", "@ollama/qwen3:8b", "@custom"]) {
      const response = await gateway()(chat({ ...RENDERER, model }));
      expect(response.status).toBe(404);
      expect((await response.json()).error.kind).toBe("provider-unknown-error");
    }
    expect(upstream.requests).toEqual([]);
    expect(engine.requests).toEqual([]);
  });

  it("fetches nothing outside the enabled instances' own addresses", async () => {
    const response = await gateway({ ...registry, enabledBaseUrls: () => ["https://api.openai.com/v1"] })(chat({ ...RENDERER, model: "@custom/m" }));
    expect(response.status).toBe(403);
    expect(upstream.requests).toEqual([]);
  });
});

describe("retries and failures, as the renderer reads them", () => {
  it("retries a rate limit, says so, then streams the answer", async () => {
    upstream.replies = [fail(429, { message: "Rate limit reached" }, { "Retry-After": "0" }), fail(503, { message: "busy" }, { "Retry-After": "0" }), HELLO];
    const chunks = await read(await gateway()(chat({ ...RENDERER, model: "@custom/m" })));
    expect(chunks.filter((c) => c.retry).map((c) => c.retry)).toEqual([{ attempt: 1, of: 2, retryAfterMs: 0 }, { attempt: 2, of: 2, retryAfterMs: 0 }]);
    expect(chunks.map((c) => c.message?.content ?? "").join("")).toBe("Hello");
    expect(upstream.requests).toHaveLength(3);
  });

  it("gives up after two retries, and names the failure", async () => {
    upstream.replies = [0, 1, 2].map(() => fail(429, { message: "Rate limit reached" }, { "Retry-After": "0" }));
    const chunks = await read(await gateway()(chat({ ...RENDERER, model: "@custom/m" })));
    expect(chunks.find((c) => c.error).error).toMatchObject({ kind: "provider-rate-limited", status: 429, provider: registry.get("custom").label });
    expect(upstream.requests).toHaveLength(3);
  });

  it("never retries an exhausted quota or a bad key", async () => {
    upstream.replies = [fail(429, { message: "You exceeded your current quota", code: "insufficient_quota" }, { "Retry-After": "0" })];
    expect((await read(await gateway()(chat({ ...RENDERER, model: "@custom/m" })))).find((c) => c.error).error.kind).toBe("provider-no-credit");
    upstream.replies = [fail(401, { message: "Incorrect API key provided" })];
    expect((await read(await gateway()(chat({ ...RENDERER, model: "@custom/m" })))).find((c) => c.error).error.kind).toBe("provider-invalid-key");
    expect(upstream.requests).toHaveLength(2);
  });

  it("ends in an error when the provider calls a tool of its own", async () => {
    upstream.replies = [sse({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "ws", type: "web_search" }] } }] }, "[DONE]")];
    const chunks = await read(await gateway()(chat({ ...RENDERER, model: "@custom/m" })));
    expect(chunks.find((c) => c.error).error.kind).toBe("provider-unknown-error");
    expect(chunks.some((c) => c.message?.tool_calls)).toBe(false);
  });

  it("names an unreachable provider rather than failing the fetch", async () => {
    registry.update("ollama", { baseUrl: "http://127.0.0.1:9" });
    const response = await gateway()(chat({ ...RENDERER, model: "@ollama/m" }));
    expect(response.status).toBe(200);
    expect((await read(response)).find((c) => c.error).error.kind).toBe("provider-unreachable");
  });

  it("stops the provider's request when the renderer stops reading", async () => {
    upstream.replies = [{ hang: true }];
    const before = upstream.closed;
    const reader = (await gateway()(chat({ ...RENDERER, model: "@custom/m" }))).body.getReader();
    await reader.read();
    await reader.cancel();
    for (let i = 0; i < 50 && upstream.closed === before; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(upstream.closed).toBeGreaterThan(before);
  });
});

describe("the non-streaming form", () => {
  it("answers as choices[0].message with usage", async () => {
    upstream.replies = [{ status: 200, type: "application/json", body: JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 1 } }) }];
    const response = await gateway()(chat({ ...RENDERER, stream: false, model: "@custom/m" }));
    expect(await response.json()).toMatchObject({ choices: [{ message: { role: "assistant", content: "ok" } }], usage: { prompt_tokens: 2, completion_tokens: 1 } });
  });

  it("keeps the upstream status, or 502 when there is none, with the named error", async () => {
    upstream.replies = [fail(404, { message: "The model `m` does not exist" })];
    const missing = await gateway()(chat({ ...RENDERER, stream: false, model: "@custom/m" }));
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toMatchObject({ kind: "provider-model-not-found", provider: registry.get("custom").label });
    registry.update("ollama", { baseUrl: "http://127.0.0.1:9" });
    const gone = await gateway()(chat({ ...RENDERER, stream: false, model: "@ollama/m" }));
    expect(gone.status).toBe(502);
    expect((await gone.json()).error.kind).toBe("provider-unreachable");
  });
});

describe("an account's model", () => {
  const account = (script) => {
    const calls = [];
    return {
      calls,
      stream: async (args) => {
        calls.push(args);
        await script(args);
      },
    };
  };
  const accountGateway = (codex) => createGateway({ enginePort: () => engine.port, isAllowedOrigin: () => true, registry, accounts: { codex } });

  beforeEach(() => {
    registry.add({ type: "chatgpt" });
    registry.update("chatgpt", { enabled: true });
  });

  it("goes to its runtime, never to an address, and streams back as llama-server", async () => {
    const codex = account(({ sse }) => {
      sse.delta({ content: "Hi" });
      sse.providerState({ instanceId: "chatgpt", state: { threadId: "t1" } });
      sse.finish("stop", { promptTokens: 3, outputTokens: 1 });
    });
    const chunks = await read(await accountGateway(codex)(chat({ ...RENDERER, model: "@chatgpt/gpt-5.5" })));
    expect(chunks.map((c) => c.message?.content ?? "").join("")).toBe("Hi");
    expect(chunks.find((c) => c.provider_state)).toMatchObject({ provider_state: { instanceId: "chatgpt" } });
    expect(codex.calls[0]).toMatchObject({ modelId: "gpt-5.5", body: { think: true }, connection: { instance: { id: "chatgpt" } } });
    expect(upstream.requests).toEqual([]);
    expect(engine.requests).toEqual([]);
  });

  it("names the account's failure, and is refused without a runtime to reach", async () => {
    const codex = account(() => {
      throw Object.assign(new Error("signed out"), { failure: { kind: "account-signed-out", status: 0, message: "signed out" } });
    });
    const chunks = await read(await accountGateway(codex)(chat({ ...RENDERER, model: "@chatgpt/gpt-5.5" })));
    expect(chunks.find((c) => c.error)?.error).toMatchObject({ kind: "account-signed-out", provider: "ChatGPT" });
    const refused = await gateway()(chat({ ...RENDERER, model: "@chatgpt/gpt-5.5" }));
    expect(refused.status).toBe(404);
  });

  it("aborts the runtime's turn when the renderer stops reading", async () => {
    let signal;
    const codex = account((args) => {
      signal = args.signal;
      args.sse.delta({ content: "x" });
      return new Promise((resolve) => args.signal.addEventListener("abort", resolve));
    });
    const response = await accountGateway(codex)(chat({ ...RENDERER, model: "@chatgpt/gpt-5.5" }));
    const reader = response.body.getReader();
    await reader.read();
    await reader.cancel();
    expect(signal.aborted).toBe(true);
  });
});

describe("Anthropic through the gateway", () => {
  const SIGNED = { type: "thinking", thinking: "t", signature: "sig" };
  const anthropicRegistry = () => {
    const kv = new Map();
    const vault = new Map();
    const reg = createRegistry({
      storage: { getValue: (key) => kv.get(key) ?? null, setValue: (key, value) => kv.set(key, String(value)) },
      secrets: { available: () => true, get: (owner) => vault.get(owner) ?? {}, set: (owner, values) => (vault.set(owner, values), true), remove: (owner) => vault.delete(owner) },
    });
    const added = reg.add({ type: "anthropic" });
    reg.setKey(added.id, "sk-ant-test");
    reg.update(added.id, { enabled: true });
    return reg;
  };
  const via = (reply) => {
    const sent = [];
    const fetchImpl = async (url, init) => (sent.push({ url, init }), new Response(reply.body, { status: 200, headers: { "Content-Type": reply.type } }));
    return { sent, handle: createGateway({ enginePort: () => engine.port, isAllowedOrigin: () => true, registry: anthropicRegistry(), fetchImpl }) };
  };

  it("streams the signed thinking back tagged with the instance that wrote it", async () => {
    const events = [
      { type: "message_start", message: { usage: { input_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "t" } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
      { type: "message_stop" },
    ];
    const { sent, handle } = via(sse(...events));
    const chunks = await read(await handle(chat({ ...RENDERER, model: "@anthropic/claude-opus-5-5" })));
    expect(sent[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(chunks.find((c) => c.provider_state)?.provider_state).toEqual({ instanceId: "anthropic", state: { blocks: [SIGNED] } });
  });

  it("answers once with the signed thinking on the completion", async () => {
    const reply = { status: 200, type: "application/json", body: JSON.stringify({ content: [SIGNED, { type: "text", text: "Hi" }], stop_reason: "end_turn", usage: {} }) };
    const { handle } = via(reply);
    const json = await (await handle(chat({ ...RENDERER, stream: false, model: "@anthropic/claude-opus-5-5" }))).json();
    expect(json.provider_state).toEqual({ instanceId: "anthropic", state: { blocks: [SIGNED] } });
    expect(json.choices[0].message.content).toBe("Hi");
  });
});
