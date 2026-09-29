import { createRequire } from "node:module";
import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createRemoteCatalog, merge, verified, PUBLIC_KEY } = require("./remoteCatalog.cjs");
const { find, useCatalog, bundledCatalog } = require("./catalog.cjs");

const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
const signed = (file) => {
  const body = JSON.stringify(file);
  return { body, signature: crypto.sign(null, Buffer.from(body), privateKey).toString("base64") };
};
const file = (...providers) => ({ version: 1, providers });
const NEWCLOUD = { id: "newcloud", name: "New Cloud", kind: "cloud", protocol: "openai", baseUrl: "https://api.newcloud.example/v1", keyUrl: "https://newcloud.example/keys", auth: "bearer", defaultModels: ["nc-1"] };

afterEach(() => useCatalog(null));

describe("what a signed file may change", () => {
  it("tunes models, capabilities and quirks of a provider Draggy ships", () => {
    const merged = merge(file({ id: "openai", defaultModels: ["gpt-9"], quirks: { developerRole: true } }));
    const openai = merged.find((entry) => entry.id === "openai");
    expect(openai.defaultModels).toEqual(["gpt-9"]);
    expect(openai.quirks).toEqual({ developerRole: true });
    expect(openai.baseUrl).toBe(find("openai").baseUrl);
    expect(merged.length).toBe(bundledCatalog().length);
  });

  it("adds an API-key provider, marked as coming from the file", () => {
    const merged = merge(file(NEWCLOUD));
    expect(merged.at(-1)).toMatchObject({ id: "newcloud", baseUrl: NEWCLOUD.baseUrl, remote: true });
  });

  it.each([
    ["redirects a shipped provider", { id: "openai", baseUrl: "https://evil.example/v1" }],
    ["changes a shipped provider's auth", { id: "anthropic", auth: "bearer" }],
    ["touches an account", { id: "chatgpt", defaultModels: ["x"] }],
    ["adds an account", { ...NEWCLOUD, kind: "account", auth: "account", baseUrl: "" }],
    ["adds a runtime protocol", { ...NEWCLOUD, protocol: "claude" }],
    ["adds a local server", { ...NEWCLOUD, kind: "local", baseUrl: "http://127.0.0.1:9/v1", auth: "none" }],
    ["adds a plain-http cloud", { ...NEWCLOUD, baseUrl: "http://api.newcloud.example/v1" }],
    ["adds a key in the URL", { ...NEWCLOUD, baseUrl: "https://api.newcloud.example/v1?key=1" }],
  ])("rejects the whole file when it %s", (_, entry) => {
    expect(() => merge(file({ id: "ollama", defaultModels: ["llama9"] }, entry))).toThrow(/rejected/);
  });

  it("keeps a remote provider the user added at the address they confirmed", () => {
    const previous = file(NEWCLOUD);
    const inUse = new Set(["newcloud"]);
    expect(() => merge(file({ ...NEWCLOUD, baseUrl: "https://elsewhere.example/v1" }), { inUse, previous })).toThrow(/in use/);
    expect(merge(file(), { inUse, previous }).at(-1)).toMatchObject({ id: "newcloud", baseUrl: NEWCLOUD.baseUrl });
  });
});

describe("fetching providers.json", () => {
  const setup = ({ served = signed(file(NEWCLOUD)), enabled = true, clock = { t: 1e12 } } = {}) => {
    const kv = new Map();
    const lines = [];
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith(".sig")) return new Response(served.signature);
      if (init.headers?.["If-None-Match"] === '"v1"') return new Response(null, { status: 304 });
      return new Response(served.body, { headers: { etag: '"v1"' } });
    };
    const remote = createRemoteCatalog({
      storage: { getValue: (key) => kv.get(key) ?? null, setValue: (key, value) => kv.set(key, value) },
      fetchImpl,
      publicKey,
      now: () => clock.t,
      log: (line) => lines.push(line),
      instances: () => [{ type: "openai", kind: "cloud", enabled }],
    });
    return { remote, kv, lines, calls, clock };
  };

  it("asks nobody while no cloud provider is on", async () => {
    const { remote, calls } = setup({ enabled: false });
    expect(await remote.refresh()).toBe("skipped");
    expect(calls).toEqual([]);
  });

  it("lays a signed file over the catalog, then waits a day and asks with the ETag", async () => {
    const { remote, calls, clock } = setup();
    expect(await remote.refresh()).toBe("updated");
    expect(find("newcloud")).toMatchObject({ remote: true });
    expect(calls[0].url).toBe("https://draggy.org/providers.json");
    expect(await remote.refresh()).toBe("fresh");
    clock.t += 24 * 60 * 60 * 1000;
    expect(await remote.refresh()).toBe("unchanged");
    expect(calls.at(-1).init.headers["If-None-Match"]).toBe('"v1"');
  });

  it("rejects a tampered file, logs it, and keeps the bundled catalog", async () => {
    const good = signed(file(NEWCLOUD));
    const { remote, lines, kv } = setup({ served: { body: good.body.replace("api.newcloud", "api.evil"), signature: good.signature } });
    expect(await remote.refresh()).toBe("failed");
    expect(find("newcloud")).toBeNull();
    expect(lines).toEqual(["providers.json rejected: bad signature"]);
    expect(JSON.parse(kv.get("providers.remote")).body).toBeUndefined();
  });

  it("checks the stored copy again at start, so an edit on disk is not trusted", async () => {
    const { remote, kv, lines } = setup();
    await remote.refresh();
    useCatalog(null);
    expect(remote.load()).toBe(true);
    expect(find("newcloud")).not.toBeNull();
    useCatalog(null);
    const saved = JSON.parse(kv.get("providers.remote"));
    kv.set("providers.remote", JSON.stringify({ ...saved, body: saved.body.replace("api.newcloud", "api.evil") }));
    expect(remote.load()).toBe(false);
    expect(find("newcloud")).toBeNull();
    expect(lines.at(-1)).toMatch(/signature/);
  });

  it("ships a well-formed ed25519 public key", () => {
    expect(crypto.createPublicKey(PUBLIC_KEY).asymmetricKeyType).toBe("ed25519");
    expect(verified("x", "not base64 at all", PUBLIC_KEY)).toBe(false);
  });
});
