import { SUPERTONIC_LANGUAGES, SUPERTONIC_VOICES } from "./supertonic";
import { prepareFragment } from "./joins";
import { levelGain } from "./loudness";
import { createOutputChain } from "./outputChain";
import { DUCK_GAIN } from "./voiceEngine";
import type { Boundary } from "./chunker";
import type { LevelState } from "./loudness";
import type { VocalSound } from "./vocalSounds";
import type { EngineOptions, VoiceEngine } from "./voiceEngine";
import { logRendererEvent, logSwallow } from "../logger";

/** Playback for the neural voice. Fragments are trimmed, faded and levelled, then scheduled on the
 * audio clock with the pause a speaker would leave, so each seam is sample-accurate rather than
 * timer-accurate. */

const ORT_ASSET_DIR = "ort/";
const CACHE_HOST = "draggy://models/";

/** Gain ramps, short enough to feel instant and long enough not to click. */
const DUCK_RAMP_S = 0.08;
const CANCEL_RAMP_S = 0.05;

/** Supertonic 3 speaks English, French and Spanish; Chinese keeps the system voice. */
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

/** A stable 32-bit seed from a voice id. */
function hashSeed(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return hash >>> 0;
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

  const startedAt = performance.now();
  logRendererEvent("renderer.voice", "INFO", "neural voice starting", {
    language: options.language,
    voice: resolveNeuralVoice(options.voice),
  });

  const chain = createOutputChain(context);
  const gain = chain.gain;

  let device: "webgpu" | "wasm" = "wasm";
  let nextId = 1;

  /** Text waiting to be synthesised. */
  const pending: { text: string; boundary: Boundary }[] = [];
  let inFlight = false;
  let awaitingId = 0;
  let awaiting: { text: string; boundary: Boundary } | null = null;
  const level: LevelState = { previousDb: null };
  /** One noise seed per voice, so fragments of a conversation share a texture. */
  const seed = hashSeed(resolveNeuralVoice(options.voice));

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
      level.previousDb = null;
      setSpeaking(false);
    }
  };

  const pump = () => {
    if (inFlight || pending.length === 0) return;
    const next = pending.shift()!;
    inFlight = true;
    awaiting = next;
    awaitingId = nextId++;
    worker.postMessage({
      type: "generate",
      id: awaitingId,
      text: next.text,
      boundary: next.boundary,
      seed,
      voice: resolveNeuralVoice(options.voice),
      speed: options.rate,
      lang: options.language,
    });
  };

  const schedule = (raw: Float32Array, sampleRate: number, boundary: Boundary, text: string) => {
    const { samples, pause } = prepareFragment(raw, sampleRate, boundary, text, options.rate);
    if (samples.length === 0) return;

    const factor = levelGain(samples, sampleRate, level);
    for (let i = 0; i < samples.length; i++) samples[i] *= factor;

    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(chain.input);

    // A little ahead of "now" so a late frame never truncates the start.
    const startAt = Math.max(context.currentTime + 0.02, nextStart);
    source.start(startAt);
    nextStart = startAt + buffer.duration + pause;

    playing.add(source);
    setSpeaking(true);

    source.onended = () => {
      playing.delete(source);
      settleIfDrained();
    };
  };

  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      logRendererEvent("renderer.voice", "ERROR", "neural voice start timed out");
      reject(new Error("The neural voice took too long to start"));
    }, 10 * 60 * 1000);

    worker.onerror = (event) => {
      clearTimeout(timer);
      logRendererEvent("renderer.voice", "ERROR", "neural worker crashed", { error: event.message });
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
        logRendererEvent("renderer.voice", "INFO", "neural voice ready", {
          device,
          durMs: Math.round(performance.now() - startedAt),
        });
        resolve();
        return;
      }

      if (reply.type === "error") {
        clearTimeout(timer);
        logRendererEvent("renderer.voice", "ERROR", "neural voice error", { message: reply.message, id: reply.id });
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
        logRendererEvent("renderer.voice", "DEBUG", "fragment ready", { id: reply.id, stale, bytes: reply.samples?.byteLength ?? 0 });
        if (!stale && reply.samples && reply.sampleRate) {
          schedule(
            new Float32Array(reply.samples),
            reply.sampleRate,
            awaiting?.boundary ?? "final",
            awaiting?.text ?? "",
          );
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
    chain.dispose();
    throw error;
  }

  const stopAll = () => {
    for (const source of playing) {
      source.onended = null;
      try {
        source.stop();
      } catch (error) {
        logSwallow("renderer.voice", error, "already finished; nothing to stop");
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
    chunking: { min: 110, max: 250 },

    enqueue(text, boundary = "final") {
      const trimmed = text.trim();
      if (!trimmed) return;
      pending.push({ text: trimmed, boundary });
      setSpeaking(true);
      pump();
    },

    cancel() {
      pending.length = 0;
      // Any generation still running belongs to the turn being abandoned.
      awaitingId = -1;
      inFlight = false;
      level.previousDb = null;

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
      logRendererEvent("renderer.voice", "DEBUG", "neural voice disposed");
      stopAll();
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      chain.dispose();
    },
  };
}
