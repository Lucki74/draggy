import { createRequire } from "node:module";
import { beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createSearchKey } = require("./searchKey.cjs");

let kv;
let vault;
let keystore;
let searchKey;

beforeEach(() => {
  kv = new Map();
  vault = new Map();
  keystore = true;
  const secrets = {
    available: () => keystore,
    get: (owner) => vault.get(owner) ?? {},
    set: (owner, values) => {
      if (!keystore) return false;
      if (Object.keys(values).length) vault.set(owner, values);
      else vault.delete(owner);
      return true;
    },
  };
  searchKey = createSearchKey({ secrets, storage: { getValue: (key) => kv.get(key) ?? null, setValue: (key, value) => kv.set(key, String(value)) } });
});

describe("the Brave Search key", () => {
  it("goes into the keystore, and is shown back only as its last four", () => {
    expect(searchKey.set("  BSA-secret-9x2k ")).toEqual({ success: true, kept: true });
    expect(vault.get("search:brave")).toEqual({ apiKey: "BSA-secret-9x2k" });
    expect(searchKey.status()).toEqual({ hasKey: true, keyHint: "9x2k", keystore: true });
    expect(JSON.stringify(searchKey.status())).not.toContain("secret");
    expect(searchKey.get()).toBe("BSA-secret-9x2k");
  });

  it("is removed by an empty key", () => {
    searchKey.set("BSA-1");
    searchKey.set("");
    expect(vault.has("search:brave")).toBe(false);
    expect(searchKey.status().hasKey).toBe(false);
  });

  it("lasts this run only without a keystore, and is never written anywhere", () => {
    keystore = false;
    expect(searchKey.set("BSA-mem")).toEqual({ success: true, kept: false });
    expect(searchKey.get()).toBe("BSA-mem");
    expect(vault.size).toBe(0);
    expect([...kv.values()].join()).not.toContain("BSA-mem");
  });
});

describe("a key earlier versions saved in the clear", () => {
  it("moves into the keystore and leaves the settings, which keep everything else", () => {
    kv.set("draggy_settings", JSON.stringify({ theme: "dark", braveApiKey: "BSA-old" }));
    searchKey.adopt();
    expect(vault.get("search:brave")).toEqual({ apiKey: "BSA-old" });
    expect(JSON.parse(kv.get("draggy_settings"))).toEqual({ theme: "dark" });
  });

  it("leaves the settings even without a keystore, holding the key for this run", () => {
    keystore = false;
    kv.set("draggy_settings", JSON.stringify({ theme: "dark", braveApiKey: "BSA-old" }));
    searchKey.adopt();
    expect(kv.get("draggy_settings")).not.toContain("BSA-old");
    expect(searchKey.get()).toBe("BSA-old");
  });

  it("never replaces a key already in the keystore, and leaves settings without one alone", () => {
    searchKey.set("BSA-new");
    kv.set("draggy_settings", JSON.stringify({ braveApiKey: "BSA-old" }));
    searchKey.adopt();
    expect(searchKey.get()).toBe("BSA-new");
    kv.set("draggy_settings", '{"theme":"light"}');
    searchKey.adopt();
    expect(kv.get("draggy_settings")).toBe('{"theme":"light"}');
  });
});
