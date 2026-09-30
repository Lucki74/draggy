/** Google's Gemini API through generateContent. Only Draggy's functions go out, with their schemas cut
 * down to what Gemini reads, and thought signatures return only to the instance that wrote them. */
const { fromResponse } = require("../errors.cjs");
const { HostedToolError } = require("./openai.cjs");

const LEVELS = new Set(["low", "medium", "high"]);
const BUDGETS = { medium: 8192, high: 24576 };
// Gemini 3 refuses a function call in the current turn without a signature; this is Google's stand-in.
const SKIP_SIGNATURE = "skip_thought_signature_validator";
const SCHEMA_KEYS = new Set([
  "type", "format", "title", "description", "nullable", "enum", "maxItems", "minItems", "properties", "required",
  "items", "minimum", "maximum", "anyOf", "minLength", "maxLength", "pattern", "minProperties", "maxProperties", "propertyOrdering",
]);
const REFUSALS = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY"]);

/** `gemini-2.5-flash` → { version: 2.5, family: "flash" }; newer ids are assumed to work like Gemini 3. */
function modelOf(modelId) {
  const id = String(modelId).toLowerCase().replace(/^models\//, "");
  const match = /^gemini-(\d+)(?:\.(\d+))?/.exec(id);
  const family = id.includes("flash-lite") ? "lite" : id.includes("flash") ? "flash" : id.includes("pro") ? "pro" : "";
  return { version: match ? Number(`${match[1]}.${match[2] || 0}`) : 99, family };
}

function thinkingConfig(body, modelId) {
  const think = body.think ?? body.chat_template_kwargs?.enable_thinking;
  const level = LEVELS.has(body.thinking_level) ? body.thinking_level : "medium";
  const on = think === true && level !== "low";
  const { version, family } = modelOf(modelId);
  if (version < 2.5 || (typeof think !== "boolean" && version < 3)) return null;
  if (version < 3) {
    // 2.5 Pro cannot stop thinking; 128 tokens is the least it takes.
    if (!on) return { thinkingBudget: family === "pro" ? 128 : 0 };
    return { thinkingBudget: BUDGETS[level], includeThoughts: true };
  }
  if (on) return { thinkingLevel: level, includeThoughts: true };
  return { thinkingLevel: family === "pro" ? "low" : "minimal" };
}

function buildRequest(body, { baseUrl, apiKey, headers, instance }, modelId) {
  const model = String(modelId).replace(/^models\//, "");
  const { system, contents } = toContents(body.messages || [], instance?.id, modelOf(model).version >= 3);
  const payload = { contents };
  if (system) payload.systemInstruction = { parts: [{ text: system }] };
  const declarations = functionDeclarations(body.tools);
  if (declarations.length) payload.tools = [{ functionDeclarations: declarations }];
  const generationConfig = {};
  const limit = Number(body.max_tokens) > 0 ? Number(body.max_tokens) : Number(body.options?.num_predict) > 0 ? Number(body.options.num_predict) : 0;
  if (limit) generationConfig.maxOutputTokens = limit;
  const thinking = thinkingConfig(body, model);
  if (thinking) generationConfig.thinkingConfig = thinking;
  if (Object.keys(generationConfig).length) payload.generationConfig = generationConfig;

  const requestHeaders = { ...(headers || {}), "Content-Type": "application/json" };
  if (apiKey) requestHeaders["x-goog-api-key"] = apiKey;
  const method = body.stream ? "streamGenerateContent?alt=sse" : "generateContent";
  return { url: `${baseUrl}/models/${encodeURIComponent(model)}:${method}`, init: { method: "POST", headers: requestHeaders, body: JSON.stringify(payload) } };
}

/** JSON Schema cut to Gemini's subset: unknown keywords go, `const` becomes an enum, a null type becomes `nullable`. */
function sanitizeSchema(schema) {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "type" && Array.isArray(value)) {
      const types = value.filter((type) => type !== "null");
      out.type = types[0] || "string";
      if (types.length < value.length) out.nullable = true;
    } else if (key === "const") out.enum = [value];
    else if (key === "properties") out.properties = Object.fromEntries(Object.entries(value || {}).map(([name, sub]) => [name, sanitizeSchema(sub)]));
    else if (key === "enum") out.enum = (value || []).map(String);
    else if (SCHEMA_KEYS.has(key)) out[key] = sanitizeSchema(value);
  }
  if (out.enum && !out.type) out.type = "string";
  return out;
}

