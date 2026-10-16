import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const logger = require("./logger.cjs");
const mcp = require("./mcp.cjs");

let tempDir;
let files;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-mcp-log-"));
  files = logger.init({ getPath: () => tempDir, getName: () => "Draggy", getVersion: () => "0" });
});
afterEach(async () => {
  await logger.closeStreams();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("mcp call logging", () => {
  it("tags a refused call with the turn id and names the server and tool", async () => {
    const result = await mcp.callTool("ghost", "read", { secretPath: "C:/private/notes.txt" }, { cid: "turn-9" });
    expect(result.success).toBe(false);
    await logger.flush();
    const text = fs.readFileSync(files.eventsFile, "utf8");
    const line = text.split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.msg.startsWith("cannot call tool"));
    expect(line).toMatchObject({ level: "WARN", cid: "turn-9", data: { server: "ghost", transport: "none", toolName: "read" } });
    expect(text).not.toContain("notes.txt");
  });
});

/** A remote server that answers the handshake and one tool call, with no network. */
function fakeRemote(toolText) {
  const replies = {
    initialize: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake", version: "1" } },
    "tools/list": { tools: [{ name: "read" }] },
    "tools/call": { content: [{ type: "text", text: toolText }] },
  };

  return vi.fn(async (_url, options) => {
    const reply = (status, text) => ({
      ok: true,
      status,
      headers: new Map([["content-type", "application/json"]]),
      text: async () => text,
    });

    if (options.method === "DELETE") return reply(200, "");
    const body = JSON.parse(options.body);
    if (body.id === undefined) return reply(202, "");
    return reply(200, JSON.stringify({ jsonrpc: "2.0", id: body.id, result: replies[body.method] }));
  });
}

function readEvents() {
  return fs.readFileSync(files.eventsFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

describe("mcp server log lines", () => {
  it("logs a tool call's name, timing, result size and argument hash, never the argument", async () => {
    const id = "Acme.Tools 2";
    const secret = "sk-argument-value-do-not-log";
    const args = { path: secret };
    vi.stubGlobal("fetch", fakeRemote("hello from the tool"));

    try {
      await mcp.startServer(id, { url: "https://mcp.example.test/mcp" });
      const result = await mcp.callTool(id, "read", args, { cid: "turn-7" });
      expect(result).toMatchObject({ success: true, text: "hello from the tool" });
      await logger.flush();

      const events = readEvents();
      const call = events.find((e) => e.scope === "mcp.acme-tools-2" && e.msg === "tool call");
      const finished = events.find((e) => e.scope === "mcp.acme-tools-2" && e.msg === "tool finished");

      expect(call.data.argHash).toBe(createHash("sha256").update(JSON.stringify(args)).digest("hex").slice(0, 8));
      expect(finished).toMatchObject({
        level: "INFO",
        cid: "turn-7",
        data: { toolName: "read", isError: false, resultChars: "hello from the tool".length },
      });
      expect(finished.data.durMs).toEqual(expect.any(Number));

      for (const name of fs.readdirSync(tempDir, { recursive: true })) {
        const file = path.join(tempDir, name);
        if (fs.statSync(file).isFile()) expect(fs.readFileSync(file, "utf8")).not.toContain(secret);
      }
    } finally {
      mcp.stopServer(id, true);
      vi.unstubAllGlobals();
    }
  });

  it("files a server's lines under mcp.<id>, with the id cleaned up", async () => {
    const id = "Acme.Tools 2";
    vi.stubGlobal("fetch", fakeRemote("ok"));

    try {
      await mcp.startServer(id, { url: "https://mcp.example.test/mcp" });
      await mcp.callTool(id, "read", {}, {});
      await logger.flush();

      const mine = readEvents().filter((e) => e.data?.server === id);
      expect(mine.map((e) => e.msg)).toEqual(expect.arrayContaining(["connected", "tool call", "tool finished"]));
      for (const event of mine) expect(event.scope).toBe("mcp.acme-tools-2");
    } finally {
      mcp.stopServer(id, true);
      vi.unstubAllGlobals();
    }
  });

  it("caps the scope's id at 32 characters", async () => {
    const id = "x".repeat(40);
    vi.stubGlobal("fetch", fakeRemote("ok"));

    try {
      await mcp.startServer(id, { url: "https://mcp.example.test/mcp" });
      await logger.flush();

      const connected = readEvents().find((e) => e.data?.server === id && e.msg === "connected");
      expect(connected.scope).toBe(`mcp.${"x".repeat(32)}`);
    } finally {
      mcp.stopServer(id, true);
      vi.unstubAllGlobals();
    }
  });
});
