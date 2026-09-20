import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const mmproj = require("./mmproj.cjs");

describe("the projector beside a vision model", () => {
  it("is named after the model, so two repositories' mmproj-F16.gguf cannot collide", () => {
    expect(mmproj.companionName("gemma-4-12b-it-Q4_K_M.gguf")).toBe("gemma-4-12b-it-Q4_K_M-mmproj.gguf");
    expect(mmproj.companionName("qwen-Q4_K_M.gguf")).toBe("qwen-Q4_K_M-mmproj.gguf");
  });

  it("drops the part counter of a split model", () => {
    expect(mmproj.companionName("big-Q4_K_M-00001-of-00004.gguf")).toBe("big-Q4_K_M-mmproj.gguf");
  });

  it("recognises projector files so they are never listed as models", () => {
    expect(mmproj.isCompanionFile("gemma-4-12b-it-Q4_K_M-mmproj.gguf")).toBe(true);
    expect(mmproj.isCompanionFile("mmproj-F16.gguf")).toBe(true);
    expect(mmproj.isCompanionFile("gemma-4-12b-it-Q4_K_M.gguf")).toBe(false);
  });

  it("finds it only when it is there", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-mmproj-"));
    try {
      fs.writeFileSync(path.join(dir, "a.gguf"), "x");
      expect(mmproj.findCompanion(dir, "a.gguf")).toBeNull();

      fs.writeFileSync(path.join(dir, "a-mmproj.gguf"), "x");
      expect(mmproj.findCompanion(dir, "a.gguf")).toBe(path.join(dir, "a-mmproj.gguf"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
