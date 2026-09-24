import { SUPERTONIC_LANGUAGES, SUPERTONIC_VOICES } from "./supertonic";
import { synthesizeSound } from "./vocalSounds";
import { DUCK_GAIN } from "./voiceEngine";
import type { VocalSound } from "./vocalSounds";
import type { EngineOptions, VoiceEngine } from "./voiceEngine";

/** Playback for the neural voice. Fragments are scheduled back to back on the audio clock, so each
 * seam is sample-accurate rather than timer-accurate. */

const ORT_ASSET_DIR = "ort/";
const CACHE_HOST = "draggy://models/";

/** Gain ramps, short enough to feel instant and long enough not to click. */
const DUCK_RAMP_S = 0.08;
const CANCEL_RAMP_S = 0.05;

/** Supertonic 3 speaks eleven of the interface's twelve languages; Chinese keeps the system voice. */
export const NEURAL_LANGUAGES = SUPERTONIC_LANGUAGES;

export interface NeuralVoiceOption {
  id: string;
  name: string;
  gender: "Female" | "Male";
}

/** The ten voices that ship with Supertonic's open weights. They carry no accent of their own: each
 * speaks every supported language natively. */
export const NEURAL_VOICES: NeuralVoiceOption[] = SUPERTONIC_VOICES.map((voice) => ({
  id: voice.id,
  name: voice.id,
  gender: voice.gender,
}));

export const DEFAULT_NEURAL_VOICE = "F1";

/** A saved voice id, as one of today's. Earlier versions stored Kokoro ids (af_heart, bm_george...);
 * those keep their gender rather than falling back to whoever is first. */
export function resolveNeuralVoice(id: string | null | undefined): string {
  if (id && NEURAL_VOICES.some((voice) => voice.id === id)) return id;
  if (id && /^[ab]m_/.test(id)) return "M1";
  return DEFAULT_NEURAL_VOICE;
}

export function isNeuralVoiceAvailable(language: string): boolean {
  return NEURAL_LANGUAGES.has(language);
}

export interface NeuralProgress {
  percent: number;
  file: string;
}

export interface NeuralVoiceOptions extends EngineOptions {
  onProgress?: (progress: NeuralProgress) => void;
}

export async function createNeuralVoice(
  context: AudioContext,
  options: NeuralVoiceOptions,
): Promise<VoiceEngine & { device: "webgpu" | "wasm" }> {
  const worker = new Worker(new URL("./supertonicWorker.ts", import.meta.url), {
    type: "module",
  });

  const gain = context.createGain();
  gain.gain.value = 1;
  gain.connect(context.destination);

  let device: "webgpu" | "wasm" = "wasm";
  let nextId = 1;

  /** Text waiting to be synthesised, and sounds waiting their turn behind it. */
  const pending: ({ text: string } | { sound: VocalSound })[] = [];
  let inFlight = false;
  let awaitingId = 0;

  let nextStart = 0;
  const playing = new Set<AudioBufferSourceNode>();
  let speaking = false;

  const setSpeaking = (value: boolean) => {
    if (speaking === value) return;
    speaking = value;
    options.onSpeakingChange(value);
  };

  const settleIfDrained = () => {
    if (playing.size === 0 && pending.length === 0 && !inFlight) {
      setSpeaking(false);
    }
  };

  const pump = () => {
    // A sound needs no worker: it is scheduled the moment the text before it has been, so a breath
    // at the start of a reply plays while the first sentence is still being synthesised.
    while (!inFlight && pending.length > 0 && "sound" in pending[0]) {
      const { sound } = pending.shift() as { sound: VocalSound };
      schedule(synthesizeSound(sound, { rate: context.sampleRate, register: options.register }), context.sampleRate);
    }
    if (inFlight || pending.length === 0) return;
    const { text } = pending.shift() as { text: string };
    inFlight = true;
    awaitingId = nextId++;
    worker.postMessage({
      type: "generate",
      id: awaitingId,
      text,
      voice: resolveNeuralVoice(options.voice),
      speed: options.rate,
      lang: options.language,
    });
  };

  const schedule = (samples: Float32Array, sampleRate: number) => {
    if (samples.length === 0) return;

    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);

    // A little ahead of "now" so a late frame never truncates the start.
    const startAt = Math.max(context.currentTime + 0.02, nextStart);
    source.start(startAt);
    nextStart = startAt + buffer.duration;

    playing.add(source);
    setSpeaking(true);

    source.onended = () => {
      playing.delete(source);
      settleIfDrained();
    };
  };

  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The neural voice took too long to start")),
      10 * 60 * 1000,
    );

    worker.onerror = (event) => {
      clearTimeout(timer);
      reject(new Error(event.message || "The neural voice failed to start"));
    };

    worker.onmessage = (event: MessageEvent) => {
      const reply = event.data as {
        type: string;
        id?: number;
        message?: string;
        device?: "webgpu" | "wasm";
        percent?: number;
        file?: string;
        samples?: ArrayBuffer;
        sampleRate?: number;
      };

      if (reply.type === "progress") {
        options.onProgress?.({
          percent: reply.percent ?? 0,
          file: reply.file ?? "",
        });
        return;
      }

      if (reply.type === "ready") {
        clearTimeout(timer);
        device = reply.device ?? "wasm";
        resolve();
        return;
      }

      if (reply.type === "error") {
        clearTimeout(timer);
        // An error during startup rejects; one during a reply just drops that
        // fragment rather than ending the conversation.
        if (!speaking && playing.size === 0 && pending.length === 0) {
          reject(new Error(reply.message));
        }
        inFlight = false;
        settleIfDrained();
        pump();
        return;
      }

      if (reply.type === "audio") {
        inFlight = false;
        const stale = reply.id !== awaitingId;
        if (!stale && reply.samples && reply.sampleRate) {
          schedule(new Float32Array(reply.samples), reply.sampleRate);
        }
        settleIfDrained();
        pump();
      }
    };

    worker.postMessage({
      type: "init",
      id: 0,
      cacheHost: typeof window !== "undefined" && window.electronAPI ? CACHE_HOST : null,
      wasmPath: new URL(ORT_ASSET_DIR, document.baseURI).href,
    });
  });

  try {
    await ready;
  } catch (error) {
    worker.terminate();
    gain.disconnect();
    throw error;
  }

  const stopAll = () => {
    for (const source of playing) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already finished; nothing to stop.
      }
    }
    playing.clear();
    nextStart = 0;
  };

  return {
    id: "neural",
    device,

    // Supertonic voices a laugh itself, and far better than one built from noise.
    inlineCues: new Set<VocalSound>(["laugh"]),

    enqueue(text) {
      const trimmed = text.trim();
      if (!trimmed) return;
      pending.push({ text: trimmed });
      setSpeaking(true);
      pump();
    },

    playSound(sound) {
      pending.push({ sound });
      setSpeaking(true);
      pump();
    },

    cancel() {
      pending.length = 0;
      // Any generation still running belongs to the turn being abandoned.
      awaitingId = -1;
      inFlight = false;

      const now = context.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + CANCEL_RAMP_S);

      stopAll();
      setSpeaking(false);

      gain.gain.setValueAtTime(1, now + CANCEL_RAMP_S + 0.01);
    },

    duck(active) {
      const now = context.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(active ? DUCK_GAIN : 1, now + DUCK_RAMP_S);
    },

    dispose() {
      stopAll();
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      gain.disconnect();
    },
  };
}
