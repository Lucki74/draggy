import { describe, expect, it, vi } from "vitest";
import { isGgufModel, ggufModelName, streamGgufTurn } from "../ai/engineAdapter";

describe("engineAdapter", () => {
  describe("isGgufModel", () => {
    it("recognizes gguf extensions and prefixes", () => {
      expect(isGgufModel("qwen2.5-coder.gguf")).toBe(true);
      expect(isGgufModel("QWEN2.5.GGUF")).toBe(true);
      expect(isGgufModel("gguf:llama3.1-8b")).toBe(true);
      expect(isGgufModel("gguf:models/deepseek-r1.gguf")).toBe(true);
    });

    it("rejects non-gguf Ollama models", () => {
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

  describe("streamGgufTurn", () => {
    it("streams turn chunks from SSE responses", async () => {
      const sseBody = [
        'data: {"choices":[{"delta":{"role":"assistant","content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5},"timings":{"predicted_per_second":40.0}}\n\n',
        "data: [DONE]\n\n",
      ].join("");

      const encoder = new TextEncoder();
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sseBody));
          controller.close();
        },
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: mockStream,
      }) as unknown as typeof fetch;

      try {
        const received: string[] = [];
        await streamGgufTurn(
          {
            model: "gguf:tiny.gguf",
            messages: [{ role: "user", content: "Hi" }],
          },
          (chunk) => {
            if (chunk.content) received.push(chunk.content);
          }
        );

        expect(received.join("")).toBe("Hello world");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("throws error when response is not ok", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }) as unknown as typeof fetch;

      try {
        await expect(
          streamGgufTurn(
            {
              model: "gguf:tiny.gguf",
              messages: [{ role: "user", content: "Hi" }],
            },
            () => {}
          )
        ).rejects.toThrow("GGUF engine returned HTTP 500");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
