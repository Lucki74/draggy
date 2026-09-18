import { createRequire } from "node:module";
import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const api = require("./apiServer.cjs");

/** The one port Draggy opens. Most of this is about who is turned away, and a real server is
 * started for it, because a check that only passes on paper would be the worst kind here. */

const KEY = "draggy-test-key-0123456789";

describe("who gets in", () => {
  const ok = { host: "127.0.0.1:11500", authorization: `Bearer ${KEY}` };
  const check = (headers) => api.checkRequest({ headers, port: 11500, key: KEY });

  it("lets in a local client with the key", () => {
    expect(check(ok)).toBeNull();
    expect(check({ ...ok, host: "localhost:11500" })).toBeNull();
  });

  it("turns away a request a browser made for a web page, key or not", () => {
    expect(check({ ...ok, origin: "https://example.com" })?.status).toBe(403);
    expect(check({ ...ok, origin: "null" })?.status).toBe(403);
  });

  it("turns away a request addressed to another host, which is what DNS rebinding looks like", () => {
    expect(check({ ...ok, host: "evil.example:11500" })?.status).toBe(403);
    expect(check({ ...ok, host: "127.0.0.1:9999" })?.status).toBe(403);
    expect(check({ ...ok, host: undefined })?.status).toBe(403);
  });

  it("turns away a missing or wrong key", () => {
    expect(check({ host: ok.host })?.status).toBe(401);
    expect(check({ ...ok, authorization: "Bearer nope" })?.status).toBe(401);
    expect(check({ ...ok, authorization: KEY })?.status).toBe(401);
  });

  it("never matches an empty key", () => {
    expect(api.sameKey("", "")).toBe(false);
    expect(api.sameKey("a", "")).toBe(false);
  });

  it("makes keys that are long and never the same twice", () => {
    const first = api.generateKey();
    expect(first).toMatch(/^draggy-[A-Za-z0-9_-]{32}$/);
    expect(api.generateKey()).not.toBe(first);
  });
});

describe("reading a chat completion request", () => {
  it("takes the usual shape", () => {
    expect(
      api.readCompletionRequest({
        model: "qwen3:8b",
        stream: true,
        messages: [
          { role: "system", content: "Be brief." },
          { role: "user", content: "Hi" },
        ],
      }),
    ).toEqual({
      request: {
        model: "qwen3:8b",
        stream: true,
        messages: [
          { role: "system", content: "Be brief." },
          { role: "user", content: "Hi" },
        ],
      },
    });
  });

  it("reads a developer message as a system one, and text parts as text", () => {
    const { request } = api.readCompletionRequest({
      messages: [
        { role: "developer", content: "Rules." },
        { role: "user", content: [{ type: "text", text: "Hello " }, { type: "text", text: "there" }] },
      ],
    });

    expect(request.messages).toEqual([
      { role: "system", content: "Rules." },
      { role: "user", content: "Hello there" },
    ]);
    expect(request.stream).toBe(false);
  });

  it("says plainly what it will not take", () => {
    expect(api.readCompletionRequest(null).error).toBeTruthy();
    expect(api.readCompletionRequest({ messages: [] }).error).toMatch(/non-empty/);
    expect(api.readCompletionRequest({ messages: [{ role: "tool", content: "x" }] }).error).toMatch(/role/);
    expect(api.readCompletionRequest({ messages: [{ role: "system", content: "x" }] }).error).toMatch(/user message/);
    expect(
      api.readCompletionRequest({
        messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "x" } }] }],
      }).error,
    ).toMatch(/not text/);
  });
});

describe("what it sends back", () => {
  it("streams chunks in the OpenAI shape", () => {
    const line = api.chunkLine({ id: "c1", model: "m", created: 1, content: "Hi" });

    expect(line.startsWith("data: ")).toBe(true);
    expect(JSON.parse(line.slice(6))).toEqual({
      id: "c1",
      object: "chat.completion.chunk",
      created: 1,
      model: "m",
      choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }],
    });
  });

  it("answers in one piece with usage", () => {
    const body = JSON.parse(
      api.completionBody({ id: "c1", model: "m", created: 1, content: "Done", usage: { promptTokens: 10, responseTokens: 3 } }),
    );

    expect(body.choices[0].message).toEqual({ role: "assistant", content: "Done" });
    expect(body.usage).toEqual({ prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 });
  });

  it("lists models", () => {
    expect(JSON.parse(api.modelsBody(["a", "b"], 5)).data).toEqual([
      { id: "a", object: "model", created: 5, owned_by: "local" },
      { id: "b", object: "model", created: 5, owned_by: "local" },
    ]);
  });
});

