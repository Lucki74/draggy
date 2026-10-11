import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const { classifyFailure, watchEngineLine } = createRequire(import.meta.url)("./llamaProcess.cjs");

describe("classifyFailure", () => {
  it.each([
    [["ggml_cuda_init: failed", "CUDA error: out of memory"], "out-of-vram"],
    [["terminate called after throwing std::bad_alloc"], "out-of-ram"],
    [["couldn't bind HTTP server socket, address already in use"], "port-in-use"],
    [["llama_model_load: error loading model architecture: unknown model architecture: 'foo'"], "unsupported-architecture"],
    [["gguf_init_from_file: invalid magic characters"], "corrupt-gguf"],
    [["something nobody has seen"], "unknown"],
    [["slot release: id  0 | task 0 | stop processing: n_tokens = 22, truncated = 0"], "unknown"],
  ])("names %j as %s", (lines, cause) => {
    expect(classifyFailure(lines)).toBe(cause);
  });
});

describe("watchEngineLine", () => {
  it("logs how much of the last prompt the slot kept", () => {
    const calls = [];
    const logger = { debug: (...args) => calls.push(args), warn() {}, info() {} };
    watchEngineLine(
      "slot get_availabl: id  0 | task -1 | selected slot by LCP similarity, f_sim_best = 0.778 (> 0.100 thold), f_keep = 0.636",
      { modelPath: "m.gguf", userDataDir: null, drafting: false, logger, moe: false },
    );

    expect(calls).toEqual([["engine.llama", "prompt cache reused", { how: "LCP similarity", similarity: 0.778, kept: 0.636 }]]);
  });
});
