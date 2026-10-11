import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { sseToLlamaChunks } from "../../../src/ai/llamaStream";

const require = createRequire(import.meta.url);
const gemini = require("./gemini.cjs");
const { createSse } = require("../sse.cjs");
const { find } = require("../catalog.cjs");

const connection = () => ({ baseUrl: find("gemini").baseUrl, apiKey: "AIza-test", headers: {}, entry: find("gemini"), instance: { id: "gemini" } });
const payloadOf = (body, model = "gemini-3-flash") => JSON.parse(gemini.buildRequest(body, connection(), model).init.body);

const RENDERER_BODY = {
  model: "@gemini/gemini-3-flash",
  stream: true,
  think: true,
  thinking_level: "high",
  chat_template_kwargs: { enable_thinking: true },
  temperature: 0.7,
  options: { num_ctx: 32768, num_predict: -1 },
  messages: [
    { role: "system", content: "You are Draggy." },
    { role: "user", content: [{ type: "text", text: "what is this" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }], draggy_ref: { id: "u1", hash: "h" } },
    {
      role: "assistant",
      content: "Looking.",
      thinking: "look in a",
      provider_state: { instanceId: "gemini", state: { calls: ["sig-call"], text: "" } },
      tool_calls: [
        { id: "call_0", type: "function", function: { name: "read_file", arguments: '{"path":"a"}' } },
        { id: "call_1", type: "function", function: { name: "list_files", arguments: "{}" } },
      ],
    },
    { role: "tool", content: "42", tool_call_id: "call_0" },
    { role: "tool", content: "a, b", tool_call_id: "call_1" },
  ],
  tools: [
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read.",
        parameters: {
          $schema: "http://json-schema.org/draft-07/schema#",
          type: "object",
          additionalProperties: false,
          properties: { path: { type: ["string", "null"], examples: ["a"] }, mode: { const: "text" } },
          required: ["path"],
        },
      },
    },
    { type: "function", function: { name: "list_files", description: "List.", parameters: { type: "object", properties: {} } } },
    { googleSearch: {} },
    { type: "code_execution" },
  ],
};

