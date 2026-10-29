/** Writes a provider's answer the way llama-server streams one, so the renderer's readers stay the only
 * readers. Timings are made up from the wall clock, since only the engine measures its own. */

const { log } = require("../logger.cjs");

const encoder = new TextEncoder();

const COUNTED = ["input", "cacheRead", "cacheWrite", "output", "reasoning"];

/** llama-server's `usage`, plus `draggy_usage`: the cache and reasoning split the renderer prices.
 * An answer that reported nothing carries no split, so it is never read as a free reply. */
function usageField(promptTokens, outputTokens, tokens) {
  const counted = tokens && COUNTED.some((key) => tokens[key] > 0);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: outputTokens,
    total_tokens: promptTokens + outputTokens,
    ...(counted ? { draggy_usage: tokens } : {}),
  };
}

/** `meta` is who the request was for ({cid, provider, model, host}); it only labels the one summary line. */
function createSse(controller, { now = () => Date.now(), meta = {} } = {}) {
  const startedAt = now();
  let firstAt = null;
  let closed = false;
  let events = 0;
  let skipped = 0;
  let failed = null;
  let finishReason = null;
  let tokens = null;
  let retries = 0;
  let malformed = 0;

  const end = (how) => {
    closed = true;
    const data = {
      ...meta,
      how,
      events,
      skipped,
      durMs: now() - startedAt,
      ttftMs: firstAt === null ? null : firstAt - startedAt,
      finish: finishReason,
      promptTokens: tokens?.promptTokens,
      outputTokens: tokens?.outputTokens,
      retries,
      malformed,
      kind: failed?.kind,
      status: failed?.status,
    };
    log.info("providers.sse", "request finished", data);
  };

  const send = (payload) => {
    if (closed) {
      skipped++;
      return;
    }
    events++;
    controller.enqueue(encoder.encode(`data: ${typeof payload === "string" ? payload : JSON.stringify(payload)}\n\n`));
  };
  const markFirst = () => {
    if (firstAt === null) firstAt = now();
  };

  return {
    /** One delta: text, reasoning or indexed tool call fragments, as `choices[0].delta`. */
    delta({ content, reasoning, toolCalls }) {
      const delta = {};
      if (content) delta.content = content;
      if (reasoning) delta.reasoning_content = reasoning;
      if (toolCalls?.length) delta.tool_calls = toolCalls;
      if (Object.keys(delta).length === 0) return;
      markFirst();
      send({ choices: [{ index: 0, delta, finish_reason: null }] });
    },
    finish(reason, usage = {}) {
      markFirst();
      finishReason = reason || "stop";
      tokens = { promptTokens: usage.promptTokens, outputTokens: usage.outputTokens };
      const end = now();
      const promptTokens = usage.promptTokens ?? 0;
      const outputTokens = usage.outputTokens ?? 0;
      send({
        choices: [{ index: 0, delta: {}, finish_reason: reason || "stop" }],
        usage: usageField(promptTokens, outputTokens, usage.tokens),
        timings: { prompt_n: promptTokens, prompt_ms: firstAt - startedAt, predicted_n: outputTokens, predicted_ms: end - firstAt },
      });
    },
    /** An upstream event that was not JSON and was dropped; only the count is kept. */
    malformed() {
      malformed++;
    },
    retry(attempt, of, retryAfterMs) {
      retries = attempt;
      send({ draggy_retry: { attempt, of, retryAfterMs } });
    },
    error(failure) {
      failed = failure;
      send({ error: failure });
    },
    providerState(state) {
      send({ provider_state: state });
    },
    done() {
      send("[DONE]");
      // A provider that dropped its socket reports as an unreachable failure; that is how the stream ended.
      end(!failed ? "done" : failed.kind === "provider-unreachable" ? "socket" : "error");
      controller.close();
    },
    /** The stream was cut from our side (renderer stopped reading); no close, the controller is already cancelled. */
    stop(how = "abort") {
      if (!closed) end(how);
    },
    get closed() {
      return closed;
    },
  };
}

/** A non-streaming answer in llama-server's shape. */
function completion({ content = "", reasoning = "", toolCalls = [], finish = "stop", usage = {} }) {
  const message = { role: "assistant", content };
  if (reasoning) message.reasoning_content = reasoning;
  if (toolCalls.length) message.tool_calls = toolCalls;
  const promptTokens = usage.promptTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  return {
    choices: [{ index: 0, message, finish_reason: finish }],
    usage: usageField(promptTokens, outputTokens, usage.tokens),
  };
}

module.exports = { createSse, completion };
