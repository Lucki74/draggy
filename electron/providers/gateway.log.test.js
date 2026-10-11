import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const logger = require("../logger.cjs");
const { createGateway } = require("./gateway.cjs");
const { createRegistry } = require("./registry.cjs");

const APP = "app://draggy";
let tempDir;
let files;
let server;
let port;
let seen;
let status = 200;
let reply = null;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen = req.headers;
    req.resume();
    req.on("end", () => {
      res.writeHead(status, { "Content-Type": "application/json", "request-id": "req_upstream_1" });
      res.end(reply ?? (status === 200 ? '{"choices":[]}' : '{"error":{"message":"nope"}}'));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});
afterAll(() => server.close());

beforeEach(() => {
  status = 200;
  reply = null;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-gw-test-"));
  files = logger.init({ getPath: () => tempDir, getName: () => "Draggy", getVersion: () => "0" });
});
afterEach(async () => {
  await logger.closeStreams();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const events = async () => {
  await logger.flush();
  return fs.readFileSync(files.eventsFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
};

const call = (gateway, id) =>
  gateway(
    new Request("draggy-ai://chat", {
      method: "POST",
      headers: { origin: APP, "content-type": "application/json", "x-request-id": id },
      body: '{"model":"m.gguf"}',
    }),
  );

describe("gateway logging", () => {
  it("sends the turn's id to the engine and logs the answer under it", async () => {
    const gateway = createGateway({ enginePort: () => port, isAllowedOrigin: (o) => o === APP });
    const response = await call(gateway, "turn-abc");
    await response.text();
    expect(seen["x-request-id"]).toBe("turn-abc");
    const line = (await events()).find((e) => e.msg === "engine responded");
    expect(line).toMatchObject({ scope: "providers.gateway", cid: "turn-abc", data: { status: 200 } });
  });

  it("keeps the prompt and the reply out of every log file", async () => {
    const prompt = "purple-giraffe-prompt-7731";
    const answer = "teal-walrus-reply-9154";
    reply = JSON.stringify({ choices: [{ message: { role: "assistant", content: answer } }] });
    const gateway = createGateway({ enginePort: () => port, isAllowedOrigin: (o) => o === APP });
    const response = await gateway(
      new Request("draggy-ai://chat", {
        method: "POST",
        headers: { origin: APP, "content-type": "application/json", "x-request-id": "turn-leak" },
        body: JSON.stringify({ model: "m.gguf", messages: [{ role: "user", content: prompt }] }),
      }),
    );
    expect(await response.text()).toContain(answer);
    await logger.flush();

    const walk = (dir) =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
      );
    const written = walk(tempDir);
    expect(written.length).toBeGreaterThan(0);
    for (const file of written) {
      const text = fs.readFileSync(file, "utf8");
      expect(text, file).not.toContain(prompt);
      expect(text, file).not.toContain(answer);
    }
  });

  it("warns with the status when the engine refuses", async () => {
    status = 503;
    const gateway = createGateway({ enginePort: () => port, isAllowedOrigin: (o) => o === APP });
    await (await call(gateway, "turn-xyz")).text();
    expect((await events()).find((e) => e.msg === "engine refused")).toMatchObject({ level: "WARN", cid: "turn-xyz", data: { status: 503 } });
  });

  it("logs an unreachable engine as an error with the id", async () => {
    const gateway = createGateway({ enginePort: () => 9, isAllowedOrigin: (o) => o === APP });
    const response = await call(gateway, "turn-down");
    expect(response.type).toBe("error");
    expect((await events()).find((e) => e.msg === "engine unreachable")).toMatchObject({ level: "ERROR", cid: "turn-down" });
  });

  it("logs a provider refusal with the provider's own request id", async () => {
    status = 429;
    const kv = new Map();
    const vault = new Map();
    const registry = createRegistry({
      storage: { getValue: (key) => kv.get(key) ?? null, setValue: (key, value) => kv.set(key, String(value)) },
      secrets: { available: () => true, get: (owner) => vault.get(owner) ?? {}, set: (owner, values) => (vault.set(owner, values), true), remove: (owner) => vault.delete(owner) },
    });
    const custom = registry.add({ type: "custom", baseUrl: `http://127.0.0.1:${port}/v1` });
    registry.setKey(custom.id, "sk-test");
    registry.update(custom.id, { enabled: true });
    const gateway = createGateway({ enginePort: () => 1, isAllowedOrigin: (o) => o === APP, registry });
    const response = await gateway(
      new Request("draggy-ai://chat", {
        method: "POST",
        headers: { origin: APP, "content-type": "application/json", "x-request-id": "turn-p" },
        body: JSON.stringify({ model: `@${custom.id}/some-model`, stream: false, messages: [] }),
      }),
    );
    await response.text();
    const line = (await events()).find((e) => e.msg === "provider refused");
    expect(line).toBeTruthy();
    expect(line).toMatchObject({ cid: "turn-p", data: { provider: expect.any(String), status: 429, upstreamId: "req_upstream_1" } });
    // The turn id also goes upstream, so the provider's side can be matched to ours.
    expect(seen["x-request-id"]).toBe("turn-p");
  });

  describe("the line each provider request ends with", () => {
    function provider() {
      const kv = new Map();
      const vault = new Map();
      const registry = createRegistry({
        storage: { getValue: (key) => kv.get(key) ?? null, setValue: (key, value) => kv.set(key, String(value)) },
        secrets: { available: () => true, get: (owner) => vault.get(owner) ?? {}, set: (owner, values) => (vault.set(owner, values), true), remove: (owner) => vault.delete(owner) },
      });
      const custom = registry.add({ type: "custom", baseUrl: `http://127.0.0.1:${port}/v1` });
      registry.setKey(custom.id, "sk-test");
      registry.update(custom.id, { enabled: true });
      return { custom, gateway: createGateway({ enginePort: () => 1, isAllowedOrigin: (o) => o === APP, registry }) };
    }

    const ask = (gateway, model, stream, id) =>
      gateway(
        new Request("draggy-ai://chat", {
          method: "POST",
          headers: { origin: APP, "content-type": "application/json", "x-request-id": id },
          body: JSON.stringify({ model, stream, messages: [{ role: "user", content: "SENTINEL-ASK" }] }),
        }),
      );

    it("carries model, host, tokens, finish reason and duration for a plain answer", async () => {
      reply = JSON.stringify({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 3 } });
      const { custom, gateway } = provider();
      await (await ask(gateway, `@${custom.id}/some-model`, false, "turn-s")).text();
      const line = (await events()).find((e) => e.msg === "request finished");
      expect(line).toMatchObject({
        cid: "turn-s",
        data: { model: "some-model", host: `127.0.0.1:${port}`, stream: false, how: "done", finish: "stop", promptTokens: 7, outputTokens: 3, retries: 0 },
      });
      expect(typeof line.data.durMs).toBe("number");
      expect(JSON.stringify(line)).not.toContain("SENTINEL-ASK");
    });

    it("counts events it could not read, and says when the first token came", async () => {
      reply = [
        'data: {"choices":[{"delta":{"content":"a"}}]}',
        "data: {not json",
        'data: {"choices":[{"delta":{},"finish_reason":"length"}],"usage":{"prompt_tokens":4,"completion_tokens":2}}',
        "data: [DONE]",
        "",
      ].join("\n\n");
      const { custom, gateway } = provider();
      await (await ask(gateway, `@${custom.id}/some-model`, true, "turn-t")).text();
      const line = (await events()).find((e) => e.msg === "request finished" && e.scope === "providers.sse");
      expect(line).toMatchObject({
        cid: "turn-t",
        data: { model: "some-model", how: "done", finish: "length", promptTokens: 4, outputTokens: 2, malformed: 1, retries: 0 },
      });
      expect(line.data.ttftMs).not.toBeNull();
    });
  });
});
