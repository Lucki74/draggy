/** The draggy-ai:// handler every model request goes through. The built-in engine is passed through
 * untouched, so its errors, its streams and how Stop halts it stay exactly what they were. */

const { createSse, completion } = require("./sse.cjs");
const { fromResponse, fromNetwork, isRetryable } = require("./errors.cjs");
const { log } = require("../logger.cjs");

const SCOPE = "providers.gateway";
/** The ids a provider puts on its own response; quoting one to the provider finds the request on their side. */
const UPSTREAM_ID_HEADERS = ["request-id", "x-request-id", "openai-request-id", "anthropic-request-id", "x-goog-request-id"];

function upstreamId(headers) {
  for (const name of UPSTREAM_ID_HEADERS) {
    const value = headers?.get?.(name);
    if (value) return value;
  }
  return undefined;
}

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
    "Access-Control-Allow-Headers": "content-type, x-request-id",
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
async function passThrough(fetchImpl, url, contentType, text, cors, meta = {}) {
  const controller = new AbortController();
  const startedAt = Date.now();
  let upstream;
  try {
    upstream = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": contentType || "application/json", ...(meta.cid ? { "X-Request-Id": meta.cid } : {}) },
      body: text,
      signal: controller.signal,
    });
  } catch (error) {
    // Refused or unreachable: a network failure, so the renderer still sees the TypeError it always has.
    log.fail(SCOPE, "engine unreachable", error, { cid: meta.cid, bytes: text.length });
    return Response.error();
  }
  const ttfbMs = Date.now() - startedAt;
  if (upstream.ok) log.debug(SCOPE, "engine responded", { cid: meta.cid, status: upstream.status, ttfbMs });
  else log.warn(SCOPE, "engine refused", { cid: meta.cid, status: upstream.status, ttfbMs });

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
      reader.cancel().catch(log.swallowed("providers", "stopping something that may have already ended"));
    },
  });
  return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers });
}

/** Which server a request went to, with no path or query. */
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "invalid url";
  }
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
async function fetchWithRetries(fetchImpl, request, signal, onRetry, meta = {}) {
  for (let attempt = 0; ; attempt++) {
    let upstream;
    try {
      // Our id travels upstream so a provider that echoes it back (or a support ticket) can be matched.
      const init = meta.cid ? { ...request.init, headers: { "X-Request-Id": meta.cid, ...(request.init.headers || {}) }, signal } : { ...request.init, signal };
      upstream = await fetchImpl(request.url, init);
    } catch (error) {
      log.warn(SCOPE, "provider unreachable", { cid: meta.cid, provider: meta.provider, attempt, message: error?.message });
      return { failure: fromNetwork(error) };
    }
    const rate = rateLimitOf(upstream.headers);
    if (Object.keys(rate).length) log.info(SCOPE, "rate limit headers", { cid: meta.cid, provider: meta.provider, status: upstream.status, ...rate });
    if (upstream.ok) {
      log.debug(SCOPE, "provider responded", { cid: meta.cid, provider: meta.provider, status: upstream.status, attempt, upstreamId: upstreamId(upstream.headers) });
      return { upstream };
    }
    const failure = fromResponse(upstream.status, await upstream.text().catch(() => ""), upstream.headers);
    log.warn(SCOPE, "provider refused", { cid: meta.cid, provider: meta.provider, status: upstream.status, attempt, kind: failure.kind, retryable: isRetryable(failure), upstreamId: upstreamId(upstream.headers) });
    const waitMs = failure.retryAfter !== undefined ? failure.retryAfter * 1000 : 1000 * 2 ** attempt;
    if (attempt >= MAX_RETRIES || !isRetryable(failure) || waitMs > MAX_WAIT_MS || signal.aborted) return { failure };
    onRetry(attempt + 1, waitMs);
    await waitFor(waitMs, signal);
    if (signal.aborted) return { failure };
  }
}

