import { createRequire } from "node:module";
import { beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createModels } = require("./models.cjs");
const { createRegistry } = require("./registry.cjs");

let registry;
let routes;
let fetched;
let clock;

/** A fetch that answers from `routes` by URL, and notes every URL and header it was asked for. */
const fakeFetch = async (url, init) => {
  fetched.push({ url, authorization: init.headers?.Authorization });
  const route = routes[url];
  if (!route) throw new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") });
  const { status = 200, body } = typeof route === "function" ? route(init) : route;
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
};

beforeEach(() => {
  routes = {};
  fetched = [];
  clock = 0;
  const kv = new Map();
  const vault = new Map();
  registry = createRegistry({
    storage: { getValue: (key) => kv.get(key) ?? null, setValue: (key, value) => kv.set(key, String(value)) },
    secrets: { available: () => true, get: (owner) => vault.get(owner) ?? {}, set: (owner, values) => (vault.set(owner, values), true), remove: (owner) => vault.delete(owner) },
  });
});

const models = () => createModels({ registry, fetchImpl: fakeFetch, now: () => clock });

describe("an OpenAI-compatible listing", () => {
  beforeEach(() => {
    registry.add({ type: "openai" });
    registry.setKey("openai", "sk-test");
    routes["https://api.openai.com/v1/models"] = { body: { data: [{ id: "gpt-5.5" }, { id: "gpt-4o" }, { id: "whisper-1" }] } };
  });

  it("asks the instance's own address with its key, and fills capabilities from the catalog", async () => {
    const listed = await models().list("openai");
    expect(fetched).toEqual([{ url: "https://api.openai.com/v1/models", authorization: "Bearer sk-test" }]);
    expect(listed.find((m) => m.id === "gpt-5.5")).toMatchObject({ ref: "@openai/gpt-5.5", capabilities: ["completion", "tools", "vision", "thinking"], cloud: true, pinned: true });
    expect(listed.find((m) => m.id === "gpt-4o")).toMatchObject({ capabilities: ["completion", "tools", "vision"], pinned: false });
    expect(listed.find((m) => m.id === "whisper-1").capabilities).toEqual(["completion"]);
  });

  it("lets the user's override win over everything", async () => {
    registry.update("openai", { modelOverrides: { "gpt-4o": { vision: false, thinking: true } } });
    expect((await models().list("openai")).find((m) => m.id === "gpt-4o").capabilities).toEqual(["completion", "tools", "thinking"]);
  });

  it("keeps a listing for a day, and asks again on refresh or after", async () => {
    const m = models();
    await m.list("openai");
    clock = 23 * 60 * 60 * 1000;
    await m.list("openai");
    expect(fetched).toHaveLength(1);
    await m.list("openai", { refresh: true });
    clock += 25 * 60 * 60 * 1000;
    await m.list("openai");
    expect(fetched).toHaveLength(3);
  });

  it("names a refused listing by kind", async () => {
    routes["https://api.openai.com/v1/models"] = { status: 401, body: { error: { message: "Incorrect API key provided" } } };
    await expect(models().list("openai")).rejects.toMatchObject({ failure: { kind: "provider-invalid-key" } });
  });
});

