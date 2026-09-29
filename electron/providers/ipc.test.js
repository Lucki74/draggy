import { createRequire } from "node:module";
import { beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createProviderHandlers } = require("./ipc.cjs");
const { createRegistry } = require("./registry.cjs");
const { bundledCatalog, useCatalog } = require("./catalog.cjs");

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
    const without = createProviderHandlers({ registry: null, models: null, discovery: null, keystore: () => false })["providers:catalog"]();
    expect(Object.fromEntries(without.filter((e) => ["openai", "custom", "ollama"].includes(e.id)).map((e) => [e.id, e.available]))).toEqual({ openai: false, custom: true, ollama: true });
  });

  it("marks a provider only providers.json knows, so the page asks before adding it", () => {
    const added = { id: "newcloud", name: "New Cloud", kind: "cloud", protocol: "openai", baseUrl: "https://api.newcloud.example/v1", auth: "bearer", remote: true };
    useCatalog([...bundledCatalog(), added]);
    try {
      const view = handlers["providers:catalog"]();
      expect(view.find((entry) => entry.id === "newcloud")).toMatchObject({ remote: true, baseUrl: added.baseUrl });
      expect(view.find((entry) => entry.id === "openai").remote).toBe(false);
    } finally {
      useCatalog(null);
    }
  });
});

describe("an account", () => {
  function withAccount({ authUrl = "https://auth.openai.com/oauth/authorize?x=1" } = {}) {
    const kv = new Map();
    const registry = createRegistry({
      storage: { getValue: (key) => kv.get(key) ?? null, setValue: (key, value) => kv.set(key, String(value)) },
      secrets: { available: () => true, get: () => ({}), set: () => true, remove: () => true },
    });
    registry.add({ type: "chatgpt" });
    registry.add({ type: "claude" });
    registry.add({ type: "openai" });
    const calls = [];
    const opened = [];
    const notes = [];
    const forgot = [];
    const runtime = (name) => ({
      signIn: async (id, { onProgress, openExternal }) => {
        calls.push([name, id]);
        onProgress({ step: "browser", url: authUrl });
        await openExternal(authUrl);
        return { signedIn: true, email: "a@b.c" };
      },
      cancel: async (id) => calls.push(["cancel", id]),
      signOut: async (id) => calls.push(["signOut", id]),
      status: async (id) => (calls.push(["status", id]), { signedIn: false }),
    });
    const codex = runtime("signIn");
    const models = { list: async () => [], forget: (id) => forgot.push(id) };
    const handlers = createProviderHandlers({
      registry,
      models,
      discovery: { scan: async () => [] },
      accounts: { codex, claude: runtime("claude") },
      openExternal: async (url) => opened.push(url),
      notify: (channel, payload) => notes.push([channel, payload]),
    });
    return { handlers, calls, opened, notes, forgot };
  }

  it("signs in through its runtime, opens the vendor's page and reports each step", async () => {
    const { handlers, calls, opened, notes, forgot } = withAccount();
    expect(await handlers["providers:account-sign-in"]("chatgpt")).toEqual({ success: true, status: { signedIn: true, email: "a@b.c" } });
    expect(calls).toEqual([["signIn", "chatgpt"]]);
    expect(opened).toEqual(["https://auth.openai.com/oauth/authorize?x=1"]);
    expect(notes).toEqual([["providers:account-progress", { id: "chatgpt", step: "browser", url: "https://auth.openai.com/oauth/authorize?x=1" }]]);
    expect(forgot).toEqual(["chatgpt"]);
  });

  it.each(["https://evil.example/oauth", "http://auth.openai.com/oauth", "file:///C:/x.html", "https://auth.openai.com.evil.example/"])(
    "refuses to open a sign-in page anywhere but the vendor's own host: %s",
    async (authUrl) => {
      const { handlers, opened } = withAccount({ authUrl });
      expect(await handlers["providers:account-sign-in"]("chatgpt")).toMatchObject({ success: false });
      expect(opened).toEqual([]);
    },
  );

  it("signs in to Claude through Claude Code, on claude.com and nowhere else", async () => {
    const good = withAccount({ authUrl: "https://claude.com/cai/oauth/authorize?code=true" });
    expect(await good.handlers["providers:account-sign-in"]("claude")).toMatchObject({ success: true });
    expect(good.calls).toEqual([["claude", "claude"]]);
    expect(good.opened).toEqual(["https://claude.com/cai/oauth/authorize?code=true"]);

    const other = withAccount();
    expect(await other.handlers["providers:account-sign-in"]("claude")).toMatchObject({ success: false });
    expect(other.opened).toEqual([]);
  });

  it("cancels, signs out and reads the status through the same runtime", async () => {
    const { handlers, calls, forgot } = withAccount();
    expect(await handlers["providers:account-cancel"]("chatgpt")).toEqual({ success: true });
    expect(await handlers["providers:account-sign-out"]("chatgpt")).toEqual({ success: true });
    expect(await handlers["providers:account-status"]("chatgpt")).toEqual({ success: true, status: { signedIn: false } });
    expect(calls).toEqual([["cancel", "chatgpt"], ["signOut", "chatgpt"], ["status", "chatgpt"]]);
    expect(forgot).toEqual(["chatgpt"]);
  });

  it("refuses the account calls for a key provider or an unknown one", async () => {
    const { handlers, calls } = withAccount();
    for (const id of ["openai", "nope"]) {
      expect(await handlers["providers:account-status"](id)).toMatchObject({ success: false, error: { kind: "account-runtime-unavailable" } });
    }
    expect(calls).toEqual([]);
  });
});
