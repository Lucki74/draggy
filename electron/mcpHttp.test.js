import http from "node:http";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createHttpTransport } = require("./mcpHttp.cjs");

/**
 * The remote transport, against a real server on a real socket. Mocking fetch
 * would prove the code calls fetch; this proves it can hold a conversation
 * with something that answers the way the specification says.
 */

let server;
let url;
let received;
let handler;

beforeEach(async () => {
  received = [];

  server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const message = body ? JSON.parse(body) : null;
      received.push({ method: request.method, headers: request.headers, message });
      handler(request, response, message);
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}/mcp`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const json = (response, payload, headers = {}) => {
  response.writeHead(200, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify(payload));
};

const result = (message, value) => ({
  jsonrpc: "2.0",
  id: message.id,
  result: value,
});

describe("a plain JSON answer", () => {
  it("carries a call through and hands back the result", async () => {
    handler = (request, response, message) =>
      json(response, result(message, { tools: [{ name: "search" }] }));

    const transport = createHttpTransport({ url });

    expect(await transport.send("tools/list", {})).toEqual({
      tools: [{ name: "search" }],
    });
    expect(received[0].message.method).toBe("tools/list");
    expect(received[0].headers["mcp-protocol-version"]).toBeTruthy();
  });

  it("turns an error answer into a thrown error", async () => {
    handler = (request, response, message) =>
      json(response, {
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "No such method" },
      });

    const transport = createHttpTransport({ url });

    await expect(transport.send("nope", {})).rejects.toThrow("No such method");
  });

  it("says so when the server answers with nothing at all", async () => {
    handler = (request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("");
    };

    const transport = createHttpTransport({ url });

    await expect(transport.send("tools/list", {})).rejects.toThrow(/no answer/i);
  });

  it("reports what an unhappy server said", async () => {
    handler = (request, response) => {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end("the database is on fire");
    };

    const transport = createHttpTransport({ url });

    await expect(transport.send("tools/list", {})).rejects.toThrow(/on fire/);
  });
});

describe("an event stream answer", () => {
  it("reads past the notifications to the message it asked for", async () => {
    handler = (request, response, message) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(
        `data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress" })}\n\n`,
      );
      response.write(`data: ${JSON.stringify(result(message, { ok: true }))}\n\n`);
      response.end();
    };

    const transport = createHttpTransport({ url });

    expect(await transport.send("tools/call", {})).toEqual({ ok: true });
  });

  it("ignores the keep-alive lines between frames", async () => {
    handler = (request, response, message) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(": keeping the connection open\n\n");
      response.write(`data: ${JSON.stringify(result(message, { ok: true }))}\n\n`);
      response.end();
    };

    const transport = createHttpTransport({ url });

    expect(await transport.send("tools/call", {})).toEqual({ ok: true });
  });
});

describe("a session the server opened", () => {
  it("gives the id back on every later request", async () => {
    handler = (request, response, message) =>
      json(response, result(message, {}), { "Mcp-Session-Id": "session-7" });

    const transport = createHttpTransport({ url });
    await transport.send("initialize", {});
    await transport.send("tools/list", {});

    expect(transport.sessionId).toBe("session-7");
    expect(received[1].headers["mcp-session-id"]).toBe("session-7");
  });

  it("says goodbye when it is closed", async () => {
    handler = (request, response, message) => {
      if (request.method === "DELETE") {
        response.writeHead(200);
        response.end();
        return;
      }
      json(response, result(message, {}), { "Mcp-Session-Id": "session-7" });
    };

    const transport = createHttpTransport({ url });
    await transport.send("initialize", {});
    await transport.close();

    expect(received.some((one) => one.method === "DELETE")).toBe(true);
    expect(transport.sessionId).toBeNull();
  });
});

describe("a server that wants a token", () => {
  it("sends the one it is given", async () => {
    handler = (request, response, message) => json(response, result(message, {}));

    const transport = createHttpTransport({ url, getToken: () => "token-abc" });
    await transport.send("tools/list", {});

    expect(received[0].headers.authorization).toBe("Bearer token-abc");
  });

  it("refreshes once when the token has expired, then carries on", async () => {
    let token = "stale";

    handler = (request, response, message) => {
      if (request.headers.authorization !== "Bearer fresh") {
        response.writeHead(401, { "WWW-Authenticate": "Bearer" });
        response.end();
        return;
      }
      json(response, result(message, { ok: true }));
    };

    const transport = createHttpTransport({
      url,
      getToken: () => token,
      onUnauthorized: async () => {
        token = "fresh";
        return true;
      },
    });

    expect(await transport.send("tools/list", {})).toEqual({ ok: true });
    expect(received).toHaveLength(2);
  });

  it("gives up rather than looping when the refresh does not help", async () => {
    let refreshes = 0;

    handler = (request, response) => {
      response.writeHead(401);
      response.end();
    };

    const transport = createHttpTransport({
      url,
      getToken: () => "stale",
      onUnauthorized: async () => {
        refreshes++;
        return true;
      },
    });

    await expect(transport.send("tools/list", {})).rejects.toThrow(/401/);
    expect(refreshes).toBe(1);
  });
});
