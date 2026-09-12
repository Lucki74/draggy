import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const registry = require("./mcpRegistry.cjs");

/**
 * Looking for servers Draggy does not ship. Two rules hold everything here
 * together: nothing reaches the network unless somebody searched, and a search
 * that cannot reach it still answers with whatever it knew.
 */

let workdir;

beforeEach(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-registry-"));
  registry.init(workdir);
});

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

const payload = {
  servers: [
    {
      name: "io.github.someone/weather",
      description: "Weather for anywhere.",
      repository: { url: "https://github.com/someone/weather" },
      packages: [{ registry_name: "npm", name: "@someone/weather-mcp" }],
    },
    {
      name: "com.example/tickets",
      description: "Our ticket system.",
      remotes: [{ type: "streamable-http", url: "https://tickets.example/mcp" }],
    },
    {
      name: "com.example/python-only",
      description: "Needs uvx, which Draggy does not have.",
      packages: [{ registry_name: "pypi", name: "python-thing" }],
    },
  ],
};

const answering = (body, ok = true) =>
  vi.fn(async () => ({
    ok,
    status: ok ? 200 : 503,
    json: async () => body,
  }));

describe("reading what the registry says", () => {
  it("takes a server it can install", () => {
    const [weather] = registry.parseServers(payload);

    expect(weather.id).toBe("weather");
    expect(weather.package).toBe("@someone/weather-mcp");
    expect(weather.docs).toContain("github.com/someone/weather");
  });

  it("takes a server it can call", () => {
    const tickets = registry.parseServers(payload)[1];

    expect(tickets.url).toBe("https://tickets.example/mcp");
    expect(tickets.transport).toBe("http");
    expect(tickets.remote).toBe(true);
  });

  it("leaves out anything it could not run", () => {
    // A Python package needs uvx, which the catalogue deliberately does not use.
    expect(registry.parseServers(payload)).toHaveLength(2);
  });

  it("leaves out what Draggy already ships", () => {
    const entries = registry.parseServers({
      servers: [
        {
          name: "io.github.modelcontextprotocol/github",
          packages: [{ registry_name: "npm", name: "someone-elses-github" }],
        },
      ],
    });

    expect(entries).toEqual([]);
  });

  it("survives a shape it has never seen", () => {
    expect(registry.parseServers(null)).toEqual([]);
    expect(registry.parseServers({ servers: [{}, null] })).toEqual([]);
  });
});

describe("searching", () => {
  it("asks for what was typed", async () => {
    const fetchImpl = answering(payload);

    const result = await registry.search("weather", { fetchImpl });

    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(2);

    const asked = new URL(fetchImpl.mock.calls[0][0]);
    expect(asked.searchParams.get("search")).toBe("weather");
  });

  it("does not ask twice for the same search", async () => {
    const fetchImpl = answering(payload);

    await registry.search("weather", { fetchImpl });
    const again = await registry.search("weather", { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(again.cached).toBe(true);
  });

  it("asks again once the answer is a day old", async () => {
    const fetchImpl = answering(payload);

    await registry.search("weather", { fetchImpl, now: 0 });
    await registry.search("weather", {
      fetchImpl,
      now: registry.CACHE_TTL_MS + 1,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("hands back what it knew when the network is gone", async () => {
    const working = answering(payload);
    await registry.search("weather", { fetchImpl: working, now: 0 });

    const broken = vi.fn(async () => {
      throw new Error("offline");
    });

    const result = await registry.search("weather", {
      fetchImpl: broken,
      now: registry.CACHE_TTL_MS + 1,
    });

    expect(result.success).toBe(true);
    expect(result.stale).toBe(true);
    expect(result.entries).toHaveLength(2);
  });

  it("says plainly when it has nothing and cannot ask", async () => {
    const broken = vi.fn(async () => {
      throw new Error("offline");
    });

    const result = await registry.search("weather", { fetchImpl: broken });

    expect(result.success).toBe(false);
    expect(result.entries).toEqual([]);
    expect(result.error).toContain("offline");
  });

  it("treats an unhappy registry as no answer at all", async () => {
    const result = await registry.search("weather", {
      fetchImpl: answering(payload, false),
    });

    expect(result.success).toBe(false);
  });

  it("keeps the cache in the app's own folder", async () => {
    await registry.search("weather", { fetchImpl: answering(payload) });

    expect(fs.existsSync(path.join(workdir, "registry-cache.json"))).toBe(true);

    registry.forget();
    expect(fs.existsSync(path.join(workdir, "registry-cache.json"))).toBe(false);
  });
});

describe("naming a server", () => {
  it("takes the last part of a namespaced name", () => {
    expect(registry.idFor("io.github.someone/weather-mcp")).toBe("weather-mcp");
  });

  it("makes something usable out of anything", () => {
    expect(registry.idFor("Something Odd!")).toBe("something-odd");
    expect(registry.idFor("")).toBe("server");
  });
});