describe("what a listing says for itself", () => {
  it("takes OpenRouter's parameters and modalities over the patterns", async () => {
    registry.add({ type: "openrouter" });
    routes["https://openrouter.ai/api/v1/models"] = {
      body: { data: [{ id: "a/text-only", supported_parameters: ["temperature"], architecture: { input_modalities: ["text"] } }, { id: "b/seeing", context_length: 200000, supported_parameters: ["tools"], architecture: { input_modalities: ["text", "image"] } }] },
    };
    const listed = await models().list("openrouter");
    expect(listed.map((m) => m.capabilities)).toEqual([["completion"], ["completion", "tools", "vision"]]);
    expect(listed[1].contextLength).toBe(200000);
  });

  it("reads Ollama's /api/show, and marks its cloud models as leaving the machine", async () => {
    registry.add({ type: "ollama" });
    routes["http://127.0.0.1:11434/api/tags"] = { body: { models: [{ name: "qwen3:8b" }, { name: "gpt-oss:120b-cloud" }] } };
    routes["http://127.0.0.1:11434/api/show"] = (init) =>
      JSON.parse(init.body).model === "qwen3:8b" ? { body: { capabilities: ["completion", "tools", "thinking"], model_info: { "qwen3.context_length": 40960 } } } : { status: 404, body: {} };
    const [cloud, local] = await models().list("ollama");
    expect(local).toMatchObject({ id: "qwen3:8b", capabilities: ["completion", "tools", "thinking"], contextLength: 40960, cloud: false });
    expect(cloud).toMatchObject({ id: "gpt-oss:120b-cloud", cloud: true });
  });

  it("reads LM Studio's own listing, leaving out embedding models", async () => {
    registry.add({ type: "lmstudio" });
    routes["http://127.0.0.1:1234/api/v0/models"] = {
      body: { data: [{ id: "gemma-3", type: "vlm", capabilities: ["tool_use"], max_context_length: 131072 }, { id: "nomic-embed", type: "embeddings" }] },
    };
    expect(await models().list("lmstudio")).toEqual([expect.objectContaining({ id: "gemma-3", capabilities: ["completion", "tools", "vision"], contextLength: 131072, cloud: false })]);
  });

  it("reports no thinking where Draggy has no switch to send", async () => {
    registry.add({ type: "deepseek" });
    registry.setKey("deepseek", "sk");
    routes["https://api.deepseek.com/v1/models"] = { body: { data: [{ id: "deepseek-reasoner" }] } };
    expect((await models().list("deepseek"))[0].capabilities).not.toContain("thinking");
  });
});

describe("an account's listing", () => {
  it("asks the account's runtime, never an address, and offers its thinking switch", async () => {
    registry.add({ type: "chatgpt" });
    const asked = [];
    const accounts = { codex: { models: async (id) => (asked.push(id), [{ id: "gpt-5.5", name: "GPT-5.5", inputModalities: ["text", "image"] }]) } };
    const listed = await createModels({ registry, accounts, fetchImpl: fakeFetch, now: () => clock }).list("chatgpt");
    expect(asked).toEqual(["chatgpt"]);
    expect(fetched).toEqual([]);
    expect(listed).toEqual([expect.objectContaining({ id: "gpt-5.5", ref: "@chatgpt/gpt-5.5", cloud: true, capabilities: ["completion", "tools", "vision", "thinking"] })]);
  });

  it("names a missing runtime rather than fetching", async () => {
    registry.add({ type: "chatgpt" });
    await expect(models().list("chatgpt")).rejects.toMatchObject({ failure: { kind: "account-runtime-unavailable" } });
    expect(fetched).toEqual([]);
  });
});

describe("an account's listing", () => {
  let calls;
  const listing = (answer) => ({ claude: { models: async () => { calls += 1; return answer(); } } });
  beforeEach(() => {
    calls = 0;
    registry.add({ type: "claude" });
  });

  it("gives an alias the window of the model it resolves to, and keeps the runtime's versioned name", async () => {
    const accounts = listing(() => [
      { id: "opus", name: "Opus 5.5", resolved: "claude-opus-5-5" },
      { id: "sonnet", name: "Sonnet 5.5", resolved: "claude-sonnet-5-5" },
      { id: "haiku", name: "Haiku 4.5", resolved: "claude-haiku-4-5-20251001" },
    ]);
    const listed = await createModels({ registry, accounts, now: () => clock }).list("claude");
    expect(listed.map((m) => [m.id, m.name, m.contextLength])).toEqual([
      ["haiku", "Haiku 4.5", 200000],
      ["opus", "Opus 5.5", 1000000],
      ["sonnet", "Sonnet 5.5", 1000000],
    ]);
  });

  it("keeps a refusal a minute, so opening the model menu does not start the runtime every time", async () => {
    const m = createModels({ registry, accounts: listing(() => { throw new Error("refused"); }), now: () => clock });
    await expect(m.list("claude")).rejects.toThrow("refused");
    await expect(m.list("claude")).rejects.toThrow("refused");
    expect(calls).toBe(1);
    clock = 61 * 1000;
    await expect(m.list("claude")).rejects.toThrow("refused");
    expect(calls).toBe(2);
    await expect(m.list("claude", { refresh: true })).rejects.toThrow("refused");
    expect(calls).toBe(3);
  });
});