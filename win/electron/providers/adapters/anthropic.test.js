import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { sseToLlamaChunks } from "../../../src/ai/llamaStream";

const require = createRequire(import.meta.url);
const anthropic = require("./anthropic.cjs");
const { createSse } = require("../sse.cjs");
const { find } = require("../catalog.cjs");

const connection = (extra = {}) => ({ baseUrl: find("anthropic").baseUrl, apiKey: "sk-ant-test", headers: {}, entry: find("anthropic"), instance: { id: "anthropic" }, ...extra });
const payloadOf = (body, model = "claude-sonnet-4-6", extra) => JSON.parse(anthropic.buildRequest(body, connection(extra), model).init.body);

const SIGNED = { type: "thinking", thinking: "look in a", signature: "sig-1" };
const RENDERER_BODY = {
  model: "@anthropic/claude-sonnet-4-6",
  stream: true,
  think: true,
  thinking_level: "high",
  chat_template_kwargs: { enable_thinking: true },
  temperature: 0.7,
  options: { num_ctx: 32768, num_predict: -1 },
  messages: [
    { role: "system", content: "You are Draggy." },
    { role: "user", content: "hi", draggy_ref: { id: "u1", hash: "h" } },
    { role: "user", content: [{ type: "text", text: "and this" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] },
    {
      role: "assistant",
      content: "",
      thinking: "look in a",
      provider_state: { instanceId: "anthropic", state: { blocks: [SIGNED] } },
      tool_calls: [{ id: "call.1", type: "function", function: { name: "read_file", arguments: '{"path":"a"}' } }],
    },
    { role: "tool", content: "42", tool_call_id: "call.1" },
  ],
  tools: [
    { type: "function", function: { name: "read_file", description: "Read.", parameters: { type: "object", properties: { path: { type: "string" } } } } },
    { type: "web_search_20250305", name: "web_search" },
    { type: "code_execution_20250825", name: "code_execution" },
  ],
};

describe("the request that leaves", () => {
  it("carries only whitelisted fields, the key in a header, and caches the prompt and tools", () => {
    const request = anthropic.buildRequest(RENDERER_BODY, connection(), "claude-sonnet-4-6");
    const text = request.init.body;
    for (const field of ["think", "thinking_level", "chat_template_kwargs", "options", "provider_state", "draggy_ref", "num_ctx", "temperature"]) {
      expect(text).not.toContain(`"${field}"`);
    }
    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request.url).not.toContain("sk-ant-test");
    expect(request.init.headers["x-api-key"]).toBe("sk-ant-test");
    expect(request.init.headers["anthropic-version"]).toBe("2023-06-01");
    const payload = JSON.parse(text);
    expect(payload.system).toEqual([{ type: "text", text: "You are Draggy.", cache_control: { type: "ephemeral" } }]);
    expect(payload.tools).toEqual([
      { name: "read_file", description: "Read.", input_schema: { type: "object", properties: { path: { type: "string" } } }, cache_control: { type: "ephemeral" } },
    ]);
  });

  it("merges same-role turns into blocks, with images as base64 and tool results as the user's", () => {
    const { messages } = payloadOf(RENDERER_BODY);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(messages[0].content).toEqual([
      { type: "text", text: "hi" },
      { type: "text", text: "and this" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    ]);
    expect(messages[1].content.at(-1)).toEqual({ type: "tool_use", id: "call_1", name: "read_file", input: { path: "a" } });
    expect(messages[2].content).toEqual([{ type: "tool_result", tool_use_id: "call_1", content: "42" }]);
  });

  it("drops a thinking field without a matching signature, and sends one with its signature as a thinking block", () => {
    expect(payloadOf(RENDERER_BODY).messages[1].content[0]).toEqual(SIGNED);
    const foreign = structuredClone(RENDERER_BODY);
    foreign.messages[3].provider_state.instanceId = "anthropic-work";
    expect(JSON.stringify(payloadOf(foreign))).not.toContain("look in a");
    const unsigned = structuredClone(RENDERER_BODY);
    unsigned.messages[3].provider_state.state.blocks = [{ type: "thinking", thinking: "look in a" }];
    expect(JSON.stringify(payloadOf(unsigned))).not.toContain("look in a");
    delete unsigned.messages[3].provider_state;
    expect(payloadOf(unsigned).messages[1].content.map((b) => b.type)).toEqual(["tool_use"]);
  });

  it("asks for the catalog's limit when Draggy asks for none", () => {
    expect(payloadOf(RENDERER_BODY).max_tokens).toBe(32000);
    expect(payloadOf(RENDERER_BODY, "claude-3-5-haiku-20241022").max_tokens).toBe(8192);
    expect(payloadOf({ ...RENDERER_BODY, max_tokens: 900 }).max_tokens).toBe(900);
  });
});

describe("the thinking switch", () => {
  const on = (model, level = "high") => payloadOf({ ...RENDERER_BODY, think: true, thinking_level: level }, model);
  const off = (model) => payloadOf({ ...RENDERER_BODY, think: false, thinking_level: "low" }, model);
  const pick = ({ thinking, output_config }) => ({ thinking, output_config });

  it("gives a 4.5 or older model a budget under its limit, with the interleaved header", () => {
    expect(on("claude-haiku-4-5-20251001").thinking).toEqual({ type: "enabled", budget_tokens: 24576 });
    expect(on("claude-opus-4-20250514", "medium").thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
    expect(payloadOf({ ...RENDERER_BODY, max_tokens: 4096 }, "claude-3-7-sonnet-20250219").thinking).toEqual({ type: "enabled", budget_tokens: 3072 });
    const request = anthropic.buildRequest(RENDERER_BODY, connection(), "claude-sonnet-4-5");
    expect(request.init.headers["anthropic-beta"]).toBe("interleaved-thinking-2025-05-14");
    expect(pick(off("claude-sonnet-4-5"))).toEqual({});
  });

  it("gives newer models adaptive thinking at the pill's effort, and the least each allows when off", () => {
    expect(pick(on("claude-sonnet-4-6", "medium"))).toEqual({ thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "medium" } });
    expect(anthropic.buildRequest(RENDERER_BODY, connection(), "claude-opus-5-5").init.headers["anthropic-beta"]).toBeUndefined();
    expect(pick(off("claude-opus-4-8"))).toEqual({ thinking: { type: "disabled" } });
    expect(pick(off("claude-sonnet-5"))).toEqual({ thinking: { type: "disabled" } });
    expect(pick(off("claude-sonnet-5-5"))).toEqual({ thinking: { type: "between_tools" }, output_config: { effort: "low" } });
    for (const model of ["claude-opus-5-5", "claude-fable-5-1", "claude-mythos-5", "claude-mythos-preview"]) {
      expect(pick(off(model))).toEqual({ thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "low" } });
    }
  });
});

