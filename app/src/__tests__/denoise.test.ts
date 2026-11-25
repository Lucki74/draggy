import { describe, expect, it } from "vitest";
import { loadRnnoiseWasm } from "../../scripts/rnnoiseWasm";
import {
  DENOISE_FRAME,
  DENOISE_RATE,
  createDecimator,
  createDenoiser,
} from "../voice/denoise";

const module = new WebAssembly.Module(loadRnnoiseWasm());

/** Deterministic noise, so a failure reproduces. */
function noise(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32 - 0.5;
  };
}

const rms = (samples: Float32Array) =>
  Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
const db = (ratio: number) => 20 * Math.log10(ratio);

/** Runs `seconds` of signal through RNNoise and returns what came out. */
function denoise(make: (i: number) => number, seconds: number) {
  const denoiser = createDenoiser(module);
  const total = Math.floor((seconds * DENOISE_RATE) / DENOISE_FRAME) * DENOISE_FRAME;
  const input = new Float32Array(total);
  for (let i = 0; i < total; i++) input[i] = make(i);
  const output = new Float32Array(total);
  const voices: number[] = [];
  for (let at = 0; at < total; at += DENOISE_FRAME) {
    const frame = input.slice(at, at + DENOISE_FRAME);
    voices.push(denoiser.process(frame));
    output.set(frame, at);
  }
  denoiser.dispose();
  return { input, output, voices };
}

describe("RNNoise", () => {
  it("removes steady background noise", () => {
    const next = noise(7);
    const { input, output, voices } = denoise(() => next() * 0.06, 3);
    // Judged after the first second, once the network has settled on the noise floor.
    const tail = (samples: Float32Array) => samples.subarray(DENOISE_RATE);
    expect(db(rms(tail(output)) / rms(tail(input)))).toBeLessThan(-15);
    expect(Math.max(...voices.slice(100))).toBeLessThan(0.5);
  });

  it("keeps a voiced sound while removing the noise under it", () => {
    const next = noise(11);
    // A 140 Hz voice with harmonics and a syllable rhythm, over broadband noise.
    const voiced = (i: number) => {
      const t = i / DENOISE_RATE;
      const syllable = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t);
      let v = 0;
      for (let h = 1; h <= 12; h++) v += Math.sin(2 * Math.PI * 140 * h * t) / h;
      return 0.08 * syllable * v;
    };
    const clean = new Float32Array(3 * DENOISE_RATE);
    for (let i = 0; i < clean.length; i++) clean[i] = voiced(i);
    const { output } = denoise((i) => voiced(i) + next() * 0.03, 3);
    // Most of the voice survives: far more is kept than the noise's share.
    const keptDb = db(rms(output.subarray(DENOISE_RATE)) / rms(clean.subarray(DENOISE_RATE)));
    expect(keptDb).toBeGreaterThan(-6);
  });

  it("frees its state and ignores frames afterwards", () => {
    const denoiser = createDenoiser(module);
    denoiser.dispose();
    expect(denoiser.process(new Float32Array(DENOISE_FRAME))).toBe(0);
    expect(() => denoiser.dispose()).not.toThrow();
  });
});

describe("48 kHz to 16 kHz decimation", () => {
  const through = (frequency: number) => {
    const decimator = createDecimator();
    const input = new Float32Array(DENOISE_RATE);
    for (let i = 0; i < input.length; i++) input[i] = Math.sin((2 * Math.PI * frequency * i) / DENOISE_RATE);
    const out: number[] = [];
    decimator.push(input, (sample) => out.push(sample));
    return { out: Float32Array.from(out), input };
  };

  it("emits one sample for every three", () => {
    expect(through(1000).out.length).toBe(DENOISE_RATE / 3);
  });

  it("passes speech frequencies untouched", () => {
    const { out, input } = through(1000);
    expect(Math.abs(db(rms(out.subarray(100)) / rms(input)))).toBeLessThan(0.2);
  });

  it("stops what would fold back into the speech band", () => {
    // 12 kHz would alias to 4 kHz at a 16 kHz rate.
    const { out, input } = through(12000);
    expect(db(rms(out.subarray(100)) / rms(input))).toBeLessThan(-40);
  });
});
