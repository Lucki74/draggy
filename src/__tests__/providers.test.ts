import { describe, expect, it } from "vitest";
import { chatEndpoint, isRemote, parseRef, providerOf } from "../ai/providers";

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