describe("the request that leaves", () => {
  it("carries only whitelisted fields, the key in a header, and streams over SSE", () => {
    const request = gemini.buildRequest(RENDERER_BODY, connection(), "gemini-3-flash");
    for (const field of ["think", "thinking_level", "chat_template_kwargs", "options", "provider_state", "draggy_ref", "num_ctx", "temperature", "look in a"]) {
      expect(request.init.body).not.toContain(`"${field}"`);
    }
    expect(request.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:streamGenerateContent?alt=sse");
    expect(request.url).not.toContain("AIza-test");
    expect(request.init.headers["x-goog-api-key"]).toBe("AIza-test");
    expect(gemini.buildRequest({ ...RENDERER_BODY, stream: false }, connection(), "../../x").url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/..%2F..%2Fx:generateContent",
    );
  });

  it("sends only Draggy's functions, with schemas cut to what Gemini reads", () => {
    const { tools } = payloadOf(RENDERER_BODY);
    expect(tools).toEqual([
      {
        functionDeclarations: [
          {
            name: "read_file",
            description: "Read.",
            parameters: { type: "object", properties: { path: { type: "string", nullable: true }, mode: { enum: ["text"], type: "string" } }, required: ["path"] },
          },
          { name: "list_files", description: "List." },
        ],
      },
    ]);
  });

  it("turns the conversation into user and model turns, with images inline and parallel results together", () => {
    const { systemInstruction, contents } = payloadOf(RENDERER_BODY);
    expect(systemInstruction).toEqual({ parts: [{ text: "You are Draggy." }] });
    expect(contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(contents[0].parts[1]).toEqual({ inlineData: { mimeType: "image/png", data: "AAAA" } });
    expect(contents[2].parts).toEqual([
      { functionResponse: { name: "read_file", response: { content: "42" } } },
      { functionResponse: { name: "list_files", response: { content: "a, b" } } },
    ]);
  });

  it("returns a signature only to the instance that wrote it, and stands in for a missing one on Gemini 3", () => {
    const calls = (body, model) => payloadOf(body, model).contents[1].parts.filter((part) => part.functionCall);
    expect(calls(RENDERER_BODY).map((part) => part.thoughtSignature)).toEqual(["sig-call", undefined]);
    const foreign = structuredClone(RENDERER_BODY);
    foreign.messages[2].provider_state.instanceId = "gemini-work";
    expect(JSON.stringify(payloadOf(foreign))).not.toContain("sig-call");
    expect(calls(foreign).map((part) => part.thoughtSignature)).toEqual(["skip_thought_signature_validator", undefined]);
    expect(calls(foreign, "gemini-2.5-flash").map((part) => part.thoughtSignature)).toEqual([undefined, undefined]);
  });
});

describe("the thinking switch", () => {
  const config = (model, think, level) => payloadOf({ ...RENDERER_BODY, think, thinking_level: level }, model).generationConfig?.thinkingConfig;

  it("sets a level on Gemini 3 and the least each model allows when off", () => {
    expect(config("gemini-3-flash", true, "high")).toEqual({ thinkingLevel: "high", includeThoughts: true });
    expect(config("gemini-3-flash", false, "low")).toEqual({ thinkingLevel: "minimal" });
    expect(config("gemini-3.1-pro-preview", false, "low")).toEqual({ thinkingLevel: "low" });
  });

  it("sets a budget on 2.5, never zero on Pro, and nothing before 2.5", () => {
    expect(config("gemini-2.5-flash", true, "medium")).toEqual({ thinkingBudget: 8192, includeThoughts: true });
    expect(config("gemini-2.5-flash", false, "low")).toEqual({ thinkingBudget: 0 });
    expect(config("gemini-2.5-pro", false, "low")).toEqual({ thinkingBudget: 128 });
    expect(config("gemini-2.0-flash", true, "high")).toBeUndefined();
  });
});

async function translate(lines, tag = { instanceId: "gemini" }) {
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
        await gemini.translateStream(upstream, sse, tag);
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

const event = (json) => `data: ${JSON.stringify(json)}\r\n\r\n`;
const parts = (list, finishReason) => event({ candidates: [{ content: { role: "model", parts: list }, ...(finishReason ? { finishReason } : {}) }] });

describe("the answer that comes back", () => {
  it("streams thoughts, text and parallel calls, and hands back the signatures tagged for its instance", async () => {
    const { chunks } = await translate([
      parts([{ text: "look ", thought: true }, { text: "in a", thought: true }]),
      parts([{ text: "Looking." }]),
      parts([{ functionCall: { name: "read_file", args: { path: "a" } }, thoughtSignature: "sig-call" }, { functionCall: { name: "list_files", args: {} } }], "STOP"),
      event({ usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5, thoughtsTokenCount: 3 } }),
    ]);
    expect(chunks.map((c) => c.message?.thinking ?? "").join("")).toBe("look in a");
    expect(chunks.map((c) => c.message?.content ?? "").join("")).toBe("Looking.");
    const calls = chunks.flatMap((c) => c.message?.tool_calls ?? []);
    expect(calls.map((c) => [c.function.name, c.function.arguments])).toEqual([["read_file", { path: "a" }], ["list_files", {}]]);
    expect(chunks.find((c) => c.provider_state)?.provider_state).toEqual({ instanceId: "gemini", state: { calls: ["sig-call", ""], text: "" } });
    const last = chunks.at(-1);
    expect([last.done_reason, last.prompt_eval_count, last.eval_count]).toEqual(["tool_calls", 12, 8]);
  });

  it("reports MAX_TOKENS as length, and a safety stop as a refusal", async () => {
    expect((await translate([parts([{ text: "cut" }], "MAX_TOKENS")])).chunks.at(-1).done_reason).toBe("length");
    const { failure } = await translate([parts([{ text: "no" }], "SAFETY")]);
    expect(failure.failure.kind).toBe("provider-refused");
  });

  it("ends the turn when the model runs code Draggy never offered", async () => {
    const { failure } = await translate([parts([{ executableCode: { language: "PYTHON", code: "1" } }])]);
    expect(failure).toBeInstanceOf(gemini.HostedToolError);
  });

  it("answers once with the same fields and the signatures", () => {
    const answer = gemini.translateJson(
      { candidates: [{ content: { parts: [{ text: "Hi", thoughtSignature: "sig-text" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 } },
      { instanceId: "gemini" },
    );
    expect(answer).toMatchObject({ content: "Hi", finish: "stop", usage: { promptTokens: 3, outputTokens: 4 } });
    expect(answer.providerState).toEqual({ instanceId: "gemini", state: { calls: [], text: "sig-text" } });
  });
});

describe("the model listing", () => {
  it("asks with the key in a header and keeps only models that chat", () => {
    const request = gemini.modelsRequest(connection());
    expect(request.url).toBe("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000");
    expect(request.init.headers["x-goog-api-key"]).toBe("AIza-test");
    const listing = {
      models: [
        { name: "models/gemini-3-flash", inputTokenLimit: 1048576, supportedGenerationMethods: ["generateContent", "countTokens"] },
        { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
      ],
    };
    expect(gemini.parseModels(listing)).toEqual([{ id: "gemini-3-flash", contextLength: 1048576 }]);
  });
});
