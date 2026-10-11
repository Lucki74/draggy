import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadRnnoiseWasm } from "../../scripts/rnnoiseWasm";

/** The capture worklet, run as the audio thread would run it: 128-sample quanta at 48 kHz. */

type Posted = { type?: string; active?: boolean; frame?: ArrayBuffer; level?: number };
type Processor = { process: (inputs: Float32Array[][]) => boolean; port: { onmessage: ((e: MessageEvent) => void) | null } };
type ProcessorClass = new (options?: { processorOptions?: { denoiser?: WebAssembly.Module } }) => Processor;

let registered: ProcessorClass | null = null;
let posted: Posted[] = [];

beforeEach(async () => {
  vi.resetModules();
  posted = [];
  registered = null;
  class FakeProcessor {
    port = { onmessage: null, postMessage: (message: Posted) => posted.push(message) };
  }
  Object.assign(globalThis, {
    sampleRate: 48000,
    AudioWorkletProcessor: FakeProcessor,
    registerProcessor: (_name: string, processor: ProcessorClass) => {
      registered = processor;
    },
  });
  await import("../voice/captureWorklet");
});

afterEach(() => {
  for (const key of ["sampleRate", "AudioWorkletProcessor", "registerProcessor"]) {
    delete (globalThis as Record<string, unknown>)[key];
  }
});

function run(processor: Processor, seconds: number, make: (i: number) => number) {
  const quantum = 128;
  const total = seconds * 48000;
  for (let at = 0; at < total; at += quantum) {
    const input = new Float32Array(quantum);
    for (let i = 0; i < quantum; i++) input[i] = make(at + i);
    processor.process([[input]]);
  }
  return posted.filter((message) => message.frame).map((message) => new Float32Array(message.frame!));
}

function noise() {
  let state = 3;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state / 2 ** 32 - 0.5) * 0.06;
  };
}

const rms = (frames: Float32Array[]) => {
  let sum = 0;
  let count = 0;
  for (const frame of frames) for (const value of frame) {
    sum += value * value;
    count++;
  }
  return Math.sqrt(sum / count);
};

describe("capture worklet", () => {
  it("hands on 16 kHz frames of 512 samples, cleaned by RNNoise", () => {
    const processor = new registered!({ processorOptions: { denoiser: new WebAssembly.Module(loadRnnoiseWasm()) } });
    expect(posted[0]).toEqual({ type: "denoise", active: true });

    const frames = run(processor, 3, noise());
    // 3 s at 16 kHz, in whole frames.
    expect(frames.length).toBe(Math.floor((3 * 16000) / 512));
    expect(frames.every((frame) => frame.length === 512)).toBe(true);
    // After the first second, the noise is essentially gone.
    const settled = frames.slice(32);
    expect(rms(settled)).toBeLessThan(0.017 * 0.1);
  });

  it("still delivers frames, uncleaned, without RNNoise", () => {
    const processor = new registered!({});
    expect(posted[0]).toEqual({ type: "denoise", active: false });
    const frames = run(processor, 1, noise());
    expect(frames.length).toBe(31);
    // Decimation alone keeps roughly the in-band third of white noise's power.
    expect(rms(frames.slice(2))).toBeGreaterThan(0.005);
  });
});
