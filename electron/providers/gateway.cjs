/** The draggy-ai:// handler every model request goes through. The built-in engine is passed through
 * untouched, so its errors, its streams and how Stop halts it stay exactly what they were. */

const { createSse, completion } = require("./sse.cjs");
const { fromResponse, fromNetwork, isRetryable } = require("./errors.cjs");

const ENGINE_PATH = "/v1/chat/completions";
const ADAPTERS = {
  openai: require("./adapters/openai.cjs"),
  ollama: require("./adapters/ollama.cjs"),
  anthropic: require("./adapters/anthropic.cjs"),
  gemini: require("./adapters/gemini.cjs"),
};
const MAX_RETRIES = 2;
// A provider asking for a longer wait than this has a turn fail now rather than sit silent for minutes.
const MAX_WAIT_MS = 60_000;

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

/** `@instance/model`, split at the first slash: model ids such as OpenRouter's carry slashes of their own. */
function parseRef(model) {
  const slash = model.indexOf("/");
  return slash > 1 ? { instanceId: model.slice(1, slash), modelId: model.slice(slash + 1) } : null;
}

function waitFor(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });
}

/** One upstream request with the retry rule; `onRetry` sees each wait before it starts. */
async function fetchWithRetries(fetchImpl, request, signal, onRetry) {
  for (let attempt = 0; ; attempt++) {
    let upstream;
    try {
      upstream = await fetchImpl(request.url, { ...request.init, signal });
    } catch (error) {
      return { failure: fromNetwork(error) };
    }
    if (upstream.ok) return { upstream };
    const failure = fromResponse(upstream.status, await upstream.text().catch(() => ""), upstream.headers);
    const waitMs = failure.retryAfter !== undefined ? failure.retryAfter * 1000 : 1000 * 2 ** attempt;
    if (attempt >= MAX_RETRIES || !isRetryable(failure) || waitMs > MAX_WAIT_MS || signal.aborted) return { failure };
    onRetry(attempt + 1, waitMs);
    await waitFor(waitMs, signal);
    if (signal.aborted) return { failure };
  }
}

function hostedToolFailure(error) {
  return { kind: "provider-unknown-error", status: 0, message: `The provider called its own tool (${error.message}), which Draggy never offers.`, providerMessage: "" };
}