describe("a running server", () => {
  let server;
  let port;

  async function startServer(options = {}) {
    for (let attempt = 0; attempt < 10; attempt++) {
      port = 20000 + Math.floor(Math.random() * 20000);
      server = api.createApiServer({
        port,
        getKey: () => KEY,
        generate: async () => ({ model: "m", content: "", usage: {} }),
        listModels: async () => ["qwen3:8b"],
        ...options,
      });
      const started = await server.start();
      if (started.success) return;
    }
    throw new Error("no free port");
  }

  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  /** A request, with the host header the server expects unless told otherwise. */
  function request({ method = "POST", path = "/v1/chat/completions", headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          method,
          path,
          headers: {
            authorization: `Bearer ${KEY}`,
            "content-type": "application/json",
            ...headers,
          },
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (text += chunk));
          res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
        },
      );
      req.on("error", reject);
      if (body !== undefined) req.write(typeof body === "string" ? body : JSON.stringify(body));
      req.end();
    });
  }

  const hello = { model: "qwen3:8b", messages: [{ role: "user", content: "Hi" }] };

  it("lists the installed models", async () => {
    await startServer();

    const response = await request({ method: "GET", path: "/v1/models" });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.text).data[0].id).toBe("qwen3:8b");
  });

  it("answers a completion in one piece", async () => {
    const generate = vi.fn(async () => ({
      model: "qwen3:8b",
      content: "Hello!",
      usage: { promptTokens: 12, responseTokens: 2 },
    }));
    await startServer({ generate });

    const response = await request({ body: hello });
    const body = JSON.parse(response.text);

    expect(response.status).toBe(200);
    expect(body.choices[0].message.content).toBe("Hello!");
    expect(body.usage.total_tokens).toBe(14);
    expect(generate.mock.calls[0][0]).toEqual({ model: "qwen3:8b", stream: false, messages: hello.messages });
  });

  it("streams a completion as it is written, and ends it properly", async () => {
    await startServer({
      generate: async (_request, { onText, onModel }) => {
        onModel("qwen3:8b");
        onText("Hel");
        onText("lo");
        return { model: "qwen3:8b", content: "Hello", usage: {} };
      },
    });

    const response = await request({ body: { ...hello, stream: true } });
    const events = response.text.split("\n\n").filter(Boolean);

    expect(response.headers["content-type"]).toBe("text/event-stream");
    expect(events.at(-1)).toBe("data: [DONE]");

    const chunks = events.slice(0, -1).map((event) => JSON.parse(event.slice(6)));
    expect(chunks.map((chunk) => chunk.choices[0].delta.content).filter(Boolean).join("")).toBe("Hello");
    expect(chunks.at(-1).choices[0].finish_reason).toBe("stop");
  });

  it("refuses without the key, and from a web page even with it", async () => {
    await startServer();

    expect((await request({ body: hello, headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    expect((await request({ body: hello, headers: { origin: "https://example.com" } })).status).toBe(403);
  });

  it("refuses a request that names another host", async () => {
    await startServer();

    expect((await request({ body: hello, headers: { host: `attacker.example:${port}` } })).status).toBe(403);
  });

  it("refuses what it does not serve, bodies that are not JSON, and bodies that are too big", async () => {
    await startServer();

    expect((await request({ method: "GET", path: "/v1/embeddings" })).status).toBe(404);
    expect((await request({ body: "{not json" })).status).toBe(400);
    expect((await request({ body: { messages: [] } })).status).toBe(400);

    const huge = JSON.stringify({ messages: [{ role: "user", content: "x".repeat(api.MAX_BODY_BYTES + 10) }] });
    const tooBig = await request({ body: huge }).catch(() => ({ status: 413 }));
    expect(tooBig.status).toBe(413);
  });

  it("asks a client to wait when it is already busy", async () => {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    await startServer({
      generate: async () => {
        await gate;
        return { model: "m", content: "ok", usage: {} };
      },
    });

    const first = request({ body: hello });
    const second = request({ body: hello });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const third = await request({ body: hello });
    expect(third.status).toBe(429);

    release();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
  });

  it("stops generating when the client goes away", async () => {
    let seen;
    await startServer({
      generate: (_request, { signal }) =>
        new Promise((resolve, reject) => {
          seen = signal;
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });

    const req = http.request({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/v1/chat/completions",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    });
    req.on("error", () => {});
    req.end(JSON.stringify(hello));

    await vi.waitFor(() => expect(seen).toBeDefined());
    req.destroy();

    await vi.waitFor(() => expect(seen.aborted).toBe(true));
  });

  it("binds to 127.0.0.1 and nothing else", async () => {
    await startServer();

    expect(server.address()).toMatchObject({ address: "127.0.0.1", port });
  });

  it("cannot be reached on another interface that an open server could be reached on", async () => {
    const os = await import("node:os");

    const reachable = (address, target) =>
      new Promise((resolve) => {
        const req = http
          .get({ host: address, port: target, path: "/v1/models", timeout: 700 }, (res) => {
            res.resume();
            resolve(true);
          })
          .on("error", () => resolve(false))
          .on("timeout", () => {
            req.destroy();
            resolve(false);
          });
      });

    // Find an address where a server listening everywhere really is reachable,
    // so that ours not being reachable there actually means something.
    const candidates = Object.values(os.networkInterfaces())
      .flat()
      .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
      .map((entry) => entry.address);

    let proven = null;
    for (const address of candidates) {
      const open = http.createServer((req, res) => res.end("open"));
      const openPort = await new Promise((resolve) => open.listen(0, "0.0.0.0", () => resolve(open.address().port)));
      const ok = await reachable(address, openPort);
      await new Promise((resolve) => open.close(resolve));
      if (ok) {
        proven = address;
        break;
      }
    }

    // No interface here can show the difference; the bound address test above still holds.
    if (!proven) return;

    await startServer();

    expect(await reachable(proven, port)).toBe(false);
    expect(await reachable("127.0.0.1", port)).toBe(true);
  });

  it("says so when the port is taken", async () => {
    await startServer();

    const second = api.createApiServer({
      port,
      getKey: () => KEY,
      generate: async () => ({}),
      listModels: async () => [],
    });

    const started = await second.start();
    expect(started.success).toBe(false);
    expect(started.error).toMatch(/already in use/);
  });
});
