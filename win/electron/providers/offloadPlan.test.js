import { describe, expect, it, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const offload = require("./offloadPlan.cjs");
const ollama = require("./adapters/ollama.cjs");
const GB = 1024 ** 3;

describe("planNumGpu", () => {
  it("leaves a model that fits to Ollama", () => {
    expect(offload.planNumGpu({ modelBytes: 4 * GB, layers: 33, vramGB: 12 })).toBeNull();
  });

  it("offloads a share of the layers with headroom for one that does not", () => {
    // 40 GB model, 80 layers, 16 GB card: 14.5 usable
    expect(offload.planNumGpu({ modelBytes: 40 * GB, layers: 81, vramGB: 16 })).toBe(29);
  });

  it("is unknown without sizes", () => {
    expect(offload.planNumGpu({ layers: 81, vramGB: 16 })).toBeNull();
    expect(offload.planNumGpu({ modelBytes: 40 * GB, layers: 81, vramGB: 0 })).toBeNull();
  });
});

describe("ollama request options", () => {
  beforeEach(() => offload.reset());
  const connection = { baseUrl: "http://127.0.0.1:11434", headers: {} };

  it("sends the planned num_gpu for a local model that spills", () => {
    offload.setVram(16);
    offload.rememberTags({ models: [{ name: "big:70b", size: 40 * GB }] });
    offload.rememberShow("big:70b", { model_info: { "llama.block_count": 80 } });
    const { init } = ollama.buildRequest({ messages: [] }, connection, "big:70b");
    expect(JSON.parse(init.body).options.num_gpu).toBe(29);
  });

  it("keeps a caller's own num_gpu", () => {
    offload.setVram(16);
    const { init } = ollama.buildRequest({ messages: [], options: { num_gpu: 10 } }, connection, "big:70b");
    expect(JSON.parse(init.body).options.num_gpu).toBe(10);
  });

  it("never plans for a remote host", () => {
    offload.setVram(16);
    offload.rememberTags({ models: [{ name: "big:70b", size: 40 * GB }] });
    offload.rememberShow("big:70b", { model_info: { "llama.block_count": 80 } });
    const { init } = ollama.buildRequest({ messages: [] }, { baseUrl: "http://10.0.0.5:11434", headers: {} }, "big:70b");
    expect(JSON.parse(init.body).options).toBeUndefined();
  });
});
