import { describe, expect, it } from "vitest";
import {
  SUPERTONIC_LANGUAGES,
  gaussian,
  latentLength,
  parseVoiceStyle,
  preprocessText,
  synthesize,
  textToIds,
} from "../voice/supertonic";
import type { SessionLike, TensorFactory, TensorLike } from "../voice/supertonic";
import { isNeuralVoiceAvailable, resolveNeuralVoice } from "../voice/neuralVoice";
import { LIVE_SPEECH_MODEL, SPEECH_MODEL, speechModelFor } from "../speech";

const tensor: TensorFactory = (type, data, dims) => ({ type, data, dims }) as TensorLike;
const config = {
  ae: { sample_rate: 44100, base_chunk_size: 512 },
  ttl: { chunk_compress_factor: 6, latent_dim: 24 },
};

describe("Supertonic text", () => {
  it("wraps text in its language and closes the sentence", () => {
    expect(preprocessText("Bonjour à tous", "fr")).toBe("<fr>Bonjour a\u0300 tous.</fr>");
    expect(preprocessText("Really?", "en")).toBe("<en>Really?</en>");
  });

  it("keeps expression tags and tidies punctuation like the reference", () => {
    expect(preprocessText("Oh <laugh> that's great !", "en")).toBe("<en>Oh <laugh> that's great!</en>");
    expect(preprocessText("It’s [really] — fine 😀", "en")).toBe("<en>It's really - fine.</en>");
  });

  it("maps characters through the model's table, unknown ones to -1", () => {
    const indexer = Array.from({ length: 128 }, (_, code) => code + 1000);
    expect([...textToIds("ab", indexer)]).toEqual([1097n, 1098n]);
    expect([...textToIds("é", indexer)]).toEqual([-1n]);
  });
});

describe("Supertonic synthesis", () => {
  function fakeSessions(seconds: number) {
    const calls: Record<string, Record<string, TensorLike>[]> = {};
    const session = (name: string, reply: (feeds: Record<string, TensorLike>) => Record<string, TensorLike>): SessionLike => ({
      run: async (feeds) => {
        (calls[name] ??= []).push(feeds);
        return reply(feeds);
      },
    });
    return {
      calls,
      sessions: {
        durationPredictor: session("dp", () => ({ duration: tensor("float32", new Float32Array([seconds]), [1]) })),
        textEncoder: session("te", () => ({ text_emb: tensor("float32", new Float32Array(8), [1, 8]) })),
        vectorEstimator: session("ve", (feeds) => ({ denoised_latent: feeds.noisy_latent })),
        vocoder: session("vo", (feeds) => {
          const frames = feeds.latent.dims[2];
          return { wav_tts: tensor("float32", new Float32Array(frames * 512 * 6).fill(0.5), [1, frames * 512 * 6]) };
        }),
      },
    };
  }
  const style = parseVoiceStyle(
    { style_ttl: { dims: [1, 2, 2], data: [[[1, 2], [3, 4]]] }, style_dp: { dims: [1, 1, 2], data: [[[5, 6]]] } },
    tensor,
  );

  it("runs the four graphs with the reference's inputs, one estimator pass per step", async () => {
    const { calls, sessions } = fakeSessions(1);
    const indexer = Array.from({ length: 256 }, (_, i) => i);
    const audio = await synthesize("Hi.", style, { sessions, config, indexer, tensor }, { lang: "en", steps: 5, speed: 1 });

    expect(Object.keys(calls.dp[0]).sort()).toEqual(["style_dp", "text_ids", "text_mask"]);
    expect(calls.dp[0].text_ids.dims).toEqual([1, "<en>Hi.</en>".length]);
    expect(calls.ve.length).toBe(5);
    expect(Object.keys(calls.ve[0]).sort()).toEqual(
      ["current_step", "latent_mask", "noisy_latent", "style_ttl", "text_emb", "text_mask", "total_step"],
    );
    expect([...calls.ve.map((feeds) => Number(feeds.current_step.data[0]))]).toEqual([0, 1, 2, 3, 4]);
    expect(calls.ve[0].noisy_latent.dims).toEqual([1, 144, latentLength(1, config)]);
    // Trimmed to the predicted length, not the vocoder's padded chunks.
    expect(audio.length).toBe(44100);
    expect(style.ttl.data).toEqual(Float32Array.from([1, 2, 3, 4]));
  });

  it("speeds up by shortening the predicted duration", async () => {
    const { sessions } = fakeSessions(2);
    const indexer = Array.from({ length: 256 }, (_, i) => i);
    const audio = await synthesize("Hi.", style, { sessions, config, indexer, tensor }, { lang: "en", steps: 1, speed: 2 });
    expect(audio.length).toBe(44100);
  });

  it("draws unit-variance noise", () => {
    let seed = 1;
    const values = gaussian(20000, () => ((seed = (seed * 16807) % 2147483647) / 2147483647));
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(Math.abs(variance - 1)).toBeLessThan(0.05);
  });
});

describe("voice and recogniser choice", () => {
  it("speaks every interface language but Chinese", () => {
    for (const lang of ["en", "fr", "es", "de", "it", "pt", "nl", "ru", "ja", "ko", "ar"]) {
      expect(isNeuralVoiceAvailable(lang)).toBe(true);
    }
    expect(isNeuralVoiceAvailable("zh")).toBe(false);
    expect(SUPERTONIC_LANGUAGES.size).toBe(11);
  });

  it("carries a saved Kokoro voice over by gender", () => {
    expect(resolveNeuralVoice("F3")).toBe("F3");
    expect(resolveNeuralVoice("af_heart")).toBe("F1");
    expect(resolveNeuralVoice("bm_george")).toBe("M1");
    expect(resolveNeuralVoice("")).toBe("F1");
  });

  it("uses the live-speech recogniser for English conversations only", () => {
    expect(speechModelFor("en")).toBe(LIVE_SPEECH_MODEL);
    expect(speechModelFor("fr")).toBe(SPEECH_MODEL);
    expect(speechModelFor(null)).toBe(SPEECH_MODEL);
  });
});
