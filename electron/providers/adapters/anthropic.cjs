/** Anthropic's Messages API. The body is built from a whitelist, only Draggy's function tools go out,
 * and signed thinking travels back to the instance that wrote it, never to anyone else. */
const { fromResponse } = require("../errors.cjs");
const { capabilitiesFor } = require("../catalog.cjs");
const { HostedToolError } = require("./openai.cjs");

const VERSION = "2023-06-01";
const LEVELS = new Set(["low", "medium", "high"]);
const DEFAULT_MAX_TOKENS = 32000;
const BUDGETS = { medium: 8192, high: 24576 };
const MIN_BUDGET = 1024;
// Claude 4.5 and older only think on a budget, and between tool calls only with this header.
const INTERLEAVED = "interleaved-thinking-2025-05-14";

/** Which of Anthropic's thinking switches a model takes; ids are `claude-<family>-<major>[-<minor>]`. */
function thinkingStyle(modelId) {
  const id = String(modelId).toLowerCase();
  const legacy = /^claude-(\d+)-(\d+)?/.exec(id);
  if (legacy) return "budget";
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2})(?!\d))?/.exec(id);
  if (!match) return "adaptive-only";
  const [, family, major, minor = "0"] = match;
  const version = Number(major) + Number(minor) / 10;
  if (family === "fable" || family === "mythos") return "adaptive-only";
  if (version < 4.6) return "budget";
  if (version < 5) return "adaptive-off-by-default";
  if (version >= 5.5) return family === "sonnet" ? "between-tools" : "adaptive-only";
  return "adaptive";
}

/** The request's thinking fields, and whether the interleaved header goes with them. */
function thinkingOf(body, modelId, maxTokens) {
  const think = body.think ?? body.chat_template_kwargs?.enable_thinking;
  const level = LEVELS.has(body.thinking_level) ? body.thinking_level : "medium";
  const on = think === true && level !== "low";
  const style = thinkingStyle(modelId);
  if (style === "budget") {
    if (!on || maxTokens <= 2 * MIN_BUDGET) return {};
    const budget = Math.max(MIN_BUDGET, Math.min(BUDGETS[level], maxTokens - MIN_BUDGET));
    return { fields: { thinking: { type: "enabled", budget_tokens: budget } }, interleaved: true };
  }
  const adaptive = { thinking: { type: "adaptive", display: "summarized" } };
  if (on) return { fields: { ...adaptive, output_config: { effort: level } } };
  if (typeof think !== "boolean" && style === "adaptive-off-by-default") return {};
  // Where "disabled" is refused, the least thinking the model allows is asked for instead.
  if (style === "adaptive-only") return { fields: { ...adaptive, output_config: { effort: "low" } } };
  if (style === "between-tools") return { fields: { thinking: { type: "between_tools" }, output_config: { effort: "low" } } };
  return { fields: { thinking: { type: "disabled" } } };
}

function buildRequest(body, { baseUrl, apiKey, headers, entry, instance }, modelId) {
  const asked = Number(body.max_tokens) > 0 ? Number(body.max_tokens) : Number(body.options?.num_predict) > 0 ? Number(body.options.num_predict) : 0;
  const maxTokens = asked || capabilitiesFor(entry, modelId).maxOutputTokens || DEFAULT_MAX_TOKENS;
  const { system, messages } = toMessages(body.messages || [], instance?.id);
  const payload = { model: String(modelId), max_tokens: maxTokens, messages };
  if (system) payload.system = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
  const tools = functionTools(body.tools);
  if (tools.length) {
    tools[tools.length - 1].cache_control = { type: "ephemeral" };
    payload.tools = tools;
  }
  if (body.stream) payload.stream = true;
  // Sampling fields are left out: newer Claude models refuse them, and thinking requires the defaults.
  const thinking = thinkingOf(body, modelId, maxTokens);
  Object.assign(payload, thinking.fields || {});

  const requestHeaders = { ...(headers || {}), "Content-Type": "application/json", "anthropic-version": VERSION };
  if (apiKey) requestHeaders["x-api-key"] = apiKey;
  if (thinking.interleaved) requestHeaders["anthropic-beta"] = INTERLEAVED;
  return { url: `${baseUrl}/messages`, init: { method: "POST", headers: requestHeaders, body: JSON.stringify(payload) } };
}

