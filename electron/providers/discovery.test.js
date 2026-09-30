import http from "node:http";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createDiscovery } = require("./discovery.cjs");

let asked;

/** A fetch standing in for loopback: `servers` maps a port to the paths it answers. */
function fakeFetch(servers) {
  return async (url) => {
    asked.push(url);
    const { hostname, port, pathname } = new URL(url);
    if (hostname !== "127.0.0.1") throw new Error(`probed ${hostname}`);
    const server = servers[port];
    if (!server) throw new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") });
    const body = server[pathname];
    return body === undefined ? new Response("not found", { status: 404 }) : new Response(JSON.stringify(body), { status: 200 });
  };
}

const LLAMA_PROPS = { default_generation_settings: {}, total_slots: 1 };

describe("finding local servers", () => {
  it("names each server by what it answers, not by its port", async () => {
    asked = [];
    const discovery = createDiscovery({
      fetchImpl: fakeFetch({
        11434: { "/api/version": { version: "0.12.0" } },
        1234: { "/api/v0/models": { data: [] } },
        8080: { "/props": LLAMA_PROPS, "/v1/models": { data: [] } },
        8000: { "/api/v1/models": { data: [] } },
        1337: { "/v1/models": { data: [{ id: "m" }] } },
      }),
    });
    const found = await discovery.scan();
    expect(found.map((f) => [f.type, f.port, f.guessed])).toEqual([
      ["ollama", 11434, false],
      ["lmstudio", 1234, false],
      ["llamacpp", 8080, false],
      ["lemonade", 8000, false],
      ["jan", 1337, true],
    ]);
    expect(found[0].baseUrl).toBe("http://127.0.0.1:11434");
    expect(found[3].baseUrl).toBe("http://127.0.0.1:8000/api/v1");
  });

  it("never probes Draggy's engine, its API server or the dev server", async () => {
    asked = [];
    const discovery = createDiscovery({ excludedPorts: () => [8080, 11500], isDev: () => true, fetchImpl: fakeFetch({ 8080: { "/props": LLAMA_PROPS } }) });
    expect(await discovery.scan()).toEqual([]);
    expect(asked.some((url) => /:(8080|11500|5173)\//.test(url))).toBe(false);
    expect(discovery.ports()).not.toContain(5173);
  });

  it("stops at the first refusal, so an empty port costs one probe", async () => {
    asked = [];
    await createDiscovery({ fetchImpl: fakeFetch({}) }).scan();
    const perPort = new Map();
    for (const url of asked) perPort.set(new URL(url).port, (perPort.get(new URL(url).port) || 0) + 1);
    expect([...perPort.values()].every((n) => n === 1)).toBe(true);
  });
});

describe("a server that does not answer", () => {
  let server;
  let port;
  beforeAll(async () => {
    server = http.createServer(() => undefined);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it("is given up on within the timeout", async () => {
    const started = Date.now();
    const discovery = createDiscovery({
      fetchImpl: (url, init) => fetch(url.replace(/:\d+\//, `:${port}/`), init),
    });
    expect(await discovery.scan()).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
