/** Noise suppression for the microphone, run on the audio thread. The browser's own suppressor only
 * handles steady hiss; RNNoise, a small recurrent network trained on real rooms, also removes
 * keyboards, fans, traffic and chatter in the background, and it sees every sample before the
 * voice detector does, so noise stops opening turns as well as muddying transcripts.
 *
 * RNNoise works on 10 ms frames at 48 kHz; the rest of the voice pipeline runs at 16 kHz, so the
 * cleaned signal is low-passed and decimated by three on the way out. */

export const DENOISE_RATE = 48000;
/** 10 ms at 48 kHz, the only frame size RNNoise accepts. */
export const DENOISE_FRAME = 480;
export const DECIMATION = 3;

/** RNNoise's arithmetic is scaled for 16-bit samples, not -1..1 floats. */
const PCM_SCALE = 32768;

export interface Denoiser {
  /** Cleans one frame in place and returns the network's own voice probability for it. */
  process: (frame: Float32Array) => number;
  dispose: () => void;
}

/** The full-model emscripten build embedded in @jitsi/rnnoise-wasm 0.2.1's rnnoise-sync.js, whose
 * exports are minified: memory is "c", the constructors "d", malloc "e", free "f", rnnoise_create
 * "h", rnnoise_destroy "i" and rnnoise_process_frame "j"; it imports only resize_heap and
 * memcpy_big. The package is pinned to that version because the letters change with every build. */
interface RnnoiseExports {
  c: WebAssembly.Memory;
  d: () => void;
  e: (bytes: number) => number;
  f: (pointer: number) => void;
  h: (model: number) => number;
  i: (state: number) => void;
  j: (state: number, output: number, input: number) => number;
}

function isRnnoise(exports: WebAssembly.Exports): exports is WebAssembly.Exports & RnnoiseExports {
  const e = exports as Record<string, unknown>;
  return (
    e.c instanceof WebAssembly.Memory &&
    ["d", "e", "f", "h", "i", "j"].every((name) => typeof e[name] === "function")
  );
}

/** Instantiates RNNoise synchronously from an already compiled module, which is what an audio
 * worklet can do: it cannot fetch, and compiling there would stall the audio clock. */
export function createDenoiser(module: WebAssembly.Module): Denoiser {
  let memory: WebAssembly.Memory | null = null;
  const imports = {
    a: {
      // emscripten_resize_heap(requested bytes): grow the memory or report that it could not.
      a: (requested: number) => {
        if (!memory) return 0;
        const missing = (requested >>> 0) - memory.buffer.byteLength;
        if (missing <= 0) return 1;
        try {
          memory.grow(Math.ceil(missing / 65536));
          return 1;
        } catch {
          return 0;
        }
      },
      // emscripten_memcpy_big(dest, src, count)
      b: (dest: number, src: number, count: number) => {
        if (memory) new Uint8Array(memory.buffer).copyWithin(dest, src, src + count);
      },
    },
  };

  const instance = new WebAssembly.Instance(module, imports);
  if (!isRnnoise(instance.exports)) throw new Error("Unexpected RNNoise build");
  const e = instance.exports;
  memory = e.c;
  e.d();

  const state = e.h(0);
  const bytes = DENOISE_FRAME * Float32Array.BYTES_PER_ELEMENT;
  const input = e.e(bytes);
  const output = e.e(bytes);
  if (!state || !input || !output) throw new Error("RNNoise could not allocate its state");

  let disposed = false;

  return {
    process(frame) {
      if (disposed) return 0;
      // Views are made per call: a heap that grew detaches the old ones.
      const heap = new Float32Array(e.c.buffer);
      const inAt = input >> 2;
      const outAt = output >> 2;
      for (let i = 0; i < DENOISE_FRAME; i++) heap[inAt + i] = frame[i] * PCM_SCALE;
      const voice = e.j(state, output, input);
      for (let i = 0; i < DENOISE_FRAME; i++) frame[i] = heap[outAt + i] / PCM_SCALE;
      return voice;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      e.f(input);
      e.f(output);
      e.i(state);
    },
  };
}

/** Low-pass taps for 48 kHz -> 16 kHz: a Hamming-windowed sinc cut at 7 kHz, so what folds back
 * from above the new 8 kHz Nyquist is attenuated rather than mixed into speech. */
export function decimationTaps(count = 63, cutoffHz = 7000, rate = DENOISE_RATE): Float32Array {
  const taps = new Float32Array(count);
  const fc = cutoffHz / rate;
  const middle = (count - 1) / 2;
  let sum = 0;
  for (let n = 0; n < count; n++) {
    const x = n - middle;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (count - 1));
    taps[n] = sinc * window;
    sum += taps[n];
  }
  for (let n = 0; n < count; n++) taps[n] /= sum;
  return taps;
}

/** Streaming 3:1 decimator: filters as samples arrive and emits every third one. */
export function createDecimator(taps: Float32Array = decimationTaps()) {
  const size = taps.length;
  const history = new Float32Array(size);
  let at = 0;
  let phase = 0;

  return {
    /** Feeds samples; calls `emit` with each 16 kHz sample produced. */
    push(samples: Float32Array, emit: (sample: number) => void) {
      for (let i = 0; i < samples.length; i++) {
        history[at] = samples[i];
        at = (at + 1) % size;
        phase = (phase + 1) % DECIMATION;
        if (phase !== 0) continue;
        let acc = 0;
        // history[at] is the oldest sample now, history[at - 1] the newest.
        for (let k = 0; k < size; k++) acc += taps[k] * history[(at + k) % size];
        emit(acc);
      }
    },
  };
}
