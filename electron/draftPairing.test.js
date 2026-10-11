import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const draftPairing = require("./draftPairing.cjs");
const ggufParser = require("./ggufParser.cjs");

const GB = 1024 ** 3;

describe("draftPairing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    draftPairing.resetForTests();
  });

  it("pairs a model with the draft that shares its tokenizer", () => {
    expect(draftPairing.familyDraftFor({ architecture: "llama", vocabSize: 128256 }).family).toBe("llama3");
    expect(draftPairing.familyDraftFor({ architecture: "qwen2", vocabSize: 152064 }).family).toBe("qwen2");
    expect(draftPairing.familyDraftFor({ architecture: "qwen3moe", vocabSize: 151936 }).family).toBe("qwen3");
    expect(draftPairing.familyDraftFor({ architecture: "qwen35", vocabSize: 248320 }).family).toBe("qwen3.5");
    // Mistral is a llama architecture with another vocabulary: no shared draft.
    expect(draftPairing.familyDraftFor({ architecture: "llama", vocabSize: 131072 })).toBeNull();
    expect(draftPairing.familyDraftFor({ architecture: "phi3", vocabSize: 100352 })).toBeNull();
  });

  it("skips models that would not gain from a draft", () => {
    expect(draftPairing.skipReason({ mtp: true }, 10 * GB)).toMatch(/MTP/);
    expect(draftPairing.skipReason({ expertCount: 128 }, 20 * GB)).toMatch(/experts/);
    expect(draftPairing.skipReason({}, 1 * GB)).toMatch(/small/);
    expect(draftPairing.skipReason({}, 5 * GB)).toBeNull();
  });

  it("downloads the family draft beside the model once", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-pair-"));
    const model = path.join(dir, "Llama-3.1-8B-Q4_K_M.gguf");
    fs.writeFileSync(model, "x");
    const realStat = fs.statSync;
    vi.spyOn(fs, "statSync").mockImplementation((file, ...rest) =>
      file === model ? { size: 5 * GB, mtimeMs: 0 } : realStat(file, ...rest),
    );
    vi.spyOn(ggufParser, "parseGgufHeader").mockReturnValue({ architecture: "llama", vocabSize: 128256, expertCount: 0 });
    const download = vi.fn().mockResolvedValue({ success: true });
    try {
      const plan = await draftPairing.ensureFamilyDraft(model, { download });
      expect(plan.family).toBe("llama3");
      expect(download).toHaveBeenCalledWith({
        url: expect.stringContaining("Llama-3.2-1B-Instruct"),
        modelsDir: dir,
        filename: "Llama-3.1-8B-Q4_K_M-draft.gguf",
      });
      expect(await draftPairing.ensureFamilyDraft(model, { download })).toBeNull();
      expect(download).toHaveBeenCalledTimes(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