/** A provider's model: routed to its adapter, fetched only from an enabled instance's own address. */
async function routeRemote({ ref, text, registry, fetchImpl, cors, accounts = {} }) {
  const parsed = parseRef(ref);
  const connection = parsed && registry ? registry.connectionFor(parsed.instanceId) : null;
  if (!connection || !connection.instance.enabled || !parsed.modelId) {
    return errorResponse(404, "provider-unknown-error", `No enabled provider is set up for ${ref}.`, cors);
  }
  const protocol = connection.entry?.protocol || "openai";
  const account = connection.entry?.kind === "account" ? accounts[protocol] : null;
  const adapter = account ? null : ADAPTERS[protocol];
  if (!account && !adapter) return errorResponse(404, "provider-unknown-error", `No adapter for ${ref}.`, cors);

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return errorResponse(400, "provider-unknown-error", "The request is not JSON.", cors);
  }
  if (account) return routeAccount(account, body, connection, parsed.modelId, cors);
  const request = adapter.buildRequest(body, connection, parsed.modelId);
  const allowed = registry.enabledBaseUrls().some((base) => request.url === base || request.url.startsWith(`${base}/`));
  if (!allowed) return errorResponse(403, "provider-unknown-error", "That address is not a configured provider's.", cors);

  const controller = new AbortController();
  const named = (failure) => ({ ...failure, provider: connection.instance.label });
  const tag = { instanceId: connection.instance.id };
  if (!body.stream) return answerOnce(adapter, fetchImpl, request, controller.signal, cors, named, tag);

  const stream = new ReadableStream({
    async start(out) {
      const sse = createSse(out);
      const settle = (failure) => {
        if (controller.signal.aborted) return;
        if (failure) sse.error(named(failure));
        sse.done();
      };
      const { upstream, failure } = await fetchWithRetries(fetchImpl, request, controller.signal, (attempt, waitMs) => {
        if (!controller.signal.aborted) sse.retry(attempt, MAX_RETRIES, waitMs);
      });
      if (failure) return settle(failure);
      try {
        await adapter.translateStream(upstream.body, sse, tag);
        settle(null);
      } catch (error) {
        settle(error instanceof ADAPTERS.openai.HostedToolError ? hostedToolFailure(error) : error?.failure || fromNetwork(error));
      }
    },
    cancel() {
      controller.abort();
    },
  });
  return new Response(stream, { status: 200, headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}

/** An account's runtime speaks no HTTP, so there is no address to check; it streams into the same SSE. */
function routeAccount(account, body, connection, modelId, cors) {
  const controller = new AbortController();
  const named = (failure) => ({ ...failure, provider: connection.instance.label });
  const failureOf = (error) => error?.failure || { kind: "provider-unknown-error", status: 0, message: String(error?.message || error), providerMessage: "" };
  const run = (sse) => account.stream({ body, connection, modelId, sse, signal: controller.signal });

  if (!body.stream) return answerAccount(run, cors, named, failureOf);
  const stream = new ReadableStream({
    async start(out) {
      const sse = createSse(out);
      let failure = null;
      try {
        await run(sse);
      } catch (error) {
        failure = failureOf(error);
      }
      if (controller.signal.aborted) return;
      if (failure) sse.error(named(failure));
      sse.done();
    },
    cancel() {
      controller.abort();
    },
  });
  return new Response(stream, { status: 200, headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}

/** Collects what the runtime would have streamed into one answer in llama-server's shape. */
async function answerAccount(run, cors, named, failureOf) {
  const answer = { content: "", reasoning: "", toolCalls: [], finish: "stop", usage: {} };
  const sink = {
    delta({ content, reasoning, toolCalls }) {
      answer.content += content || "";
      answer.reasoning += reasoning || "";
      for (const call of toolCalls || []) answer.toolCalls.push({ id: call.id, type: "function", function: call.function });
    },
    finish(reason, usage = {}) {
      answer.finish = reason || "stop";
      answer.usage = usage;
    },
    providerState(state) {
      answer.providerState = state;
    },
    retry() {},
  };
  try {
    await run(sink);
  } catch (error) {
    return new Response(JSON.stringify({ error: named(failureOf(error)) }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
  }
  const out = completion(answer);
  if (answer.providerState) out.provider_state = answer.providerState;
  return new Response(JSON.stringify(out), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
}

/** The non-streaming form: the answer in llama-server's shape, or the upstream status with a named error. */
async function answerOnce(adapter, fetchImpl, request, signal, cors, named, tag) {
  const { upstream, failure } = await fetchWithRetries(fetchImpl, request, signal, () => {});
  const fail = (f) => new Response(JSON.stringify({ error: named(f) }), { status: f.status >= 400 ? f.status : 502, headers: { ...cors, "Content-Type": "application/json" } });
  if (failure) return fail(failure);
  try {
    const answer = adapter.translateJson(await upstream.json(), tag);
    const out = completion(answer);
    if (answer.providerState) out.provider_state = answer.providerState;
    return new Response(JSON.stringify(out), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  } catch (error) {
    return fail(error instanceof ADAPTERS.openai.HostedToolError ? hostedToolFailure(error) : error?.failure || fromNetwork(error));
  }
}

/** `enginePort` is read on every request, since the engine can move. Electron 42 hands the handler
 * no Origin, so the session is the boundary; an Origin, when one comes, must be the app's. */
function createGateway({ enginePort, isAllowedOrigin, fetchImpl = globalThis.fetch, onRefused = () => {}, registry = null, accounts = {} }) {
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
    // A remote reference never reaches the engine, whether or not its provider exists.
    if (model.startsWith("@")) return routeRemote({ ref: model, text, registry, fetchImpl, cors, accounts });
    return passThrough(fetchImpl, `http://127.0.0.1:${enginePort()}${ENGINE_PATH}`, request.headers.get("content-type"), text, cors);
  };
}

module.exports = { createGateway, ENGINE_PATH };
