import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { sseToLlamaChunks } from "../../../src/ai/llamaStream";

const require = createRequire(import.meta.url);
const openai = require("./openai.cjs");
const { createSse } = require("../sse.cjs");
const { find } = require("../catalog.cjs");

const connection = (type, extra = {}) => ({ baseUrl: find(type).baseUrl, apiKey: "sk-test", headers: {}, entry: find(type), ...extra });
const payloadOf = (request) => JSON.parse(request.init.body);

/** A request as the renderer sends it today, with every field of Draggy's own. */
const RENDERER_BODY = {
  model: "@openai/gpt-5.5",
  stream: true,
  think: true,
  thinking_level: "high",
  chat_template_kwargs: { enable_thinking: true },
  options: { num_ctx: 32768, num_predict: -1 },
  messages: [
    { role: "system", content: "You are Draggy." },
    { role: "user", content: "hi", draggy_ref: { id: "u1", hash: "h" } },
    { role: "assistant", content: "", thinking: "let me look", provider_state: { instanceId: "openai", state: {} }, tool_calls: [{ type: "function", function: { name: "read_file", arguments: { path: "a" } } }] },
    { role: "tool", content: "42", tool_name: "read_file" },
  ],
  tools: [
    { type: "function", function: { name: "read_file", description: "Read.", parameters: { type: "object", properties: { path: { type: "string" } } } } },
    { type: "web_search" },
    { type: "code_interpreter", container: { type: "auto" } },
  ],
};

describe("the request that leaves", () => {
  it("carries only whitelisted fields, never Draggy's own", () => {
    const text = openai.buildRequest(RENDERER_BODY, connection("openai"), "gpt-5.5").init.body;
    for (const field of ["think", "thinking_level", "chat_template_kwargs", "options", "provider_state", "draggy_ref", "tool_name", "num_ctx"]) {
      expect(text).not.toContain(`"${field}"`);
    }
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["messages", "model", "reasoning_effort", "stream", "stream_options", "tools"]);
  });

  it("sends only Draggy's function tools, whatever else the body holds", () => {
    const { tools } = payloadOf(openai.buildRequest(RENDERER_BODY, connection("openai"), "gpt-5.5"));
    expect(tools.map((tool) => tool.type)).toEqual(["function"]);
    expect(tools[0].function.name).toBe("read_file");
  });

  it("never asks OpenRouter for a model that searches the web by itself", () => {
    expect(payloadOf(openai.buildRequest(RENDERER_BODY, connection("openrouter"), "openai/gpt-5.5:online")).model).toBe("openai/gpt-5.5");
  });

  it("puts the key in a header, never in the URL", () => {
    const request = openai.buildRequest(RENDERER_BODY, connection("openai"), "gpt-5.5");
    expect(request.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(request.init.headers.Authorization).toBe("Bearer sk-test");
  });

  it("sends a keyless server no Authorization at all", () => {
    expect(openai.buildRequest(RENDERER_BODY, connection("lmstudio", { apiKey: "" }), "m").init.headers.Authorization).toBeUndefined();
  });

  it("gives tool calls string arguments and pairs each result with its call", () => {
    const { messages } = payloadOf(openai.buildRequest(RENDERER_BODY, connection("openai"), "gpt-5.5"));
    const call = messages[2].tool_calls[0];
    expect(call).toMatchObject({ type: "function", function: { name: "read_file", arguments: '{"path":"a"}' } });
    expect(messages[2].content).toBeNull();
    expect(messages[3]).toEqual({ role: "tool", tool_call_id: call.id, content: "42" });
  });

  it("maps the thinking pill per provider", () => {
    expect(payloadOf(openai.buildRequest(RENDERER_BODY, connection("openai"), "gpt-5.5")).reasoning_effort).toBe("high");
    const off = { ...RENDERER_BODY, think: false, thinking_level: "low", chat_template_kwargs: { enable_thinking: false } };
    expect(payloadOf(openai.buildRequest(off, connection("openai"), "gpt-5.5")).reasoning_effort).toBe("low");
    expect(payloadOf(openai.buildRequest({ ...RENDERER_BODY, think: undefined, chat_template_kwargs: undefined }, connection("openai"), "gpt-4o")).reasoning_effort).toBeUndefined();
    expect(payloadOf(openai.buildRequest(RENDERER_BODY, connection("qwen"), "qwen3-max")).enable_thinking).toBe(true);
    const local = payloadOf(openai.buildRequest(RENDERER_BODY, connection("llamacpp", { apiKey: "" }), "m"));
    expect(local.chat_template_kwargs).toEqual({ enable_thinking: true });
    expect(local.messages[2].reasoning_content).toBe("let me look");
    expect(payloadOf(openai.buildRequest(RENDERER_BODY, connection("deepseek"), "deepseek-chat")).messages[2].reasoning_content).toBeUndefined();
  });

  it("uses the provider's own name for the output limit", () => {
    const body = { ...RENDERER_BODY, stream: false, max_tokens: 500 };
    expect(payloadOf(openai.buildRequest(body, connection("openai"), "gpt-5.5")).max_completion_tokens).toBe(500);
    expect(payloadOf(openai.buildRequest(body, connection("groq"), "m")).max_tokens).toBe(500);
  });
});

