/** Ollama's native /api/chat, whose `/v1` twin ignores the context size. It streams one JSON object
 * per line and hands tool calls whole, so they are numbered and passed on as they arrive. */
const { fromResponse } = require("../errors.cjs");

function buildRequest(body, { baseUrl, headers }, modelId) {
  const payload = { model: String(modelId), messages: toMessages(body.messages || []), stream: Boolean(body.stream) };
  const tools = (Array.isArray(body.tools) ? body.tools : [])
    .filter((tool) => tool?.type === "function" && tool.function?.name)
    .map((tool) => ({ type: "function", function: { name: tool.function.name, description: tool.function.description || "", parameters: tool.function.parameters || { type: "object", properties: {} } } }));
  if (tools.length) payload.tools = tools;

  const options = {};
  if (Number(body.options?.num_ctx) > 0) options.num_ctx = Number(body.options.num_ctx);
  const limit = Number(body.max_tokens) > 0 ? Number(body.max_tokens) : Number(body.options?.num_predict) > 0 ? Number(body.options.num_predict) : 0;
  if (limit) options.num_predict = limit;
  if (typeof body.temperature === "number") options.temperature = body.temperature;
  if (Object.keys(options).length) payload.options = options;

  const think = body.think ?? body.chat_template_kwargs?.enable_thinking;
  if (typeof think === "boolean") payload.think = think;
  if (body.response_format?.json_schema?.schema) payload.format = body.response_format.json_schema.schema;

  return { url: `${baseUrl}/api/chat`, init: { method: "POST", headers: { ...(headers || {}), "Content-Type": "application/json" }, body: JSON.stringify(payload) } };
}

/** Text parts join into `content`; images become Ollama's bare base64 `images`. */
function toMessages(messages) {
  return messages.map((message) => {
    const out = { role: message.role };
    if (Array.isArray(message.content)) {
      out.content = message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
      const images = message.content.filter((part) => part.type === "image_url").map((part) => String(part.image_url?.url || "").replace(/^data:[^,]*,/, ""));
      if (images.length) out.images = images;
    } else out.content = String(message.content ?? "");
    if (message.role === "assistant" && message.thinking) out.thinking = message.thinking;
    if (message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length) {
      out.tool_calls = message.tool_calls.map((call) => {
        const args = call.function?.arguments;
        let parsed = args;
        if (typeof args === "string") {
          try {
            parsed = JSON.parse(args);
          } catch {
            parsed = {};
          }
        }
        return { function: { name: call.function?.name || "", arguments: parsed ?? {} } };
      });
    }
    if (message.role === "tool" && message.tool_name) out.tool_name = message.tool_name;
    return out;
  });
}

function usageOf(json) {
  return { promptTokens: json.prompt_eval_count ?? 0, outputTokens: json.eval_count ?? 0 };
}

async function translateStream(stream, sse) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let calls = 0;
  let final = null;

  const handle = (line) => {
    if (!line.trim()) return;
    const json = JSON.parse(line);
    if (json.error) throw Object.assign(new Error("upstream error"), { failure: fromResponse(500, { error: { message: json.error } }) });
    const message = json.message || {};
    const toolCalls = (message.tool_calls || []).map((call) => ({
      index: calls,
      id: `call_${calls++}`,
      type: "function",
      function: { name: call.function?.name || "", arguments: JSON.stringify(call.function?.arguments ?? {}) },
    }));
    sse.delta({ content: message.content || "", reasoning: message.thinking || "", toolCalls });
    if (json.done) final = json;
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf("\n")) !== -1) {
      handle(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
    }
  }
  if (buffer.trim()) handle(buffer);
  const reason = final?.done_reason === "length" ? "length" : calls > 0 ? "tool_calls" : "stop";
  sse.finish(reason, usageOf(final || {}));
}

function translateJson(json) {
  const message = json.message || {};
  const toolCalls = (message.tool_calls || []).map((call, index) => ({ id: `call_${index}`, type: "function", function: { name: call.function?.name || "", arguments: JSON.stringify(call.function?.arguments ?? {}) } }));
  return {
    content: message.content || "",
    reasoning: message.thinking || "",
    toolCalls,
    finish: json.done_reason === "length" ? "length" : toolCalls.length ? "tool_calls" : "stop",
    usage: usageOf(json),
  };
}

function modelsRequest({ baseUrl, headers }) {
  return { url: `${baseUrl}/api/tags`, init: { method: "GET", headers: { ...(headers || {}) } } };
}

/** A model served from Ollama's cloud rather than this computer: its data leaves the machine. */
function isCloudModel(model) {
  return /[:-]cloud$/.test(String(model.name || model.model || "")) || Boolean(model.remote_host);
}

function parseModels(json) {
  return (json?.models || []).map((model) => ({ id: String(model.name || model.model || ""), contextLength: null, cloud: isCloudModel(model) })).filter((model) => model.id);
}

/** What a model can do and its window, from `/api/show`. */
function showRequest({ baseUrl, headers }, modelId) {
  return { url: `${baseUrl}/api/show`, init: { method: "POST", headers: { ...(headers || {}), "Content-Type": "application/json" }, body: JSON.stringify({ model: modelId }) } };
}

function parseShow(json) {
  const info = json?.model_info || {};
  const contextKey = Object.keys(info).find((key) => key.endsWith(".context_length"));
  const capabilities = (json?.capabilities || []).filter((c) => ["tools", "vision", "thinking"].includes(c));
  return { capabilities, contextLength: contextKey ? Number(info[contextKey]) || null : null };
}

module.exports = { buildRequest, translateStream, translateJson, modelsRequest, parseModels, showRequest, parseShow };