/** The numbers a provider reports about its own limits; no other header is read here. */
function rateLimitOf(headers) {
  const out = {};
  headers?.forEach?.((value, name) => {
    const key = name.toLowerCase();
    if (key !== "retry-after" && !key.startsWith("x-ratelimit-remaining-")) return;
    const number = Number(value);
    if (value !== "" && Number.isFinite(number)) out[key] = number;
  });
  return out;
}

function hostedToolFailure(error) {
  return { kind: "provider-unknown-error", status: 0, message: `The provider called its own tool (${error.message}), which Draggy never offers.`, providerMessage: "" };
}

/** A provider's model: routed to its adapter, fetched only from an enabled instance's own address. */
async function routeRemote({ ref, text, registry, fetchImpl, cors, accounts = {}, cid }) {
  const parsed = parseRef(ref);
  const connection = parsed && registry ? registry.connectionFor(parsed.instanceId) : null;
  if (!connection || !connection.instance.enabled || !parsed.modelId) {
    log.warn(SCOPE, "no enabled provider for model", { cid, ref });
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
  const meta = { cid, provider: connection.instance.id };
  log.debug(SCOPE, "routing to provider", { cid, provider: connection.instance.id, protocol, stream: Boolean(body.stream) });
  const tag = { instanceId: connection.instance.id };
  const label = { cid, provider: connection.instance.id, model: parsed.modelId, host: hostOf(request.url) };
  if (!body.stream) return answerOnce(adapter, fetchImpl, request, controller.signal, cors, named, tag, { ...meta, ...label });

  const stream = new ReadableStream({
    async start(out) {
      const sse = createSse(out, { meta: label });
      const settle = (failure) => {
        if (controller.signal.aborted) return sse.stop("abort");
        if (failure) {
          log.warn(SCOPE, "stream ended with an error", { cid, provider: connection.instance.id, status: failure.status, kind: failure.kind });
          sse.error(named(failure));
        }
        sse.done();
      };
      const { upstream, failure } = await fetchWithRetries(fetchImpl, request, controller.signal, (attempt, waitMs) => {
        if (!controller.signal.aborted) sse.retry(attempt, MAX_RETRIES, waitMs);
      }, meta);
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
      if (controller.signal.aborted) return sse.stop("abort");
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
async function answerOnce(adapter, fetchImpl, request, signal, cors, named, tag, meta) {
  const startedAt = Date.now();
  let retries = 0;
  const { upstream, failure } = await fetchWithRetries(fetchImpl, request, signal, (attempt) => {
    retries = attempt;
  }, meta);
  const summary = (data) => log.info(SCOPE, "request finished", { cid: meta.cid, provider: meta.provider, model: meta.model, host: meta.host, stream: false, durMs: Date.now() - startedAt, retries, ...data });
  const fail = (f) => new Response(JSON.stringify({ error: named(f) }), { status: f.status >= 400 ? f.status : 502, headers: { ...cors, "Content-Type": "application/json" } });
  if (failure) {
    summary({ how: "error", kind: failure.kind, status: failure.status });
    return fail(failure);
  }
  try {
    const answer = adapter.translateJson(await upstream.json(), tag);
    const out = completion(answer);
    summary({ how: "done", finish: answer.finish, promptTokens: answer.usage?.promptTokens, outputTokens: answer.usage?.outputTokens });
    if (answer.providerState) out.provider_state = answer.providerState;
    return new Response(JSON.stringify(out), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  } catch (error) {
    log.fail(SCOPE, "provider answer unreadable", error, { cid: meta.cid, provider: meta.provider });
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
    const cid = request.headers.get("x-request-id") || undefined;
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (request.method !== "POST" || url.host !== "chat") {
      return errorResponse(404, "provider-unknown-error", "Unknown gateway endpoint.", cors);
    }

    const text = await request.text();
    const model = requestedModel(text);
    // A remote reference never reaches the engine, whether or not its provider exists.
    if (model.startsWith("@")) return routeRemote({ ref: model, text, registry, fetchImpl, cors, accounts, cid });
    return passThrough(fetchImpl, `http://127.0.0.1:${enginePort()}${ENGINE_PATH}`, request.headers.get("content-type"), text, cors, { cid });
  };
}

module.exports = { createGateway, ENGINE_PATH };