/** Upstream SSE lines in, the renderer's chunks out. */
async function translate(lines, tag = { instanceId: "anthropic" }) {
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
        await anthropic.translateStream(upstream, sse, tag);
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

const event = (json) => `event: ${json.type}\ndata: ${JSON.stringify(json)}\n\n`;
const start = (index, block) => event({ type: "content_block_start", index, content_block: block });
const blockDelta = (index, delta) => event({ type: "content_block_delta", index, delta });
const stop = (index) => event({ type: "content_block_stop", index });
const end = (reason, output = 5) => [event({ type: "message_delta", delta: { stop_reason: reason }, usage: { output_tokens: output } }), event({ type: "message_stop" })];
const begin = event({ type: "message_start", message: { usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 1 } } });

describe("the answer that comes back", () => {
  it("streams thinking, text and a tool call, and hands back the signed thinking tagged for its instance", async () => {
    const { chunks } = await translate([
      begin,
      start(0, { type: "thinking", thinking: "" }),
      blockDelta(0, { type: "thinking_delta", thinking: "look " }),
      blockDelta(0, { type: "thinking_delta", thinking: "in a" }),
      blockDelta(0, { type: "signature_delta", signature: "sig-1" }),
      stop(0),
      start(1, { type: "text", text: "" }),
      blockDelta(1, { type: "text_delta", text: "Reading." }),
      stop(1),
      start(2, { type: "tool_use", id: "toolu_1", name: "read_file", input: {} }),
      blockDelta(2, { type: "input_json_delta", partial_json: '{"path":' }),
      blockDelta(2, { type: "input_json_delta", partial_json: '"a"}' }),
      stop(2),
      start(3, { type: "tool_use", id: "toolu_2", name: "list_files", input: {} }),
      stop(3),
      ...end("tool_use", 7),
    ]);
    expect(chunks.map((c) => c.message?.thinking ?? "").join("")).toBe("look in a");
    expect(chunks.map((c) => c.message?.content ?? "").join("")).toBe("Reading.");
    const calls = chunks.flatMap((c) => c.message?.tool_calls ?? []);
    expect(calls.map((c) => [c.function.name, c.function.arguments])).toEqual([["read_file", { path: "a" }], ["list_files", {}]]);
    expect(chunks.find((c) => c.provider_state)?.provider_state).toEqual({ instanceId: "anthropic", state: { blocks: [SIGNED] } });
    const last = chunks.at(-1);
    expect([last.done_reason, last.prompt_eval_count, last.eval_count]).toEqual(["tool_calls", 100, 7]);
  });

  it("reports max_tokens as length, and keeps no state when nothing was signed", async () => {
    const { chunks } = await translate([begin, start(0, { type: "text", text: "" }), blockDelta(0, { type: "text_delta", text: "cut" }), stop(0), ...end("max_tokens")]);
    expect(chunks.at(-1).done_reason).toBe("length");
    expect(chunks.some((c) => c.provider_state)).toBe(false);
  });

  it("ends the turn when the model calls a server tool Draggy never offered", async () => {
    const { failure } = await translate([begin, start(0, { type: "server_tool_use", id: "srv_1", name: "web_search", input: {} }), stop(0), ...end("end_turn")]);
    expect(failure).toBeInstanceOf(anthropic.HostedToolError);
  });

  it("names an overloaded upstream mid-stream", async () => {
    const { failure } = await translate([begin, event({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })]);
    expect(failure.failure.status).toBe(529);
  });

  it("answers once with the same fields and the signed thinking", () => {
    const answer = anthropic.translateJson(
      {
        content: [SIGNED, { type: "redacted_thinking", data: "x" }, { type: "text", text: "Hi" }, { type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "a" } }],
        stop_reason: "tool_use",
        usage: { input_tokens: 3, output_tokens: 4 },
      },
      { instanceId: "anthropic" },
    );
    expect(answer).toMatchObject({ content: "Hi", reasoning: "look in a", finish: "tool_calls", usage: { promptTokens: 3, outputTokens: 4 } });
    expect(answer.toolCalls[0].function).toEqual({ name: "read_file", arguments: '{"path":"a"}' });
    expect(answer.providerState).toEqual({ instanceId: "anthropic", state: { blocks: [SIGNED, { type: "redacted_thinking", data: "x" }] } });
  });
});

describe("the model listing", () => {
  it("asks with the key in a header and reads each model's window", () => {
    const request = anthropic.modelsRequest(connection());
    expect(request.url).toBe("https://api.anthropic.com/v1/models?limit=1000");
    expect(request.init.headers).toMatchObject({ "x-api-key": "sk-ant-test", "anthropic-version": "2023-06-01" });
    expect(anthropic.parseModels({ data: [{ id: "claude-opus-5-5", max_input_tokens: 1000000 }, { id: "" }] })).toEqual([{ id: "claude-opus-5-5", contextLength: 1000000 }]);
  });
});
