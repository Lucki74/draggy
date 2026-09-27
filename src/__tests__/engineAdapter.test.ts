import { describe, expect, it } from "vitest";
import { isGgufModel, ggufModelName } from "../ai/engineAdapter";

describe("engineAdapter", () => {
  describe("isGgufModel", () => {
    it("recognizes gguf extensions and prefixes", () => {
      expect(isGgufModel("qwen2.5-coder.gguf")).toBe(true);
      expect(isGgufModel("QWEN2.5.GGUF")).toBe(true);
      expect(isGgufModel("gguf:llama3.1-8b")).toBe(true);
      expect(isGgufModel("gguf:models/deepseek-r1.gguf")).toBe(true);
    });

    it("rejects tag-style model names", () => {
      expect(isGgufModel("llama3:8b")).toBe(false);
      expect(isGgufModel("deepseek-r1:7b")).toBe(false);
      expect(isGgufModel("")).toBe(false);
    });
  });

  describe("ggufModelName", () => {
    it("strips gguf: prefix if present", () => {
      expect(ggufModelName("gguf:mistral-7b.gguf")).toBe("mistral-7b.gguf");
      expect(ggufModelName("gguf:custom-model")).toBe("custom-model");
      expect(ggufModelName("plain-model.gguf")).toBe("plain-model.gguf");
    });
  });
});
