import http from "node:http";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createMcpServer, KEEP_ALIVE_MS } = require("./mcpHttp.cjs");

let server;
afterEach(async () => server?.stop());

/** A raw request, so the Host and Origin headers are exactly what a test sets. */
function post(url, body, headers = {}) {
  const { hostname, port, pathname } = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname, port, path: pathname, method: "POST", headers: { "Content-Type": "application/json", ...headers } }, (res) => {
      let text = "";
      const chunks = [];
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        chunks.push(chunk);
        text += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"], text, chunks }));
    });
    req.on("error", reject);
    req.end(typeof body === "string" ? body : JSON.stringify(body));
  });
}

const tools = [{ name: "read_file", description: "Reads a file.", inputSchema: { type: "object", properties: {} } }];

describe("gemini MCP over HTTP", () => {
  it("lists the tools and answers a call over SSE, keeping the stream alive while it waits", async () => {
    server = createMcpServer({ keepAliveMs: 20 });
    let answer;
    const call = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    const { url } = await server.register({ tools: () => tools, call });
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp\/[0-9a-f]{48}$/);

    const init = await post(url, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    expect(JSON.parse(init.text).result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} } });
    expect((await post(url, { jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    expect(JSON.parse((await post(url, { jsonrpc: "2.0", id: 2, method: "tools/list" })).text).result.tools).toEqual(tools);

    const pending = post(url, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "read_file", arguments: { path: "a" } } });
    await vi.waitFor(() => expect(call).toHaveBeenCalled());
    expect(call.mock.calls[0].slice(0, 2)).toEqual(["read_file", { path: "a" }]);
    await new Promise((resolve) => setTimeout(resolve, 70));
    answer({ content: [{ type: "text", text: "hi" }] });
    const done = await pending;
    expect(done.type).toBe("text/event-stream");
    expect(done.text).toContain(": keep-alive\n\n");
    const data = done.text.split("\n").find((line) => line.startsWith("data: "));
    expect(JSON.parse(data.slice(6))).toEqual({ jsonrpc: "2.0", id: 3, result: { content: [{ type: "text", text: "hi" }] } });
    expect(KEEP_ALIVE_MS).toBeLessThan(60_000);
  });

  it("answers only its own child: the secret path, the loopback host, and no browser origin", async () => {
    server = createMcpServer();
    const { url, close } = await server.register({ tools: () => tools, call: async () => ({}) });
    const list = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    const other = url.replace(/[0-9a-f]{48}$/, "0".repeat(48));
    expect((await post(other, list)).status).toBe(404);
    expect((await post(url, list, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await post(url, list, { Host: "evil.example" })).status).toBe(403);
    expect((await post(url, "{not json")).status).toBe(400);
    expect((await post(url, list)).status).toBe(200);
    close();
    expect((await post(url, list)).status).toBe(404);
  });
});
