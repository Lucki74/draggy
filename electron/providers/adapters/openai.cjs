/** OpenAI-compatible chat completions, for cloud providers and local servers alike. The upstream body is
 * built from a whitelist: Draggy's own fields never leave, and only Draggy's function tools are sent. */
const { fromResponse } = require("../errors.cjs");

const LEVELS = new Set(["low", "medium", "high"]);

function buildRequest(body, { baseUrl, apiKey, headers, entry }, modelId) {
  const quirks = entry?.quirks || {};
  const payload = {
    // An OpenRouter `:online` model searches the web on its own: a hosted tool, so never asked for.
    model: String(modelId).replace(/:online$/, ""),
    messages: toMessages(body.messages || [], quirks),
    stream: Boolean(body.stream),
  };
  if (payload.stream) payload.stream_options = { include_usage: true };

  const tools = functionTools(body.tools);
  if (tools.length) payload.tools = tools;

  const limit = Number(body.max_tokens) > 0 ? Number(body.max_tokens) : Number(body.options?.num_predict) > 0 ? Number(body.options.num_predict) : 0;
  if (limit) payload[quirks.maxTokensField || "max_tokens"] = limit;
  for (const field of ["temperature", "top_p"]) if (typeof body[field] === "number") payload[field] = body[field];

  const think = body.think ?? body.chat_template_kwargs?.enable_thinking;
  const level = LEVELS.has(body.thinking_level) ? body.thinking_level : "medium";
  if (quirks.reasoningEffort && think === true) payload.reasoning_effort = level;
  if (quirks.enableThinking && typeof think === "boolean") payload.enable_thinking = think;
  if (quirks.templateKwargs && body.chat_template_kwargs) payload.chat_template_kwargs = body.chat_template_kwargs;
  if (quirks.templateKwargs && body.response_format) payload.response_format = body.response_format;

  const requestHeaders = { ...(headers || {}), "Content-Type": "application/json" };
  if (apiKey) requestHeaders.Authorization = `Bearer ${apiKey}`;
  return { url: `${baseUrl}/chat/completions`, init: { method: "POST", headers: requestHeaders, body: JSON.stringify(payload) } };
}

/** Only Draggy's function tools; any hosted tool (web search, code interpreter, …) is dropped. */
function functionTools(tools) {
  return (Array.isArray(tools) ? tools : [])
    .filter((tool) => tool?.type === "function" && tool.function?.name)
    .map((tool) => ({ type: "function", function: { name: tool.function.name, description: tool.function.description || "", parameters: tool.function.parameters || { type: "object", properties: {} } } }));
}

function toMessages(messages, quirks) {
  const pending = [];
  let counter = 0;
  return messages.map((message) => {
    const role = message.role;
    if (role === "tool") {
      return { role: "tool", tool_call_id: message.tool_call_id || pending.shift() || `call_${counter++}`, content: String(message.content ?? "") };
    }
    const out = { role, content: message.content ?? "" };
    if (role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length) {
      pending.length = 0;
      out.tool_calls = message.tool_calls.map((call) => {
        const id = call.id || `call_${counter++}`;
        pending.push(id);
        const args = call.function?.arguments;
        return { id, type: "function", function: { name: call.function?.name || "", arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}) } };
      });
      if (!String(out.content).trim()) out.content = null;
    }
    // Reasoning goes back only to a server that reads it (llama.cpp-style); DeepSeek rejects it outright.
    if (role === "assistant" && quirks.templateKwargs && message.thinking) out.reasoning_content = message.thinking;
    return out;
  });
}

class HostedToolError extends Error {}

/** Reads the upstream SSE and writes llama-server's; returns once the answer is complete. */
async function translateStream(stream, sse) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finish = null;
  let usage = {};

  const handle = (data) => {
    if (data === "[DONE]") return true;
    let json;
    try {
      json = JSON.parse(data);
    } catch {
      return false;
    }
    if (json.error) throw Object.assign(new Error("upstream error"), { failure: fromResponse(json.error.code === 429 ? 429 : 500, json) });
    if (json.usage) usage = { promptTokens: json.usage.prompt_tokens ?? 0, outputTokens: json.usage.completion_tokens ?? 0 };
    const choice = json.choices?.[0];
    if (!choice) return false;
    const delta = choice.delta || {};
    const toolCalls = (delta.tool_calls || []).map((call) => {
      if (call.type && call.type !== "function") throw new HostedToolError(call.type);
      return { index: call.index ?? 0, ...(call.id ? { id: call.id } : {}), type: "function", function: { ...(call.function?.name ? { name: call.function.name } : {}), arguments: call.function?.arguments ?? "" } };
    });
    sse.delta({ content: delta.content || "", reasoning: delta.reasoning_content || delta.reasoning || "", toolCalls });
    if (choice.finish_reason) finish = choice.finish_reason;
    return false;
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (line.startsWith("data:") && handle(line.slice(5).trim())) {
        buffer = "";
        break;
      }
    }
  }
  if (finish === "content_filter") throw Object.assign(new Error("refused"), { failure: { kind: "provider-refused", status: 200, message: "content_filter", providerMessage: "content_filter" } });
  sse.finish(finish === "length" ? "length" : finish === "tool_calls" ? "tool_calls" : "stop", usage);
}

/** A non-streaming answer, as llama-server's `choices[0].message`. */
function translateJson(json) {
  const choice = json.choices?.[0] || {};
  const message = choice.message || {};
  for (const call of message.tool_calls || []) if (call.type && call.type !== "function") throw new HostedToolError(call.type);
  return {
    content: message.content || "",
    reasoning: message.reasoning_content || message.reasoning || "",
    toolCalls: (message.tool_calls || []).map((call) => ({ id: call.id, type: "function", function: { name: call.function?.name || "", arguments: call.function?.arguments ?? "" } })),
    finish: choice.finish_reason === "length" ? "length" : choice.finish_reason === "tool_calls" ? "tool_calls" : "stop",
    usage: { promptTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? 0 },
  };
}

/** The models an instance offers, from its `/models` listing. */
function modelsRequest({ baseUrl, apiKey, headers }) {
  const requestHeaders = { ...(headers || {}) };
  if (apiKey) requestHeaders.Authorization = `Bearer ${apiKey}`;
  return { url: `${baseUrl}/models`, init: { method: "GET", headers: requestHeaders } };
}

function parseModels(json) {
  return (json?.data || json?.models || [])
    .map((model) => ({
      id: String(model.id || model.name || ""),
      contextLength: Number(model.context_length || model.context_window || model.max_context_length || model.top_provider?.context_length) || null,
      // OpenRouter says what each model takes; nobody else does, and patterns fill the gap.
      supported: Array.isArray(model.supported_parameters) ? model.supported_parameters : null,
      inputModalities: model.architecture?.input_modalities || null,
    }))
    .filter((model) => model.id);
}

module.exports = { buildRequest, translateStream, translateJson, modelsRequest, parseModels, HostedToolError };
