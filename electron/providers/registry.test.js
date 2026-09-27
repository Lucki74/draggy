import { createRequire } from "node:module";
import { beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createRegistry } = require("./registry.cjs");

let kv;
let vault;
let keystore;
let registry;

beforeEach(() => {
  kv = new Map();
  vault = new Map();
  keystore = true;
  const storage = { getValue: (key) => kv.get(key) ?? null, setValue: (key, value) => kv.set(key, String(value)) };
  const secrets = {
    available: () => keystore,
    get: (owner) => vault.get(owner) ?? {},
    set: (owner, values) => {
      if (!keystore) return false;
      if (Object.keys(values).length) vault.set(owner, values);
      else vault.delete(owner);
      return true;
    },
    remove: (owner) => vault.delete(owner),
  };
  registry = createRegistry({ storage, secrets });
});

describe("adding a provider", () => {
  it("starts it switched off, under its catalog name, with nothing pinned", () => {
    const added = registry.add({ type: "openai" });
    expect(added).toMatchObject({ id: "openai", type: "openai", label: "OpenAI", enabled: false, pinnedModels: [], hasKey: false });
    expect(added.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("gives a second instance of the same type its own id", () => {
    registry.add({ type: "openai" });
    expect(registry.add({ type: "openai", label: "OpenAI (work)" }).id).toBe("openai-2");
  });

  it("refuses an unknown type", () => {
    expect(() => registry.add({ type: "nope" })).toThrow(/Unknown/);
  });
});

describe("the key", () => {
  it("goes to the keystore and never back to the renderer", () => {
    registry.add({ type: "openai" });
    const shown = registry.setKey("openai", "sk-live-abcdef1234");
    expect(shown.hasKey).toBe(true);
    expect(shown.keyHint).toBe("1234");
    expect(JSON.stringify(registry.list())).not.toContain("sk-live-abcdef1234");
    expect(kv.get("providers")).not.toContain("sk-live");
    expect(registry.connectionFor("openai").apiKey).toBe("sk-live-abcdef1234");
  });

  it("is required before a keyed provider can be switched on", () => {
    registry.add({ type: "openai" });
    expect(() => registry.update("openai", { enabled: true })).toThrow(/key/);
    registry.setKey("openai", "sk-1");
    expect(registry.update("openai", { enabled: true }).enabled).toBe(true);
  });

  it("cannot be stored, nor a keyed provider switched on, without a keystore", () => {
    registry.add({ type: "openai" });
    keystore = false;
    expect(() => registry.setKey("openai", "sk-1")).toThrow(/keystore/);
    expect(() => registry.update("openai", { enabled: true })).toThrow(/keystore/);
  });

  it("is not needed by a local server, which works without a keystore", () => {
    keystore = false;
    registry.add({ type: "ollama" });
    expect(registry.update("ollama", { enabled: true }).enabled).toBe(true);
  });

  it("goes with the provider when it is removed", () => {
    registry.add({ type: "openai" });
    registry.setKey("openai", "sk-1");
    registry.remove("openai");
    expect(vault.size).toBe(0);
    expect(registry.list()).toEqual([]);
  });

  it("switches the provider off when it is cleared", () => {
    registry.add({ type: "openai" });
    registry.setKey("openai", "sk-1");
    registry.update("openai", { enabled: true });
    expect(registry.setKey("openai", "").enabled).toBe(false);
  });
});

describe("addresses", () => {
  it("never lets a cloud provider be pointed elsewhere", () => {
    registry.add({ type: "openai" });
    expect(() => registry.update("openai", { baseUrl: "https://evil.test/v1" })).toThrow(/cannot be changed/);
  });

  it("keeps a local server on this computer, and sends a LAN server to Custom", () => {
    registry.add({ type: "lmstudio" });
    expect(registry.update("lmstudio", { baseUrl: "http://127.0.0.1:1235/v1" }).baseUrl).toBe("http://127.0.0.1:1235/v1");
    expect(() => registry.update("lmstudio", { baseUrl: "http://192.168.1.5:1234/v1" })).toThrow(/Custom/);
    expect(registry.add({ type: "custom", baseUrl: "http://192.168.1.5:1234/v1/" }).baseUrl).toBe("http://192.168.1.5:1234/v1");
  });

  it("refuses a key or credentials hidden in an address", () => {
    expect(() => registry.add({ type: "custom", baseUrl: "https://x.test/v1?key=abc" })).toThrow(/key field/);
    expect(() => registry.add({ type: "custom", baseUrl: "https://user:pw@x.test/v1" })).toThrow(/key field/);
    expect(() => registry.add({ type: "custom", baseUrl: "file:///etc/passwd" })).toThrow(/http/);
  });

  it("lists only enabled providers' addresses for the gateway", () => {
    registry.add({ type: "ollama" });
    registry.add({ type: "lmstudio" });
    registry.update("ollama", { enabled: true });
    expect(registry.enabledBaseUrls()).toEqual(["http://127.0.0.1:11434"]);
  });
});

describe("what a user may change", () => {
  it("keeps only known capability flags in a per-model override", () => {
    registry.add({ type: "ollama" });
    const updated = registry.update("ollama", { modelOverrides: { "llama3.2": { vision: true, tools: "yes", web: true }, empty: {} } });
    expect(updated.modelOverrides).toEqual({ "llama3.2": { vision: true } });
  });

  it("refuses a header that could smuggle another line", () => {
    registry.add({ type: "custom", baseUrl: "https://x.test/v1" });
    expect(() => registry.update("custom", { headers: { "X-A": "a\r\nX-B: b" } })).toThrow(/header/);
  });
});
