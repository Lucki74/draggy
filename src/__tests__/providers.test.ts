import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chatEndpoint, draggyRef, isRemote, parseRef, providerOf, scopeToTarget } from "../ai/providers";
import { toLlamaMessages } from "../ai/llamaStream";

describe("model references", () => {
  it("reads every saved GGUF name as the built-in engine, with or without its prefix", () => {
    expect(parseRef("Qwen3.5-9B-Q4_K_M.gguf")).toEqual({ kind: "builtin", file: "Qwen3.5-9B-Q4_K_M.gguf" });
    expect(parseRef("gguf:Qwen3.5-9B-Q4_K_M.gguf")).toEqual({ kind: "builtin", file: "Qwen3.5-9B-Q4_K_M.gguf" });
    expect(parseRef("")).toEqual({ kind: "builtin", file: "" });
    expect(isRemote("Qwen3.5-9B-Q4_K_M.gguf")).toBe(false);
    for (const name of ["qwen3:8b", "llama3.2", "gemma3:27b", "gpt-oss:cloud", "cloudy-llm:7b"]) {
      expect(isRemote(name), name).toBe(false);
    }
  });

  it("splits a remote reference at the first slash only", () => {
    expect(parseRef("@anthropic/claude-x")).toEqual({ kind: "remote", instanceId: "anthropic", modelId: "claude-x", valid: true });
    expect(parseRef("@ollama/llama3.2:3b")).toMatchObject({ instanceId: "ollama", modelId: "llama3.2:3b" });
    expect(parseRef("@openrouter/google/gemini-x")).toMatchObject({ instanceId: "openrouter", modelId: "google/gemini-x" });
    expect(providerOf("@chatgpt/gpt-x")).toBe("chatgpt");
    expect(providerOf("model.gguf")).toBeNull();
  });

  it("keeps a malformed remote reference away from the engine, marked invalid", () => {
    for (const name of ["@", "@anthropic", "@/claude-x", "@anthropic/"]) {
      expect(isRemote(name), name).toBe(true);
      expect(parseRef(name), name).toMatchObject({ valid: false });
    }
  });

  it("sends every model to the one gateway", () => {
    expect(chatEndpoint("model.gguf")).toBe("draggy-ai://chat");
    expect(chatEndpoint("@anthropic/claude-x")).toBe("draggy-ai://chat");
  });
});

/** Every renderer source file, tests aside. */
function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sources(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("the one way to a model", () => {
  it("never calls the engine's port directly from the renderer", () => {
    const direct = sources(path.join(__dirname, "..")).filter((file) => fs.readFileSync(file, "utf8").includes("127.0.0.1:11435"));
    expect(direct).toEqual([]);
  });
});

describe("a provider's state, sent only to the instance that wrote it", () => {
  const anthropic = { instanceId: "anthropic", state: { signature: "a1" } };
  const openai = { instanceId: "openai", state: { reasoning: "o1" } };
  // Anthropic, then OpenAI, then back to Anthropic.
  const history = [
    { role: "user", content: "one" },
    { role: "assistant", content: "two", provider_state: anthropic },
    { role: "user", content: "three" },
    { role: "assistant", content: "four", provider_state: openai },
    { role: "user", content: "five" },
  ];

  it("sends the older Anthropic states again on the way back, and none of them to OpenAI", () => {
    expect(scopeToTarget(history, "@anthropic/claude-x").map((m) => m.provider_state)).toEqual([
      undefined, anthropic, undefined, undefined, undefined,
    ]);
    expect(scopeToTarget(history, "@openai/gpt-x").map((m) => m.provider_state)).toEqual([
      undefined, undefined, undefined, openai, undefined,
    ]);
  });

  it("gives the built-in engine the same body it got before providers existed", () => {
    const bare = history.map(({ role, content }) => ({ role, content }));
    expect(JSON.stringify(toLlamaMessages(history, "Qwen3.5-9B-Q4_K_M.gguf"))).toBe(JSON.stringify(toLlamaMessages(bare)));
    expect(JSON.stringify(toLlamaMessages(history))).toBe(JSON.stringify(toLlamaMessages(bare)));
  });

  it("keeps the rest of each message as it was", () => {
    expect(scopeToTarget(history, "@openai/gpt-x")[1]).toEqual({ role: "assistant", content: "two" });
    expect(scopeToTarget(history, "@anthropic/claude-x")[0]).toBe(history[0]);
  });
});

describe("each stored message's reference", () => {
  const message = { id: "m1", role: "user" as const, content: "hello", attachments: [{ name: "a.txt", type: "text/plain", content: "x" }] };

  it("is a SHA-256 over the stored role, content and attachments", async () => {
    const ref = await draggyRef(message);
    expect(ref.id).toBe("m1");
    expect(ref.hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await draggyRef({ ...message })).hash).toBe(ref.hash);
    expect((await draggyRef({ ...message, content: "hello!" })).hash).not.toBe(ref.hash);
    expect((await draggyRef({ ...message, role: "assistant" })).hash).not.toBe(ref.hash);
    expect((await draggyRef({ ...message, attachments: [] })).hash).not.toBe(ref.hash);
  });

  it("never reaches the built-in engine, and reaches every provider", () => {
    const wire = [{ role: "user", content: "hi", draggy_ref: { id: "m1", hash: "h" } }];
    expect(toLlamaMessages(wire, "Qwen3.5-9B-Q4_K_M.gguf")).toEqual([{ role: "user", content: "hi" }]);
    expect(toLlamaMessages(wire, "@codex/gpt-x")).toEqual(wire);
  });
});