/** Upstream SSE lines in, the renderer's chunks out. */
async function translate(lines) {
  const encoder = new TextEncoder();
  const upstream = new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  let failure = null;
  const out = new ReadableStream({
    async start(controller) {
      const sse = createSse(controller);
      try {
        await openai.translateStream(upstream, sse);
      } catch (error) {
        failure = error;
        sse.error(error.failure || { kind: "provider-unknown-error" });
      }
      sse.done();
    },
  });
  const chunks = [];
  for await (const chunk of sseToLlamaChunks(out.getReader())) chunks.push(chunk);
  return { chunks, failure };
}

const event = (json) => `data: ${JSON.stringify(json)}\n\n`;
const delta = (d, finish = null) => event({ choices: [{ index: 0, delta: d, finish_reason: finish }] });

describe("the answer that comes back", () => {
  it("streams text and reasoning, and ends with the upstream counts", async () => {
    const { chunks } = await translate([
      delta({ reasoning_content: "think " }),
      delta({ content: "Hel" }),
      delta({ content: "lo" }, "stop"),
      event({ choices: [], usage: { prompt_tokens: 9, completion_tokens: 2 } }),
      "data: [DONE]\n\n",
    ]);
    expect(chunks.map((c) => c.message?.content ?? "").join("")).toBe("Hello");
    expect(chunks.map((c) => c.message?.thinking ?? "").join("")).toBe("think ");
    expect(chunks.find((c) => c.done)).toMatchObject({ done_reason: "stop", prompt_eval_count: 9, eval_count: 2 });
  });

  it("delivers parallel tool calls whole, each once", async () => {
    const { chunks } = await translate([
      delta({ tool_calls: [{ index: 0, id: "a", type: "function", function: { name: "read_file", arguments: '{"path":' } }] }),
      delta({ tool_calls: [{ index: 1, id: "b", type: "function", function: { name: "list_dir", arguments: "{}" } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] }),
      delta({}, "tool_calls"),
      "data: [DONE]\n\n",
    ]);
    const calls = chunks.flatMap((c) => c.message?.tool_calls ?? []);
    expect(calls).toEqual([
      { id: "a", function: { name: "read_file", arguments: { path: "x" } } },
      { id: "b", function: { name: "list_dir", arguments: {} } },
    ]);
  });

  it("keeps a length stop, and reads OpenRouter's `reasoning` field too", async () => {
    const { chunks } = await translate([delta({ reasoning: "r" }), delta({ content: "cut" }, "length"), "data: [DONE]\n\n"]);
    expect(chunks.find((c) => c.done)?.done_reason).toBe("length");
    expect(chunks.map((c) => c.message?.thinking ?? "").join("")).toBe("r");
  });

  it("ends in an error rather than passing on a hosted tool call", async () => {
    const { failure } = await translate([delta({ tool_calls: [{ index: 0, id: "ws", type: "web_search", web_search: {} }] }), "data: [DONE]\n\n"]);
    expect(failure).toBeInstanceOf(openai.HostedToolError);
  });

  it("names a refusal and an in-stream error", async () => {
    expect((await translate([delta({ content: "no" }, "content_filter"), "data: [DONE]\n\n"])).chunks.find((c) => c.error)?.error.kind).toBe("provider-refused");
    const { chunks } = await translate([event({ error: { message: "Rate limit reached", code: 429 } })]);
    expect(chunks.find((c) => c.error)?.error.kind).toBe("provider-rate-limited");
  });

  it("reads a non-streaming answer", () => {
    expect(openai.translateJson({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 1 } })).toEqual({
      content: "ok",
      reasoning: "",
      toolCalls: [],
      finish: "stop",
      usage: { promptTokens: 2, outputTokens: 1 },
    });
  });
});

describe("listing an instance's models", () => {
  it("reads ids, windows and, from OpenRouter, what each model takes", () => {
    const models = openai.parseModels({
      data: [
        { id: "gpt-5.5" },
        { id: "anthropic/claude-x", context_length: 200000, supported_parameters: ["tools", "reasoning"], architecture: { input_modalities: ["text", "image"] } },
      ],
    });
    expect(models[0]).toEqual({ id: "gpt-5.5", contextLength: null, supported: null, inputModalities: null });
    expect(models[1]).toMatchObject({ contextLength: 200000, supported: ["tools", "reasoning"], inputModalities: ["text", "image"] });
  });
});
