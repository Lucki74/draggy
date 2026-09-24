/** Supertonic 3, the natural voice: a 99M-parameter flow-matching synthesiser that runs locally in
 * 31 languages at 44.1 kHz and takes inline expression tags such as <laugh>. Four ONNX graphs: a
 * duration predictor, a text encoder, a vector estimator run for a few denoising steps, and a
 * vocoder. Ported from Supertone's reference browser code, on typed arrays throughout.
 *
 * This file holds the arithmetic only; the ONNX runtime is passed in, so it can be tested without
 * one and run in a worker with one. */

/** Supertonic's languages that Draggy's interface also speaks. Chinese is the one it lacks. */
export const SUPERTONIC_LANGUAGES = new Set([
  "en", "fr", "es", "de", "it", "pt", "nl", "ru", "ja", "ko", "ar",
]);

export const SUPERTONIC_REPO = "Supertone/supertonic-3";
export const SUPERTONIC_FILES = {
  config: "onnx/tts.json",
  indexer: "onnx/unicode_indexer.json",
  durationPredictor: "onnx/duration_predictor.onnx",
  textEncoder: "onnx/text_encoder.onnx",
  vectorEstimator: "onnx/vector_estimator.onnx",
  vocoder: "onnx/vocoder.onnx",
  voice: (id: string) => `voice_styles/${id}.json`,
} as const;

export interface SupertonicConfig {
  ae: { sample_rate: number; base_chunk_size: number };
  ttl: { chunk_compress_factor: number; latent_dim: number };
}

export interface TensorLike {
  data: ArrayLike<number | bigint>;
  dims: readonly number[];
}

export type TensorFactory = (
  type: "float32" | "int64",
  data: Float32Array | BigInt64Array,
  dims: number[],
) => TensorLike;

export interface SessionLike {
  run: (feeds: Record<string, TensorLike>) => Promise<Record<string, TensorLike>>;
}

export interface SupertonicSessions {
  durationPredictor: SessionLike;
  textEncoder: SessionLike;
  vectorEstimator: SessionLike;
  vocoder: SessionLike;
}

export interface VoiceStyle {
  ttl: TensorLike;
  dp: TensorLike;
}

interface StyleJson {
  style_ttl: { dims: number[]; data: unknown };
  style_dp: { dims: number[]; data: unknown };
}

/** A voice style file as tensors. */
export function parseVoiceStyle(json: StyleJson, tensor: TensorFactory): VoiceStyle {
  const flat = (value: unknown) => Float32Array.from((value as number[]).flat(Infinity) as number[]);
  return {
    ttl: tensor("float32", flat(json.style_ttl.data), [...json.style_ttl.dims]),
    dp: tensor("float32", flat(json.style_dp.data), [...json.style_dp.dims]),
  };
}

const REPLACEMENTS: [string, string][] = [
  ["–", "-"], ["‑", "-"], ["—", "-"], ["_", " "],
  ["\u201C", '"'], ["\u201D", '"'], ["\u2018", "'"], ["\u2019", "'"], ["´", "'"], ["`", "'"],
  ["[", " "], ["]", " "], ["|", " "], ["/", " "], ["#", " "], ["→", " "], ["←", " "],
];

const EMOJI =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;

/** The reference normaliser, unchanged in behaviour: NFKD, emoji and odd symbols out, tidy
 * punctuation, a closing mark added, then wrapped in the language tag the model conditions on.
 * Angle brackets survive, so expression tags such as <laugh> reach the model. */
