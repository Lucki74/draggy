import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { sseToLlamaChunks } from "../../../src/ai/llamaStream";

const require = createRequire(import.meta.url);
const ollama = require("./ollama.cjs");
const { createSse } = require("../sse.cjs");

const CONNECTION = { baseUrl: "http://127.0.0.1:11434", apiKey: "", headers: {} };
const payloadOf = (request) => JSON.parse(request.init.body);

describe("the request Ollama gets", () => {
  const body = {
    model: "@ollama/qwen3:8b",
    stream: true,
    think: false,
    options: { num_ctx: 16384, num_predict: -1 },
    messages: [
      { role: "user", content: [{ type: "text", text: "what is this?" }, { type: "image_url", image_url: { url: "data:image/png;base64,iVBOR" } }], draggy_ref: { id: "u1", hash: "h" } },
      { role: "assistant", content: " ", tool_calls: [{ type: "function", function: { name: "read_file", arguments: '{"path":"a"}' } }] },
      { role: "tool", content: "42", tool_name: "read_file", tool_call_id: "x" },
    ],
    tools: [{ type: "function", function: { name: "read_file", parameters: {} } }, { type: "web_search" }],
  };

  it("uses the native endpoint, keeps the context size and the thinking switch", () => {
    const request = ollama.buildRequest(body, CONNECTION, "qwen3:8b");
    expect(request.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(payloadOf(request)).toMatchObject({ model: "qwen3:8b", stream: true, think: false, options: { num_ctx: 16384 } });
    expect(payloadOf(request).options.num_predict).toBeUndefined();
  });

  it("sends images as bare base64, tool calls with object arguments, and only function tools", () => {
    const { messages, tools } = payloadOf(ollama.buildRequest(body, CONNECTION, "qwen3:8b"));
    expect(messages[0]).toEqual({ role: "user", content: "what is this?", images: ["iVBOR"] });
    expect(messages[1].tool_calls).toEqual([{ function: { name: "read_file", arguments: { path: "a" } } }]);
    expect(messages[2]).toEqual({ role: "tool", content: "42", tool_name: "read_file" });
    expect(tools.map((tool) => tool.function.name)).toEqual(["read_file"]);
    expect(JSON.stringify(payloadOf(ollama.buildRequest(body, CONNECTION, "qwen3:8b")))).not.toContain("draggy_ref");
  });
});

async function translate(lines) {
  const encoder = new TextEncoder();
  const upstream = new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  const out = new ReadableStream({
    async start(controller) {
      const sse = createSse(controller);
      try {
        await ollama.translateStream(upstream, sse);
      } catch (error) {
        sse.error(error.failure);
      }
      sse.done();
    },
  });
  const chunks = [];
  for await (const chunk of sseToLlamaChunks(out.getReader())) chunks.push(chunk);
  return chunks;
}

const line = (json) => `${JSON.stringify(json)}\n`;

describe("the answer Ollama streams", () => {
  it("passes text and thinking, and ends with its counts", async () => {
    const chunks = await translate([
      line({ message: { role: "assistant", content: "", thinking: "hmm" }, done: false }),
      line({ message: { role: "assistant", content: "Hi" }, done: false }),
      line({ message: { role: "assistant", content: "" }, done: true, done_reason: "stop", prompt_eval_count: 7, eval_count: 3 }),
    ]);
    expect(chunks.map((c) => c.message?.content ?? "").join("")).toBe("Hi");
    expect(chunks.map((c) => c.message?.thinking ?? "").join("")).toBe("hmm");
    expect(chunks.find((c) => c.done)).toMatchObject({ done_reason: "stop", prompt_eval_count: 7, eval_count: 3 });
  });

  it("numbers whole tool calls and finishes as a tool call", async () => {
    const chunks = await translate([
      line({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "read_file", arguments: { path: "a" } } }, { function: { name: "list_dir", arguments: {} } }] }, done: false }),
      line({ message: { role: "assistant", content: "" }, done: true, done_reason: "stop" }),
    ]);
    expect(chunks.flatMap((c) => c.message?.tool_calls ?? [])).toEqual([
      { id: "call_0", function: { name: "read_file", arguments: { path: "a" } } },
      { id: "call_1", function: { name: "list_dir", arguments: {} } },
    ]);
    expect(chunks.find((c) => c.done)?.done_reason).toBe("tool_calls");
  });

  it("keeps a length stop, even split across reads", async () => {
    const text = line({ message: { content: "cut" }, done: true, done_reason: "length" });
    const chunks = await translate([text.slice(0, 10), text.slice(10)]);
    expect(chunks.find((c) => c.done)?.done_reason).toBe("length");
  });

  it("names an error Ollama reports mid-stream", async () => {
    const chunks = await translate([line({ error: 'model "nope" not found, try pulling it first' })]);
    expect(chunks.find((c) => c.error)?.error.kind).toBe("provider-model-not-found");
  });
});

describe("Ollama's models", () => {
  it("marks the ones served from Ollama's cloud", () => {
    expect(ollama.parseModels({ models: [{ name: "llama3.2:3b" }, { name: "gpt-oss:120b-cloud" }, { name: "kimi:cloud" }] }).map((m) => m.cloud)).toEqual([false, true, true]);
  });

  it("reads capabilities and the window from /api/show", () => {
    expect(ollama.parseShow({ capabilities: ["completion", "tools", "vision"], model_info: { "gemma3.context_length": 131072 } })).toEqual({ capabilities: ["tools", "vision"], contextLength: 131072 });
  });
});
