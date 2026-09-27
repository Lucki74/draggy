/** The draggy-ai:// handler every model request goes through. The built-in engine is passed through
 * untouched, so its errors, its streams and how Stop halts it stay exactly what they were. */

const ENGINE_PATH = "/v1/chat/completions";

// Bodies are re-streamed, so the upstream's framing headers no longer describe what is sent.
const DROPPED_HEADERS = new Set(["content-length", "content-encoding", "transfer-encoding", "connection", "keep-alive"]);

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    Vary: "Origin",
  };
}

function errorResponse(status, kind, message, headers = {}) {
  return new Response(JSON.stringify({ error: { kind, message } }), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/** The model a request names; empty when the body is not JSON, which the engine then answers itself. */
function requestedModel(text) {
  try {
    const model = JSON.parse(text)?.model;
    return typeof model === "string" ? model : "";
  } catch {
    return "";
  }
}

/** Streams the engine's answer back, and aborts the engine's request when the renderer stops reading.
 * On Electron 42 the handler's Request signal never fires; cancelling the body is the only route. */
async function passThrough(fetchImpl, url, contentType, text, cors) {
  const controller = new AbortController();
  let upstream;
  try {
    upstream = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": contentType || "application/json" },
      body: text,
      signal: controller.signal,
    });
  } catch {
    // Refused or unreachable: a network failure, so the renderer still sees the TypeError it always has.
    return Response.error();
  }

  const headers = new Headers(cors);
  upstream.headers.forEach((value, key) => {
    if (!DROPPED_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });
  for (const [key, value] of Object.entries(cors)) headers.set(key, value);

  if (!upstream.body) return new Response(null, { status: upstream.status, statusText: upstream.statusText, headers });

  const reader = upstream.body.getReader();
  const body = new ReadableStream({
    async pull(stream) {
      try {
        const { done, value } = await reader.read();
        if (done) stream.close();
        else stream.enqueue(value);
      } catch (error) {
        stream.error(error);
      }
    },
    cancel() {
      controller.abort();
      reader.cancel().catch(() => undefined);
    },
  });
  return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers });
}

/** `enginePort` is read on every request, since the engine can move. Electron 42 hands the handler
 * no Origin, so the session is the boundary; an Origin, when one comes, must be the app's. */
function createGateway({ enginePort, isAllowedOrigin, fetchImpl = globalThis.fetch, onRefused = () => {} }) {
  return async function handle(request) {
    const origin = request.headers.get("origin") || "";
    if (origin && !isAllowedOrigin(origin)) {
      onRefused(origin || "(none)", request.url);
      return errorResponse(403, "provider-unknown-error", "This origin may not use the gateway.");
    }
    const cors = corsHeaders(origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (request.method !== "POST" || url.host !== "chat") {
      return errorResponse(404, "provider-unknown-error", "Unknown gateway endpoint.", cors);
    }

    const text = await request.text();
    const model = requestedModel(text);
    // No provider exists yet: a remote reference is refused here and never reaches the engine.
    if (model.startsWith("@")) {
      return errorResponse(404, "provider-unknown-error", `No provider is set up for ${model}.`, cors);
    }
    return passThrough(fetchImpl, `http://127.0.0.1:${enginePort()}${ENGINE_PATH}`, request.headers.get("content-type"), text, cors);
  };
}

module.exports = { createGateway, ENGINE_PATH };