export function preprocessText(input: string, lang: string): string {
  let text = input.normalize("NFKD").replace(EMOJI, "");
  for (const [from, to] of REPLACEMENTS) text = text.replaceAll(from, to);
  text = text.replace(/[♥☆♡©\\]/g, "");
  text = text.replaceAll("@", " at ").replaceAll("e.g.,", "for example, ").replaceAll("i.e.,", "that is, ");
  text = text
    .replace(/ ,/g, ",")
    .replace(/ \./g, ".")
    .replace(/ !/g, "!")
    .replace(/ \?/g, "?")
    .replace(/ ;/g, ";")
    .replace(/ :/g, ":")
    .replace(/ '/g, "'");
  while (text.includes('""')) text = text.replace('""', '"');
  while (text.includes("''")) text = text.replace("''", "'");
  text = text.replace(/\s+/g, " ").trim();
  if (!/[.!?;:,'")\]}…。」』】〉》›»]$/.test(text)) text += ".";
  return `<${lang}>${text}</${lang}>`;
}

/** Character ids for one preprocessed text, through the model's code-point table. */
export function textToIds(text: string, indexer: readonly number[]): BigInt64Array {
  const ids = new BigInt64Array(text.length);
  for (let i = 0; i < text.length; i++) {
    // Per UTF-16 unit, as the reference does: the table is indexed by what codePointAt returns there.
    const code = text.codePointAt(i) ?? 0;
    ids[i] = BigInt(code < indexer.length ? indexer[code] : -1);
  }
  return ids;
}

/** Standard normal samples, Box-Muller, from a uniform source that can be seeded in tests. */
export function gaussian(count: number, random: () => number = Math.random): Float32Array {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 2) {
    const u1 = Math.max(1e-4, random());
    const u2 = random();
    const radius = Math.sqrt(-2 * Math.log(u1));
    out[i] = radius * Math.cos(2 * Math.PI * u2);
    if (i + 1 < count) out[i + 1] = radius * Math.sin(2 * Math.PI * u2);
  }
  return out;
}

/** Latent frames needed for `seconds` of audio. */
export function latentLength(seconds: number, config: SupertonicConfig): number {
  const chunk = config.ae.base_chunk_size * config.ttl.chunk_compress_factor;
  return Math.max(1, Math.ceil(Math.floor(seconds * config.ae.sample_rate) / chunk));
}

export interface SynthesisOptions {
  lang: string;
  steps: number;
  /** 1 is the model's own pace; the reference defaults to 1.05. */
  speed: number;
  random?: () => number;
}

/** One utterance to audio at the model's sample rate. */
export async function synthesize(
  text: string,
  style: VoiceStyle,
  parts: {
    sessions: SupertonicSessions;
    config: SupertonicConfig;
    indexer: readonly number[];
    tensor: TensorFactory;
  },
  options: SynthesisOptions,
): Promise<Float32Array> {
  const { sessions, config, indexer, tensor } = parts;
  const ids = textToIds(preprocessText(text, options.lang), indexer);
  const textIds = tensor("int64", ids, [1, ids.length]);
  const textMask = tensor("float32", new Float32Array(ids.length).fill(1), [1, 1, ids.length]);

  const { duration } = await sessions.durationPredictor.run({
    text_ids: textIds,
    style_dp: style.dp,
    text_mask: textMask,
  });
  const seconds = Number(duration.data[0]) / Math.max(0.1, options.speed);

  const { text_emb: textEmb } = await sessions.textEncoder.run({
    text_ids: textIds,
    style_ttl: style.ttl,
    text_mask: textMask,
  });

  const frames = latentLength(seconds, config);
  const channels = config.ttl.latent_dim * config.ttl.chunk_compress_factor;
  // Every frame is inside this single utterance, so the mask is all ones and the noise needs none.
  let latent = gaussian(channels * frames, options.random);
  const latentMask = tensor("float32", new Float32Array(frames).fill(1), [1, 1, frames]);
  const totalStep = tensor("float32", new Float32Array([options.steps]), [1]);

  for (let step = 0; step < options.steps; step++) {
    const { denoised_latent: denoised } = await sessions.vectorEstimator.run({
      noisy_latent: tensor("float32", latent, [1, channels, frames]),
      text_emb: textEmb,
      style_ttl: style.ttl,
      latent_mask: latentMask,
      text_mask: textMask,
      current_step: tensor("float32", new Float32Array([step]), [1]),
      total_step: totalStep,
    });
    latent = Float32Array.from(denoised.data as ArrayLike<number>);
  }

  const { wav_tts: wav } = await sessions.vocoder.run({
    latent: tensor("float32", latent, [1, channels, frames]),
  });
  // The vocoder pads to whole chunks; the predicted length is what was actually said.
  const samples = Math.min(wav.data.length, Math.floor(seconds * config.ae.sample_rate));
  return Float32Array.from(wav.data as ArrayLike<number>).subarray(0, samples);
}

/** Voices that ship with the open weights. */
export const SUPERTONIC_VOICES = [
  { id: "F1", gender: "Female" },
  { id: "F2", gender: "Female" },
  { id: "F3", gender: "Female" },
  { id: "F4", gender: "Female" },
  { id: "F5", gender: "Female" },
  { id: "M1", gender: "Male" },
  { id: "M2", gender: "Male" },
  { id: "M3", gender: "Male" },
  { id: "M4", gender: "Male" },
  { id: "M5", gender: "Male" },
] as const;
