import { describe, expect, it } from "vitest";
import { LIVE_SPEECH_MODEL, SPEECH_MODEL, speechModelFor } from "../speech";
import { WhisperFeatureExtractor } from "@huggingface/transformers";

describe("speech recognition configuration", () => {
  it("selects Moonshine for English and Whisper for other languages or dictation", () => {
    expect(speechModelFor("en")).toBe(LIVE_SPEECH_MODEL);
    expect(speechModelFor("fr")).toBe(SPEECH_MODEL);
    expect(speechModelFor("es")).toBe(SPEECH_MODEL);
    expect(speechModelFor(null)).toBe(SPEECH_MODEL);
    expect(speechModelFor(undefined)).toBe(SPEECH_MODEL);
  });

  it("extracts input_features matching Whisper dimensions", async () => {
    const extractor = new WhisperFeatureExtractor({
      feature_size: 80,
      sampling_rate: 16000,
      hop_length: 160,
      chunk_length: 30,
      n_fft: 400,
      n_samples: 480000,
      nb_max_frames: 3000,
    });
    const sampleAudio = new Float32Array(16000);
    const result = await extractor(sampleAudio);
    expect(result).toHaveProperty("input_features");
    expect(result.input_features.dims).toEqual([1, 80, 3000]);
  });
});