/** Only Draggy's function tools; Google Search, URL context and code execution are never asked for. */
function functionDeclarations(tools) {
  return (Array.isArray(tools) ? tools : [])
    .filter((tool) => tool?.type === "function" && tool.function?.name)
    .map((tool) => {
      const declaration = { name: tool.function.name, description: tool.function.description || "" };
      const parameters = sanitizeSchema(tool.function.parameters);
      if (parameters && Object.keys(parameters.properties || {}).length) declaration.parameters = parameters;
      return declaration;
    });
}

function contentParts(content) {
  if (!Array.isArray(content)) return String(content ?? "").trim() ? [{ text: String(content) }] : [];
  return content.flatMap((part) => {
    if (part?.type === "text" && String(part.text ?? "").trim()) return [{ text: String(part.text) }];
    const data = part?.type === "image_url" ? /^data:([^;,]+);base64,(.*)$/s.exec(String(part.image_url?.url || "")) : null;
    return data ? [{ inlineData: { mimeType: data[1], data: data[2] } }] : [];
  });
}

/** The signatures this instance wrote for a turn, or none; a bare `thinking` field is never sent. */
function signaturesOf(message, instanceId) {
  const tagged = message.provider_state;
  if (!instanceId || tagged?.instanceId !== instanceId || !tagged.state) return { calls: [], text: "" };
  const { calls, text } = tagged.state;
  return { calls: Array.isArray(calls) ? calls : [], text: typeof text === "string" ? text : "" };
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

function toContents(messages, instanceId, strict) {
  const system = [];
  const contents = [];
  const names = new Map();
  const pending = [];
  const push = (role, parts) => {
    if (!parts.length) return;
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
  };
  const lastUser = messages.map((m) => m.role).lastIndexOf("user");
  messages.forEach((message, position) => {
    if (message.role === "system") {
      const text = contentParts(message.content).map((part) => part.text).filter(Boolean).join("\n\n");
      if (text) system.push(text);
    } else if (message.role === "tool") {
      const name = names.get(message.tool_call_id) || message.tool_name || pending.shift() || "tool";
      push("user", [{ functionResponse: { name, response: { content: String(message.content ?? "") } } }]);
    } else if (message.role === "assistant") {
      const signatures = signaturesOf(message, instanceId);
      const parts = contentParts(message.content);
      if (signatures.text && parts.length) parts[parts.length - 1].thoughtSignature = signatures.text;
      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (calls.length) pending.length = 0;
      calls.forEach((call, index) => {
        const name = call.function?.name || "";
        if (call.id) names.set(call.id, name);
        pending.push(name);
        const part = { functionCall: { name, args: parseArgs(call.function?.arguments) } };
        const signature = signatures.calls[index] || (strict && index === 0 && position > lastUser ? SKIP_SIGNATURE : "");
        if (signature) part.thoughtSignature = signature;
        parts.push(part);
      });
      push("model", parts);
    } else {
      push("user", contentParts(message.content));
    }
  });
  return { system: system.join("\n\n"), contents };
}

/** One response chunk: its text, thoughts and calls go to `sse`, signatures into `signed`. */
function readChunk(json, sse, turn) {
  if (json.error) throw Object.assign(new Error("upstream error"), { failure: fromResponse(Number(json.error.code) || 500, json) });
  if (json.promptFeedback?.blockReason) throw refusal(json.promptFeedback.blockReason);
  const usage = json.usageMetadata;
  if (usage) turn.usage = { promptTokens: usage.promptTokenCount ?? 0, outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) };
  const candidate = json.candidates?.[0];
  if (!candidate) return;
  for (const part of candidate.content?.parts || []) {
    if (part.executableCode || part.codeExecutionResult) throw new HostedToolError(part.executableCode ? "code_execution" : "code_execution_result");
    if (part.functionCall) {
      const index = turn.calls.length;
      turn.calls.push(part.thoughtSignature || "");
      const call = { index, id: part.functionCall.id || `call_${index}`, type: "function", function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args ?? {}) } };
      sse.delta({ toolCalls: [call] });
      continue;
    }
    if (part.thoughtSignature) turn.text = part.thoughtSignature;
    if (part.thought) sse.delta({ reasoning: part.text || "" });
    else if (part.text) sse.delta({ content: part.text });
  }
  if (candidate.finishReason) turn.finish = candidate.finishReason;
}

