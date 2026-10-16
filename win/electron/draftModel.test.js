import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const draftModel = require("./draftModel.cjs");

describe("the draft model beside a main model", () => {
  it("is named after the model with -draft suffix", () => {
    expect(draftModel.draftCompanionName("qwen-7b-Q4_K_M.gguf")).toBe("qwen-7b-Q4_K_M-draft.gguf");
    expect(draftModel.draftCompanionName("llama-8b-Q4_K_M.gguf")).toBe("llama-8b-Q4_K_M-draft.gguf");
  });

  it("drops the part counter of a split model", () => {
    expect(draftModel.draftCompanionName("big-Q4_K_M-00001-of-00004.gguf")).toBe("big-Q4_K_M-draft.gguf");
  });

  it("recognises draft companion files so they are not listed as main models", () => {
    expect(draftModel.isCompanionDraft("qwen-7b-Q4_K_M-draft.gguf")).toBe(true);
    expect(draftModel.isCompanionDraft("qwen-7b-Q4_K_M.gguf")).toBe(false);
  });

  it("finds companion draft only when present on disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-draft-"));
    try {
      fs.writeFileSync(path.join(dir, "a.gguf"), "x");
      expect(draftModel.findCompanionDraft(dir, "a.gguf")).toBeNull();

      fs.writeFileSync(path.join(dir, "a-draft.gguf"), "x");
      expect(draftModel.findCompanionDraft(dir, "a.gguf")).toBe(path.join(dir, "a-draft.gguf"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is not offered again once refused until replaced", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-draft-"));
    try {
      const draft = path.join(dir, "a-draft.gguf");
      fs.writeFileSync(draft, "x");
      expect(draftModel.findCompanionDraft(dir, "a.gguf")).toBe(draft);

      draftModel.markRefused(draft);
      expect(draftModel.findCompanionDraft(dir, "a.gguf")).toBeNull();
      expect(draftModel.wasRefused(dir, "a.gguf")).toBe(true);

      // Replacing file allows re-trying.
      fs.writeFileSync(draft, "new draft file");
      expect(draftModel.findCompanionDraft(dir, "a.gguf")).toBe(draft);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
