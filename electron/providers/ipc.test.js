import { createRequire } from "node:module";
import { beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createProviderHandlers } = require("./ipc.cjs");
const { createRegistry } = require("./registry.cjs");

let handlers;
let forgotten;
let listing;

beforeEach(() => {
  const kv = new Map();
  const vault = new Map();
  const registry = createRegistry({
    storage: { getValue: (key) => kv.get(key) ?? null, setValue: (key, value) => kv.set(key, String(value)) },
    secrets: { available: () => true, get: (owner) => vault.get(owner) ?? {}, set: (owner, values) => (vault.set(owner, values), true), remove: (owner) => vault.delete(owner) },
  });
  forgotten = [];
  listing = async () => [{ id: "gpt-5.5" }, { id: "gpt-5-mini" }];
  const models = { list: (id, options) => listing(id, options), forget: (id) => forgotten.push(id) };
  const discovery = { scan: async () => [{ type: "ollama", port: 11434 }] };
  handlers = createProviderHandlers({ registry, models, discovery });
});

describe("what the renderer can ask", () => {
  it("never hands a key back, from any call", async () => {
    handlers["providers:add"]({ type: "openai" });
    const answers = [
      handlers["providers:set-key"]("openai", "sk-secret-4f2a"),
      handlers["providers:update"]("openai", { enabled: true }),
      handlers["providers:list"](),
    ];
    for (const answer of answers) expect(JSON.stringify(answer)).not.toContain("sk-secret");
    expect(handlers["providers:list"]()[0]).toMatchObject({ hasKey: true, keyHint: "4f2a", enabled: true });
  });

  it("answers a refused change with the reason, not a thrown error", () => {
    expect(handlers["providers:add"]({ type: "nope" })).toMatchObject({ success: false, error: { kind: "provider-unknown-error" } });
    handlers["providers:add"]({ type: "openai" });
    expect(handlers["providers:update"]("openai", { enabled: true }).error.message).toMatch(/key/);
  });

  it("drops a cached listing whenever the address or the key changes", () => {
    handlers["providers:add"]({ type: "ollama" });
    handlers["providers:update"]("ollama", { label: "Mine" });
    expect(forgotten).toEqual([]);
    handlers["providers:update"]("ollama", { baseUrl: "http://127.0.0.1:11440" });
    handlers["providers:add"]({ type: "openai" });
    handlers["providers:set-key"]("openai", "sk");
    handlers["providers:remove"]("openai");
    expect(forgotten).toEqual(["ollama", "openai", "openai"]);
  });

  it("tests with a fresh listing, and names a failure by kind", async () => {
    const asked = [];
    listing = async (id, options) => (asked.push(options), [{ id: "m" }]);
    expect(await handlers["providers:test"]("openai")).toEqual({ success: true, count: 1 });
    expect(asked).toEqual([{ refresh: true }]);
    listing = async () => {
      throw Object.assign(new Error("refused"), { failure: { kind: "provider-invalid-key", status: 401 } });
    };
    expect(await handlers["providers:test"]("openai")).toEqual({ success: false, error: { kind: "provider-invalid-key", status: 401 } });
  });

  it("lists the catalog without its quirks or patterns", () => {
    const openai = handlers["providers:catalog"]().find((entry) => entry.id === "openai");
    expect(openai).toMatchObject({ name: "OpenAI", kind: "cloud", needsKey: true, editableBaseUrl: false });
    expect(Object.keys(openai)).not.toContain("quirks");
    expect(handlers["providers:catalog"]().find((entry) => entry.id === "custom")).toMatchObject({ needsKey: false, editableBaseUrl: true });
  });
});
