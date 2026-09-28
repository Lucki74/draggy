import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { catalog, find, capabilitiesFor, problemWith } = require("./catalog.cjs");

describe("the bundled catalog", () => {
  it("holds only entries that pass the bar a remote catalog must also meet", () => {
    for (const entry of catalog()) expect([entry.id, problemWith(entry)]).toEqual([entry.id, null]);
  });

  it("has one entry per id", () => {
    const ids = catalog().map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("sends every cloud provider over https and keeps every local server on loopback", () => {
    for (const entry of catalog()) {
      if (!entry.baseUrl) continue;
      const url = new URL(entry.baseUrl);
      expect([entry.id, entry.kind === "cloud" ? url.protocol : url.hostname]).toEqual([entry.id, entry.kind === "cloud" ? "https:" : "127.0.0.1"]);
    }
  });

  it("never carries a key in a URL, and gives account sign-in only to an account, which has no address", () => {
    for (const entry of catalog()) {
      expect(entry.baseUrl || "").not.toMatch(/[?&]key=/);
      expect([entry.id, entry.auth === "account"]).toEqual([entry.id, entry.kind === "account"]);
      if (entry.kind === "account") expect(entry.baseUrl).toBe("");
    }
    expect(find("chatgpt")).toMatchObject({ kind: "account", protocol: "codex" });
  });

  it("finds local servers by their own probe, not by a shared port alone", () => {
    for (const entry of catalog().filter((e) => e.kind === "local")) expect(entry.discovery.probe).toMatch(/^\//);
  });
});

describe("what a model can do, by its name", () => {
  it("takes the first pattern that matches", () => {
    expect(capabilitiesFor(find("openai"), "gpt-4o-mini").capabilities).toEqual(["tools", "vision"]);
    expect(capabilitiesFor(find("deepseek"), "deepseek-reasoner").capabilities).toEqual(["thinking"]);
  });

  it("claims nothing for a model no pattern names", () => {
    expect(capabilitiesFor(find("perplexity"), "sonar").capabilities).toEqual([]);
    expect(capabilitiesFor(find("openai"), "text-embedding-3-small").capabilities).toEqual([]);
  });
});

describe("the bar a catalog entry must meet", () => {
  const good = { id: "x", name: "X", kind: "cloud", protocol: "openai", auth: "bearer", baseUrl: "https://api.x.test/v1", capabilityPatterns: [], defaultModels: [] };

  it("refuses a cloud entry over plain http, a local one off loopback, and a URL with a query", () => {
    expect(problemWith({ ...good, baseUrl: "http://api.x.test/v1" })).toMatch(/https/);
    expect(problemWith({ ...good, kind: "local", baseUrl: "http://192.168.1.2:8080/v1" })).toMatch(/loopback/);
    expect(problemWith({ ...good, auth: "account" })).toMatch(/account auth/);
    expect(problemWith({ ...good, kind: "account", auth: "account" })).toMatch(/account with a baseUrl/);
    expect(problemWith({ ...good, baseUrl: "https://api.x.test/v1?key=abc" })).toMatch(/query/);
  });

  it("refuses an unknown protocol, auth or capability, and a pattern that is not a regex", () => {
    expect(problemWith({ ...good, protocol: "smtp" })).toMatch(/protocol/);
    expect(problemWith({ ...good, auth: "query-key" })).toMatch(/auth/);
    expect(problemWith({ ...good, capabilityPatterns: [{ match: "", capabilities: ["web_search"] }] })).toMatch(/capability/);
    expect(problemWith({ ...good, capabilityPatterns: [{ match: "(", capabilities: [] }] })).toMatch(/pattern/);
  });
});