/** Only Draggy's function tools; server tools (web search, code execution, …) are never offered. */
function functionTools(tools) {
  return (Array.isArray(tools) ? tools : [])
    .filter((tool) => tool?.type === "function" && tool.function?.name)
    .map((tool) => ({ name: tool.function.name, description: tool.function.description || "", input_schema: tool.function.parameters || { type: "object", properties: {} } }));
}

const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, "_");

function imageBlock(url) {
  const data = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  return data ? { type: "image", source: { type: "base64", media_type: data[1], data: data[2] } } : { type: "image", source: { type: "url", url } };
}

function contentBlocks(content) {
  if (!Array.isArray(content)) return String(content ?? "").trim() ? [{ type: "text", text: String(content) }] : [];
  return content.flatMap((part) => {
    if (part?.type === "text" && String(part.text ?? "").trim()) return [{ type: "text", text: String(part.text) }];
    if (part?.type === "image_url" && part.image_url?.url) return [imageBlock(String(part.image_url.url))];
    return [];
  });
}

/** Signed blocks this instance wrote; a bare `thinking` field has no signature and is never sent. */
function signedBlocks(message, instanceId) {
  const tagged = message.provider_state;
  if (!instanceId || tagged?.instanceId !== instanceId || !Array.isArray(tagged.state?.blocks)) return [];
  return tagged.state.blocks.filter(
    (block) => (block?.type === "thinking" && typeof block.signature === "string" && block.signature) || (block?.type === "redacted_thinking" && block.data),
  );
}

function parseArgs(args) {
  if (args && typeof args === "object") return args;
  try {
    const parsed = JSON.parse(args || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function toMessages(messages, instanceId) {
  const system = [];
  const out = [];
  const pending = [];
  let counter = 0;
  const push = (role, blocks) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const message of messages) {
    if (message.role === "system") {
      const text = contentBlocks(message.content).filter((block) => block.type === "text").map((block) => block.text).join("\n\n");
      if (text) system.push(text);
    } else if (message.role === "tool") {
      const id = safeId(message.tool_call_id || pending.shift() || `call_${counter++}`);
      const text = String(message.content ?? "");
      push("user", [{ type: "tool_result", tool_use_id: id, ...(text ? { content: text } : {}) }]);
    } else if (message.role === "assistant") {
      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (calls.length) pending.length = 0;
      const uses = calls.map((call) => {
        const id = safeId(call.id || `call_${counter++}`);
        pending.push(id);
        return { type: "tool_use", id, name: call.function?.name || "", input: parseArgs(call.function?.arguments) };
      });
      push("assistant", [...signedBlocks(message, instanceId), ...contentBlocks(message.content), ...uses]);
    } else {
      push("user", contentBlocks(message.content));
    }
  }
  return { system: system.join("\n\n"), messages: out };
}

function failureOf(error) {
  const status = error?.type === "overloaded_error" ? 529 : error?.type === "rate_limit_error" ? 429 : 500;
  return fromResponse(status, { error });
}

const HOSTED = /^(server_tool_use|.*_tool_result|mcp_tool_use)$/;

function finishOf(stopReason) {
  if (stopReason === "refusal") throw Object.assign(new Error("refused"), { failure: { kind: "provider-refused", status: 200, message: "refusal", providerMessage: "refusal" } });
  return stopReason === "max_tokens" ? "length" : stopReason === "tool_use" ? "tool_calls" : "stop";
}

/** Reads Anthropic's events and writes llama-server's; returns once the answer is complete. */
async function translateStream(stream, sse, { instanceId } = {}) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const blocks = new Map();
  const signed = [];
  let buffer = "";
  let toolIndex = 0;
  let stopReason = null;
  const usage = { promptTokens: 0, outputTokens: 0 };

  const handle = (json) => {
    if (json.type === "error") throw Object.assign(new Error("upstream error"), { failure: failureOf(json.error) });
    if (json.type === "message_start") {
      const u = json.message?.usage || {};
      usage.promptTokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      usage.outputTokens = u.output_tokens ?? 0;
    } else if (json.type === "content_block_start") {
      const block = json.content_block || {};
      if (HOSTED.test(block.type || "")) throw new HostedToolError(block.type);
      if (block.type === "tool_use") {
        const index = toolIndex++;
        blocks.set(json.index, { type: "tool_use", index });
        sse.delta({ toolCalls: [{ index, id: block.id, type: "function", function: { name: block.name, arguments: "" } }] });
      } else if (block.type === "thinking") {
        blocks.set(json.index, { type: "thinking", thinking: block.thinking || "", signature: block.signature || "" });
      } else if (block.type === "redacted_thinking") {
        signed.push({ type: "redacted_thinking", data: block.data });
      } else blocks.set(json.index, { type: block.type });
    } else if (json.type === "content_block_delta") {
      const block = blocks.get(json.index) || {};
      const delta = json.delta || {};
      if (delta.type === "text_delta") sse.delta({ content: delta.text || "" });
      else if (delta.type === "thinking_delta") {
        block.thinking = (block.thinking || "") + (delta.thinking || "");
        sse.delta({ reasoning: delta.thinking || "" });
      } else if (delta.type === "signature_delta") block.signature = delta.signature || "";
      else if (delta.type === "input_json_delta" && block.type === "tool_use") {
        block.args = true;
        sse.delta({ toolCalls: [{ index: block.index, type: "function", function: { arguments: delta.partial_json || "" } }] });
      }
    } else if (json.type === "content_block_stop") {
      const block = blocks.get(json.index);
      // A call with no arguments streams none, and an empty string is not an object.
      if (block?.type === "tool_use" && !block.args) sse.delta({ toolCalls: [{ index: block.index, type: "function", function: { arguments: "{}" } }] });
      if (block?.type === "thinking" && block.signature) signed.push({ type: "thinking", thinking: block.thinking, signature: block.signature });
    } else if (json.type === "message_delta") {
      if (json.delta?.stop_reason) stopReason = json.delta.stop_reason;
      if (json.usage?.output_tokens !== undefined) usage.outputTokens = json.usage.output_tokens;
    }
    return json.type === "message_stop";
  };

  outer: for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line.startsWith("data:")) continue;
      let json;
      try {
        json = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (handle(json)) break outer;
    }
  }
  const finish = finishOf(stopReason);
  if (instanceId && signed.length) sse.providerState({ instanceId, state: { blocks: signed } });
  sse.finish(finish, usage);
}

