import { describe, expect, it, vi } from "vitest";
import { SpeechStageError, atStage, completePipeline, type SpeechLibrary } from "../speechPipeline";

// The app serves models from draggy://models/, where transformers.js cannot find the tokenizer by
// itself, so every transcription died decoding with a null tokenizer.

const library = (over: Partial<SpeechLibrary> = {}): SpeechLibrary => ({
  AutoTokenizer: { from_pretrained: vi.fn(async () => "tokenizer") },
  AutoProcessor: { from_pretrained: vi.fn(async () => "processor") },
  WhisperFeatureExtractor: class {} as unknown as SpeechLibrary["WhisperFeatureExtractor"],
  Tensor: class {} as unknown as SpeechLibrary["Tensor"],
  ...over,
});

describe("completing a pipeline the library left without parts", () => {
  it("loads the tokenizer and processor the pipeline came back without", async () => {
    const lib = library();
    const instance: { tokenizer?: unknown; processor?: unknown } = {};

    await completePipeline(instance, "onnx-community/moonshine-base-ONNX", lib);

    expect(instance.tokenizer).toBe("tokenizer");
    expect(instance.processor).toBe("processor");
    expect(lib.AutoTokenizer.from_pretrained).toHaveBeenCalledWith("onnx-community/moonshine-base-ONNX");
  });

  it("leaves parts the pipeline already has alone", async () => {
    const lib = library();
    const instance = { tokenizer: "own", processor: "own" };

    await completePipeline(instance, "onnx-community/whisper-base", lib);

    expect(instance).toEqual({ tokenizer: "own", processor: "own" });
    expect(lib.AutoTokenizer.from_pretrained).not.toHaveBeenCalled();
    expect(lib.AutoProcessor.from_pretrained).not.toHaveBeenCalled();
  });

  it("falls back to a built processor when the model has no preprocessor file", async () => {
    const lib = library({
      AutoProcessor: { from_pretrained: vi.fn(async () => Promise.reject(new Error("404"))) },
    });
    const instance: { tokenizer?: unknown; processor?: unknown } = {};

    await completePipeline(instance, "onnx-community/moonshine-base-ONNX", lib);

    expect(typeof instance.processor).toBe("function");
  });
});

describe("naming the step that failed", () => {
  it("says the tokenizer could not load, not just that something was null", async () => {
    const lib = library({
      AutoTokenizer: { from_pretrained: vi.fn(async () => Promise.reject(new Error("no tokenizer.json"))) },
    });

    const failure = await completePipeline({}, "m", lib).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SpeechStageError);
    expect((failure as SpeechStageError).stage).toBe("tokenizer");
    expect((failure as Error).message).toBe("Speech recognition failed at tokenizer: no tokenizer.json");
  });

  it("keeps the first stage when a step is wrapped twice", async () => {
    const failure = await atStage("transcribe", () => atStage("warm-up", () => Promise.reject(new Error("boom")))).catch(
      (error: unknown) => error,
    );

    expect((failure as SpeechStageError).stage).toBe("warm-up");
  });
});