function refusal(reason) {
  return Object.assign(new Error("refused"), { failure: { kind: "provider-refused", status: 200, message: String(reason), providerMessage: String(reason) } });
}

function finishOf(turn) {
  if (REFUSALS.has(turn.finish)) throw refusal(turn.finish);
  if (turn.finish === "MAX_TOKENS") return "length";
  return turn.calls.length ? "tool_calls" : "stop";
}

function stateOf(turn, instanceId) {
  if (!instanceId || (!turn.text && !turn.calls.some(Boolean))) return null;
  return { instanceId, state: { calls: turn.calls, text: turn.text } };
}

/** Reads Gemini's SSE and writes llama-server's; returns once the answer is complete. */
async function translateStream(stream, sse, { instanceId } = {}) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const turn = { calls: [], text: "", finish: null, usage: { promptTokens: 0, outputTokens: 0 } };
  let buffer = "";
  for (;;) {
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
      readChunk(json, sse, turn);
    }
  }
  const finish = finishOf(turn);
  const state = stateOf(turn, instanceId);
  if (state) sse.providerState(state);
  sse.finish(finish, turn.usage);
}

/** A non-streaming answer, as llama-server's `choices[0].message`, with its signatures. */
function translateJson(json, { instanceId } = {}) {
  const answer = { content: "", reasoning: "", toolCalls: [] };
  const sink = {
    delta({ content, reasoning, toolCalls }) {
      answer.content += content || "";
      answer.reasoning += reasoning || "";
      for (const call of toolCalls || []) answer.toolCalls.push({ id: call.id, type: "function", function: call.function });
    },
  };
  const turn = { calls: [], text: "", finish: null, usage: { promptTokens: 0, outputTokens: 0 } };
  readChunk(json, sink, turn);
  const state = stateOf(turn, instanceId);
  return { ...answer, finish: finishOf(turn), usage: turn.usage, ...(state ? { providerState: state } : {}) };
}

function modelsRequest({ baseUrl, apiKey, headers }) {
  const requestHeaders = { ...(headers || {}) };
  if (apiKey) requestHeaders["x-goog-api-key"] = apiKey;
  return { url: `${baseUrl}/models?pageSize=1000`, init: { method: "GET", headers: requestHeaders } };
}

/** Chat models only: a model that cannot generate content (embeddings, Imagen, Veo) is left out. */
function parseModels(json) {
  return (json?.models || [])
    .filter((model) => !Array.isArray(model.supportedGenerationMethods) || model.supportedGenerationMethods.includes("generateContent"))
    .map((model) => ({ id: String(model.name || "").replace(/^models\//, ""), contextLength: Number(model.inputTokenLimit) || null }))
    .filter((model) => model.id);
}

module.exports = { buildRequest, translateStream, translateJson, modelsRequest, parseModels, sanitizeSchema, HostedToolError };
