/** Mic capture on the audio thread, so UI renders cannot drop frames where speech starts. Runs at
 * 48 kHz: each 10 ms is cleaned by RNNoise, then decimated to 16 kHz and handed on in 512-sample
 * frames, exactly what Silero expects. */

import { createDecimator, createDenoiser, DENOISE_FRAME } from "./denoise";
import type { Denoiser } from "./denoise";

// The audio worklet scope is not in TypeScript's DOM library.
declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}

const FRAME = 512;
const PROCESSOR_NAME = "voice-capture";

interface ProcessorOptions {
  /** RNNoise, compiled on the main thread; absent when it could not be loaded. */
  denoiser?: WebAssembly.Module;
}

class VoiceCaptureProcessor extends AudioWorkletProcessor {
  private muted = false;
  private denoiser: Denoiser | null = null;
  private readonly decimator = createDecimator();
  /** 48 kHz samples waiting to make a 10 ms frame. */
  private pending = new Float32Array(DENOISE_FRAME);
  private pendingFilled = 0;
  /** 16 kHz samples waiting to make a 512-sample frame. */
  private frame = new Float32Array(FRAME);
  private frameFilled = 0;
  /** Highest RNNoise voice probability seen within the current output frame. */
  private voice = 0;

  constructor(options?: { processorOptions?: ProcessorOptions }) {
    super(options);
    const module = options?.processorOptions?.denoiser;
    if (module && sampleRate === 48000) {
      try {
        this.denoiser = createDenoiser(module);
      } catch (error) {
        this.port.postMessage({ type: "denoise-failed", message: String(error) });
      }
    }
    this.port.postMessage({ type: "denoise", active: this.denoiser !== null });

    this.port.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; value?: unknown };
      if (data?.type === "mute") this.muted = Boolean(data.value);
      if (data?.type === "dispose") {
        this.denoiser?.dispose();
        this.denoiser = null;
      }
    };
  }

  private emitSample = (sample: number) => {
    this.frame[this.frameFilled++] = sample;
    if (this.frameFilled < FRAME) return;

    const frame = this.frame;
    this.frame = new Float32Array(FRAME);
    this.frameFilled = 0;

    let energy = 0;
    for (let i = 0; i < FRAME; i++) energy += frame[i] * frame[i];

    // The buffer is transferred rather than copied, so no allocation churn
    // reaches the audio thread's deadline.
    this.port.postMessage(
      { frame: frame.buffer, level: Math.sqrt(energy / FRAME), muted: this.muted, voice: this.voice },
      [frame.buffer],
    );
    this.voice = 0;
  };

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input) return true;

    let offset = 0;
    while (offset < input.length) {
      const take = Math.min(DENOISE_FRAME - this.pendingFilled, input.length - offset);
      this.pending.set(input.subarray(offset, offset + take), this.pendingFilled);
      this.pendingFilled += take;
      offset += take;
      if (this.pendingFilled < DENOISE_FRAME) continue;

      if (this.denoiser) this.voice = Math.max(this.voice, this.denoiser.process(this.pending));
      this.decimator.push(this.pending, this.emitSample);
      this.pendingFilled = 0;
    }

    return true;
  }
}

registerProcessor(PROCESSOR_NAME, VoiceCaptureProcessor);
