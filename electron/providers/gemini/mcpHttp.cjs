/** Draggy's tools for the Gemini CLI: streamable HTTP MCP on loopback, one secret path per process
 * (gemini/MODE.md §4). A call answers over SSE, since the CLI gives a response 60 s to send its headers. */
const crypto = require("node:crypto");
const http = require("node:http");

const KEEP_ALIVE_MS = 30_000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** `register(endpoint)` gives an endpoint its own URL; an endpoint is `{ tools(), call(name, args) }`. */
function createMcpServer({ name = "draggy", version = "0", keepAliveMs = KEEP_ALIVE_MS, log = () => {} } = {}) {
  const endpoints = new Map();
  let server = null;
  let port = 0;

  const json = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };

  async function handle(req, res) {
    // Only the child asks: a browser page on another site sends an Origin, and a rebinding name a foreign Host.
    if (req.headers.origin || req.headers.host !== `127.0.0.1:${port}`) return json(res, 403);
    const endpoint = endpoints.get(req.url);
    if (!endpoint) return json(res, 404);
    if (req.method !== "POST") return json(res, 405);
    let message;
    try {
      message = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
    if (message?.id === undefined || message.id === null) return json(res, 202);
    const reply = (result) => ({ jsonrpc: "2.0", id: message.id, result });

    if (message.method === "initialize") {
      return json(res, 200, reply({ protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name, version } }));
    }
    if (message.method === "tools/list") return json(res, 200, reply({ tools: endpoint.tools() }));
    if (message.method !== "tools/call") return json(res, 200, reply({}));

    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    const beat = setInterval(() => res.write(": keep-alive\n\n"), keepAliveMs);
    let result;
    try {
      result = await endpoint.call(message.params?.name, message.params?.arguments ?? {}, { closed: new Promise((resolve) => res.on("close", resolve)) });
    } catch (error) {
      log(`a tool call failed: ${error.message}`);
      result = { content: [{ type: "text", text: "The call failed." }], isError: true };
    } finally {
      clearInterval(beat);
    }
    if (!res.writableEnded) res.end(`event: message\ndata: ${JSON.stringify(reply(result))}\n\n`);
  }

  async function listen() {
    if (server) return;
    server = http.createServer((req, res) => {
      handle(req, res).catch((error) => {
        log(`MCP request failed: ${error.message}`);
        if (!res.headersSent) json(res, 500);
        else res.end();
      });
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    port = server.address().port;
  }

  async function register(endpoint) {
    await listen();
    const route = `/mcp/${crypto.randomBytes(24).toString("hex")}`;
    endpoints.set(route, endpoint);
    return { url: `http://127.0.0.1:${port}${route}`, close: () => endpoints.delete(route) };
  }

  async function stop() {
    endpoints.clear();
    const closing = server;
    server = null;
    if (!closing) return;
    closing.closeAllConnections?.();
    await new Promise((resolve) => closing.close(() => resolve()));
  }

  return { register, stop, get size() { return endpoints.size; } };
}

module.exports = { createMcpServer, KEEP_ALIVE_MS };
