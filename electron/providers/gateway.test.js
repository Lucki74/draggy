import http from "node:http";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createGateway } = require("./gateway.cjs");

const APP = "app://draggy";

/** A stand-in for llama-server: streams, fails, or answers, and notes each request and its end. */
const engine = { mode: "stream", requests: [], closedAt: null, server: null, port: 0 };

beforeAll(async () => {
  engine.server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      engine.requests.push({ path: req.url, body });
      if (engine.mode === "fail") {
        res.writeHead(500, { "Content-Type": "application/json", "X-Engine": "llama" });
        res.end('{"error":{"code":500,"message":"model failed to load"}}');
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const timer = setInterval(() => res.write('data: {"choices":[{"delta":{"content":"x"}}]}\n\n'), 20);
      res.on("close", () => {
        clearInterval(timer);
        engine.closedAt = Date.now();
      });
    });
  });
  await new Promise((resolve) => engine.server.listen(0, "127.0.0.1", resolve));
  engine.port = engine.server.address().port;
});

afterAll(() => engine.server.close());

function gateway(port = () => engine.port) {
  return createGateway({ enginePort: port, isAllowedOrigin: (origin) => origin === APP });
}

const chat = (body, origin = APP, method = "POST") =>
  new Request("draggy-ai://chat", {
    method,
    headers: origin ? { origin, "content-type": "application/json" } : { "content-type": "application/json" },
    body: method === "POST" ? body : undefined,
  });

describe("who may use the gateway", () => {
  it("refuses any origin but the app's own, and a request with none", async () => {
    const handle = gateway();
    expect((await handle(chat("{}", "https://evil.example"))).status).toBe(403);
    expect((await handle(chat("{}", ""))).status).toBe(403);
  });

  it("answers the app's preflight for its JSON requests", async () => {
    const response = await gateway()(chat(undefined, APP, "OPTIONS"));
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(APP);
    expect(response.headers.get("access-control-allow-headers")).toContain("content-type");
  });
});

describe("the built-in engine, passed through unchanged", () => {
  it("streams the engine's answer, with the request sent as it came", async () => {
    engine.mode = "stream";
    engine.requests = [];
    const body = JSON.stringify({ model: "Qwen3.5-9B-Q4_K_M.gguf", stream: true, think: true, options: { num_ctx: 8192 } });
    const response = await gateway()(chat(body));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("access-control-allow-origin")).toBe(APP);
    const reader = response.body.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain('"content":"x"');
    await reader.cancel();
    expect(engine.requests.at(-1)).toEqual({ path: "/v1/chat/completions", body });
  });

  it("keeps an engine error's status and body as they were", async () => {
    engine.mode = "fail";
    const response = await gateway()(chat('{"model":"m.gguf"}'));
    expect(response.status).toBe(500);
    expect(response.headers.get("x-engine")).toBe("llama");
    expect(await response.text()).toBe('{"error":{"code":500,"message":"model failed to load"}}');
  });

  it("fails as a network error when the engine is not there", async () => {
    const response = await gateway(() => 9)(chat('{"model":"m.gguf"}'));
    expect(response.type).toBe("error");
  });

  it("stops the engine's request when the renderer stops reading", async () => {
    engine.mode = "stream";
    engine.closedAt = null;
    const response = await gateway()(chat('{"model":"m.gguf","stream":true}'));
    const reader = response.body.getReader();
    await reader.read();
    await reader.read();
    const cancelledAt = Date.now();
    await reader.cancel();
    for (let i = 0; i < 50 && engine.closedAt === null; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(engine.closedAt).not.toBeNull();
    expect(engine.closedAt - cancelledAt).toBeLessThan(1000);
  });

  it("follows the engine to whatever port it is on now", async () => {
    engine.mode = "stream";
    let port = 9;
    const handle = gateway(() => port);
    expect((await handle(chat('{"model":"m.gguf"}'))).type).toBe("error");
    port = engine.port;
    const response = await handle(chat('{"model":"m.gguf"}'));
    expect(response.status).toBe(200);
    await response.body.cancel();
  });
});

describe("what it refuses", () => {
  it("keeps a provider's model away from the engine until providers exist", async () => {
    engine.requests = [];
    const response = await gateway()(chat('{"model":"@anthropic/claude-x"}'));
    expect(response.status).toBe(404);
    expect((await response.json()).error.kind).toBe("provider-unknown-error");
    expect(engine.requests).toEqual([]);
  });

  it("answers only its one endpoint", async () => {
    const other = new Request("draggy-ai://models", { method: "POST", headers: { origin: APP }, body: "{}" });
    expect((await gateway()(other)).status).toBe(404);
  });
});
