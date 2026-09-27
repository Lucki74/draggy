/** Writes a provider's answer the way llama-server streams one, so the renderer's readers stay the only
 * readers. Timings are made up from the wall clock, since only the engine measures its own. */

const encoder = new TextEncoder();

function createSse(controller, { now = () => Date.now() } = {}) {
  const startedAt = now();
  let firstAt = null;
  let closed = false;

  const send = (payload) => {
    if (closed) return;
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
      const end = now();
      const promptTokens = usage.promptTokens ?? 0;
      const outputTokens = usage.outputTokens ?? 0;
      send({
        choices: [{ index: 0, delta: {}, finish_reason: reason || "stop" }],
        usage: { prompt_tokens: promptTokens, completion_tokens: outputTokens, total_tokens: promptTokens + outputTokens },
        timings: { prompt_n: promptTokens, prompt_ms: firstAt - startedAt, predicted_n: outputTokens, predicted_ms: end - firstAt },
      });
    },
    retry(attempt, of, retryAfterMs) {
      send({ draggy_retry: { attempt, of, retryAfterMs } });
    },
    error(failure) {
      send({ error: failure });
    },
    providerState(state) {
      send({ provider_state: state });
    },
    done() {
      send("[DONE]");
      closed = true;
      controller.close();
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
    usage: { prompt_tokens: promptTokens, completion_tokens: outputTokens, total_tokens: promptTokens + outputTokens },
  };
}

module.exports = { createSse, completion };