/** A non-streaming answer, as llama-server's `choices[0].message`, with its signed thinking. */
function translateJson(json, { instanceId } = {}) {
  const content = Array.isArray(json.content) ? json.content : [];
  for (const block of content) if (HOSTED.test(block.type || "")) throw new HostedToolError(block.type);
  const signed = content
    .filter((block) => (block.type === "thinking" && block.signature) || block.type === "redacted_thinking")
    .map((block) => (block.type === "thinking" ? { type: "thinking", thinking: block.thinking || "", signature: block.signature } : { type: "redacted_thinking", data: block.data }));
  const u = json.usage || {};
  return {
    content: content.filter((block) => block.type === "text").map((block) => block.text).join(""),
    reasoning: content.filter((block) => block.type === "thinking").map((block) => block.thinking || "").join(""),
    toolCalls: content
      .filter((block) => block.type === "tool_use")
      .map((block) => ({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) } })),
    finish: finishOf(json.stop_reason),
    usage: { promptTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), outputTokens: u.output_tokens ?? 0 },
    ...(instanceId && signed.length ? { providerState: { instanceId, state: { blocks: signed } } } : {}),
  };
}

function modelsRequest({ baseUrl, apiKey, headers }) {
  const requestHeaders = { ...(headers || {}), "anthropic-version": VERSION };
  if (apiKey) requestHeaders["x-api-key"] = apiKey;
  return { url: `${baseUrl}/models?limit=1000`, init: { method: "GET", headers: requestHeaders } };
}

function parseModels(json) {
  return (json?.data || [])
    .map((model) => ({ id: String(model.id || ""), contextLength: Number(model.max_input_tokens) || null }))
    .filter((model) => model.id);
}

module.exports = { buildRequest, translateStream, translateJson, modelsRequest, parseModels, thinkingStyle, HostedToolError };
