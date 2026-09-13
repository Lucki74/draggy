const http = require("node:http");
const crypto = require("node:crypto");

/**
 * A local OpenAI-compatible endpoint: /v1/chat/completions and /v1/models, so
 * an editor plugin or a script can talk to Draggy the way it would talk to any
 * other OpenAI-shaped server, and get the same loop the chat window uses.
 *
 * It is the only part of Draggy that opens a port, so it is careful about who
 * gets in. Off until the user turns it on. Bound to 127.0.0.1, never to every
 * interface. Every request needs the key Draggy generated. A request that
 * names another host is refused, which is what stops a web page from reaching
 * it through DNS rebinding, and a request a browser sent on a page's behalf is
 * refused outright, key or not.
 */

const HOST = "127.0.0.1";
const DEFAULT_PORT = 11500;

/** Largest request body accepted. A conversation, not a file upload. */
const MAX_BODY_BYTES = 1024 * 1024;

/** Replies generated at once. Past this a client is asked to wait. */
const MAX_CONCURRENT = 2;

/** A new key: long, random, and recognisable in a config file. */
function generateKey() {
  return `draggy-${crypto.randomBytes(24).toString("base64url")}`;
}

/** Compares keys without saying, through timing, how much of one was right. */
function sameKey(given, expected) {
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(String(expected || ""));
  if (a.length !== b.length || b.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Whether a request may be answered at all. Returns null when it may, or the
 * status and message to refuse it with. Pure, so every refusal is tested.
 */
function checkRequest({ headers = {}, port, key }) {
  // A browser always sends Origin on a cross-site fetch. Nothing legitimate
  // that talks to this endpoint is a web page.
  if (headers.origin !== undefined) {
    return { status: 403, message: "Requests from web pages are not accepted." };
  }

  const host = String(headers.host || "").toLowerCase();
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!allowedHosts.includes(host)) {
    return { status: 403, message: "This endpoint only answers on 127.0.0.1." };
  }

  const auth = String(headers.authorization || "");
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match || !sameKey(match[1].trim(), key)) {
    return { status: 401, message: "Missing or wrong API key." };
  }

  return null;
}

/** An error body in the shape OpenAI clients know how to show. */
function errorBody(message, type = "invalid_request_error") {
  return JSON.stringify({ error: { message, type } });
}

/**
 * Reads a chat completion request into what Draggy's loop needs, or explains
 * what is wrong with it. Content given as parts keeps its text parts only:
 * images through this endpoint are not supported yet, and saying so beats
 * silently dropping them.
 */
function readCompletionRequest(body) {
  if (!body || typeof body !== "object") return { error: "The body must be a JSON object." };

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return { error: "messages must be a non-empty array." };
  }

  const messages = [];

  for (const [index, entry] of body.messages.entries()) {
    const role = entry?.role;
    if (!["system", "user", "assistant", "developer"].includes(role)) {
      return { error: `messages[${index}].role must be system, user or assistant.` };
    }

    let content;
    if (typeof entry.content === "string") {
      content = entry.content;
    } else if (Array.isArray(entry.content)) {
      if (entry.content.some((part) => part?.type && part.type !== "text")) {
        return { error: `messages[${index}] has a part that is not text, which this endpoint does not take yet.` };
      }
      content = entry.content.map((part) => String(part?.text ?? "")).join("");
    } else if (entry.content === null || entry.content === undefined) {
      content = "";
    } else {
      return { error: `messages[${index}].content must be a string or an array of text parts.` };
    }

    messages.push({ role: role === "developer" ? "system" : role, content });
  }

  if (!messages.some((message) => message.role === "user")) {
    return { error: "messages needs at least one user message." };
  }

  return {
    request: {
      model: typeof body.model === "string" ? body.model : "",
      messages,
      stream: body.stream === true,
    },
  };
}

function completionId() {
  return `chatcmpl-${crypto.randomBytes(12).toString("hex")}`;
}

/** One streamed delta, as an SSE line. */
function chunkLine({ id, model, created, content, finish = null }) {
  const choice = {
    index: 0,
    delta: content === undefined ? {} : { content },
    finish_reason: finish,
  };
  return `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [choice] })}\n\n`;
}

function completionBody({ id, model, created, content, usage }) {
  return JSON.stringify({
    id,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: usage?.promptTokens ?? 0,
      completion_tokens: usage?.responseTokens ?? 0,
      total_tokens: (usage?.promptTokens ?? 0) + (usage?.responseTokens ?? 0),
    },
  });
}

