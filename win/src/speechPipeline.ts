const SAMPLE_RATE = 16000;

/** The slice of transformers.js this file uses, so a test can stand in for the library. */
export interface SpeechLibrary {
  AutoTokenizer: { from_pretrained(model: string): Promise<unknown> };
  AutoProcessor: { from_pretrained(model: string): Promise<unknown> };
  WhisperFeatureExtractor: new (config: Record<string, unknown>) => unknown;
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
}

export type SpeechStage = "download" | "tokenizer" | "processor" | "warm-up" | "transcribe";

/** An error that names the step it came from, so the screen can say what broke. */
export class SpeechStageError extends Error {
  readonly stage: SpeechStage;

  constructor(stage: SpeechStage, cause: unknown) {
    super(`Speech recognition failed at ${stage}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.stage = stage;
    this.name = "SpeechStageError";
  }
}

export async function atStage<T>(stage: SpeechStage, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw error instanceof SpeechStageError ? error : new SpeechStageError(stage, error);
  }
}

async function loadProcessor(model: string, lib: SpeechLibrary): Promise<unknown> {
  try {
    return await lib.AutoProcessor.from_pretrained(model);
  } catch {
    if (model.includes("whisper")) {
      const extractor = new lib.WhisperFeatureExtractor({
        feature_size: 80,
        sampling_rate: SAMPLE_RATE,
        hop_length: 160,
        chunk_length: 30,
        n_fft: 400,
        n_samples: 480000,
        nb_max_frames: 3000,
      });
      (extractor as { feature_extractor?: unknown }).feature_extractor = extractor;
      return extractor;
    }
    // Moonshine takes the raw waveform, so a callable that wraps it is all the pipeline needs.
    const processor = async (audio: Float32Array) => ({
      input_values: new lib.Tensor("float32", audio, [1, audio.length]),
    });
    processor.feature_extractor = { config: { sampling_rate: SAMPLE_RATE } };
    return processor;
  }
}

/**
 * The pipeline loads the tokenizer and processor only for files it finds by an http range request,
 * which the draggy://models/ host never sees, so both come back missing and decoding hits null.
 * Both are loaded here by name instead.
 */
export async function completePipeline(
  instance: { tokenizer?: unknown; processor?: unknown },
  model: string,
  lib: SpeechLibrary,
): Promise<void> {
  if (!instance.tokenizer) {
    instance.tokenizer = await atStage("tokenizer", () => lib.AutoTokenizer.from_pretrained(model));
  }
  if (!instance.processor) {
    instance.processor = await atStage("processor", () => loadProcessor(model, lib));
  }
}
