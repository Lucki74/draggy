import { createRequire } from "node:module";
import { beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createAutoRefresh, FIRST_MS, EVERY_MS, FOCUS_GAP_MS } = require("./autoRefresh.cjs");
const { createModels } = require("./models.cjs");
const { createRegistry } = require("./registry.cjs");

let registry;
let served;
let calls;
let events;
let timers;
let clock;
let busy;

const fakeFetch = async (url) => {
  calls.push(url);
  if (!served[url]) throw new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") });
  return new Response(JSON.stringify(served[url]), { status: 200, headers: { "Content-Type": "application/json" } });
};

const setup = () => {
  const accounts = { claude: { busy: () => busy, models: async () => [{ id: "opus", name: "Opus" }, ...(served.claude || [])] } };
  const models = createModels({ registry, accounts, fetchImpl: fakeFetch, now: () => clock });
  return createAutoRefresh({
    registry,
    models,
    accounts,
    notify: (channel, payload) => events.push([channel, payload]),
    now: () => clock,
    setTimer: (fn, delay) => (timers.push({ fn, delay }), { unref() {} }),
    clearTimer: () => {},
  });
};

const OPENAI = "https://api.openai.com/v1/models";
const listing = (...ids) => ({ data: ids.map((id) => ({ id })) });

beforeEach(() => {
  served = {};
  calls = [];
  events = [];
  timers = [];
  clock = 0;
  busy = false;
  const kv = new Map();
  const vault = new Map();
  registry = createRegistry({
    storage: { getValue: (key) => kv.get(key) ?? null, setValue: (key, value) => kv.set(key, String(value)) },
    secrets: { available: () => true, get: (owner) => vault.get(owner) ?? {}, set: (owner, values) => (vault.set(owner, values), true), remove: (owner) => vault.delete(owner) },
  });
  registry.add({ type: "openai" });
  registry.setKey("openai", "sk-test");
  registry.update("openai", { enabled: true });
});

const fire = async () => timers.shift().fn();

describe("the schedule", () => {
  it("lists once shortly after launch and then every six hours", async () => {
    const auto = setup();
    served[OPENAI] = listing("gpt-5.5");
    auto.start();
    expect(timers[0].delay).toBe(FIRST_MS);
    await fire();
    expect(calls).toHaveLength(1);
    expect(timers[0].delay).toBe(EVERY_MS);
    clock += EVERY_MS;
    await fire();
    expect(calls).toHaveLength(2);
  });

  it("skips a provider that is offline and still schedules the next round", async () => {
    const auto = setup();
    auto.start();
    await fire();
    expect(events).toEqual([]);
    expect(timers).toHaveLength(1);
  });

  it("leaves disabled providers alone", async () => {
    registry.update("openai", { enabled: false });
    const auto = setup();
    served[OPENAI] = listing("gpt-5.5");
    await auto.round(false);
    expect(calls).toEqual([]);
  });
});

describe("pinning what is new", () => {
  it("seeds the first time and pins nothing", async () => {
    const auto = setup();
    served[OPENAI] = listing("gpt-5.5", "gpt-4o");
    await auto.round(false);
    expect(registry.get("openai")).toMatchObject({ pinnedModels: ["gpt-5.5", "gpt-5-mini"], seenModels: ["gpt-4o", "gpt-5.5"] });
  });

  it("pins a new id, keeps an unticked one off, skips noise, and tells the page", async () => {
    const auto = setup();
    served[OPENAI] = listing("gpt-5.5", "gpt-4o");
    await auto.round(false);
    served[OPENAI] = listing("gpt-5.5", "gpt-4o", "gpt-6", "text-embedding-4");
    await auto.round(false);
    const stored = registry.get("openai");
    expect(stored.pinnedModels).toContain("gpt-6");
    expect(stored.pinnedModels).not.toContain("gpt-4o");
    expect(stored.pinnedModels).not.toContain("text-embedding-4");
    expect(stored.seenModels).toContain("text-embedding-4");
    expect(events).toEqual([["providers:models-changed", { id: "openai", added: ["gpt-6"] }]]);
  });

  it("stays quiet when nothing moved", async () => {
    const auto = setup();
    served[OPENAI] = listing("gpt-5.5");
    await auto.round(false);
    await auto.round(false);
    expect(events).toEqual([]);
  });
});

describe("a subscription login", () => {
  beforeEach(() => {
    registry.add({ type: "claude" });
    registry.update("claude", { enabled: true });
    served[OPENAI] = listing();
  });

  it("asks the runtime again on every round and pins a model it gained", async () => {
    const auto = setup();
    await auto.round(false);
    served.claude = [{ id: "fable", name: "Fable" }];
    await auto.round(false);
    expect(registry.get("claude").pinnedModels).toContain("fable");
  });

  it("does not list while a turn runs on the account", async () => {
    const auto = setup();
    busy = true;
    served.claude = [{ id: "fable" }];
    await auto.round(false);
    expect(registry.get("claude").seenModels).toBeUndefined();
  });
});

describe("a local server", () => {
  it("refreshes on window focus, at most once a minute", async () => {
    registry.add({ type: "ollama" });
    registry.update("ollama", { enabled: true });
    const auto = setup();
    auto.start();
    served["http://127.0.0.1:11434/api/tags"] = { models: [{ name: "llama3" }] };
    served["http://127.0.0.1:11434/api/show"] = {};
    await auto.focused();
    const first = calls.filter((c) => c.includes("11434")).length;
    expect(first).toBeGreaterThan(0);
    clock += FOCUS_GAP_MS - 1;
    await auto.focused();
    expect(calls.filter((c) => c.includes("11434")).length).toBe(first);
  });
});