function modelsBody(names, created = Math.floor(Date.now() / 1000)) {
  return JSON.stringify({
    object: "list",
    data: names.map((name) => ({ id: name, object: "model", created, owned_by: "local" })),
  });
}

/**
 * The server. `generate` is the loop: it takes a request and a way to send
 * text as it arrives, and resolves with the finished reply. `listModels` names
 * what can be asked for. Both are supplied by main.cjs, which forwards them to
 * the window where the loop actually runs.
 */
function createApiServer({ port = DEFAULT_PORT, getKey, generate, listModels, log }) {
  let server = null;
  let active = 0;

  const send = (res, status, body, type = "application/json") => {
    if (res.headersSent) return;
    res.writeHead(status, {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(body);
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;

      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(Object.assign(new Error("too large"), { status: 413 }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });

  async function handle(req, res) {
    const refusal = checkRequest({ headers: req.headers, port, key: getKey() });
    if (refusal) {
      send(res, refusal.status, errorBody(refusal.message, "authentication_error"));
      return;
    }

    const url = new URL(req.url || "/", `http://${HOST}:${port}`);

    if (req.method === "GET" && url.pathname === "/v1/models") {
      send(res, 200, modelsBody(await listModels()));
      return;
    }

    if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      send(res, 404, errorBody("Only /v1/chat/completions and /v1/models are served here."));
      return;
    }

    if (active >= MAX_CONCURRENT) {
      send(res, 429, errorBody("Draggy is already answering other requests. Try again shortly.", "rate_limit_error"));
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch (error) {
      send(res, error.status || 400, errorBody(error.status === 413 ? "The request is too large." : "The body is not valid JSON."));
      return;
    }

    const { request, error } = readCompletionRequest(parsed);
    if (error) {
      send(res, 400, errorBody(error));
      return;
    }

    active += 1;
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) controller.abort();
    });

    const id = completionId();
    const created = Math.floor(Date.now() / 1000);

    try {
      if (request.stream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
          "X-Content-Type-Options": "nosniff",
        });

        let model = request.model;
        const result = await generate(request, {
          signal: controller.signal,
          onModel: (name) => {
            model = name;
          },
          onText: (content) => {
            if (content) res.write(chunkLine({ id, model, created, content }));
          },
        });

        res.write(chunkLine({ id, model: result.model || model, created, finish: "stop" }));
        res.end("data: [DONE]\n\n");
      } else {
        const result = await generate(request, { signal: controller.signal });
        send(res, 200, completionBody({ id, model: result.model, created, content: result.content, usage: result.usage }));
      }
    } catch (failure) {
      log?.warn?.("api", `a request failed: ${failure?.message || failure}`);
      if (res.headersSent) {
        res.end(`data: ${errorBody(failure?.message || "The reply failed.", "server_error")}\n\n`);
      } else {
        send(res, 500, errorBody(failure?.message || "The reply failed.", "server_error"));
      }
    } finally {
      active -= 1;
    }
  }

  function start() {
    if (server) return Promise.resolve({ success: true, port });

    return new Promise((resolve) => {
      const next = http.createServer((req, res) => {
        handle(req, res).catch((error) => {
          log?.warn?.("api", error?.message || String(error));
          send(res, 500, errorBody("The server hit an error.", "server_error"));
        });
      });

      next.once("error", (error) => {
        server = null;
        resolve({
          success: false,
          error: error.code === "EADDRINUSE" ? `Port ${port} is already in use.` : error.message,
        });
      });

      next.listen(port, HOST, () => {
        server = next;
        log?.info?.("api", `listening on http://${HOST}:${port}/v1`);
        resolve({ success: true, port });
      });
    });
  }

  function stop() {
    if (!server) return Promise.resolve();
    const closing = server;
    server = null;
    return new Promise((resolve) => {
      closing.close(() => resolve());
      closing.closeAllConnections?.();
    });
  }

  return {
    start,
    stop,
    isRunning: () => Boolean(server),
    port: () => port,
    /** Where the socket is actually bound, for checking it is loopback only. */
    address: () => server?.address() ?? null,
  };
}

module.exports = {
  HOST,
  DEFAULT_PORT,
  MAX_BODY_BYTES,
  MAX_CONCURRENT,
  generateKey,
  sameKey,
  checkRequest,
  readCompletionRequest,
  chunkLine,
  completionBody,
  modelsBody,
  createApiServer,
};
