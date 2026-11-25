import { createNeuralVoice } from "./neuralVoice";
import type { VoiceEngine } from "./voiceEngine";
import { logRendererEvent, swallowed } from "../logger";

/** Speaks one sample sentence through the real neural engine and output chain, then lets go of the
 * audio and the worker. Returns a function that stops it early. */

export interface PreviewOptions {
  voice: string;
  language: string;
  rate: number;
  text: string;
  onDone?: () => void;
}

export interface PreviewDeps {
  createContext: () => AudioContext;
  createVoice: typeof createNeuralVoice;
}

const defaults: PreviewDeps = {
  createContext: () => new AudioContext({ sampleRate: 24000 }),
  createVoice: createNeuralVoice,
};

export function previewVoice(options: PreviewOptions, deps: PreviewDeps = defaults): () => void {
  let stopped = false;
  let engine: (VoiceEngine & { device: string }) | null = null;
  let context: AudioContext | null = null;
  let heard = false;

  const finish = () => {
    if (stopped) return;
    stopped = true;
    logRendererEvent("renderer.voice", "DEBUG", "preview finished", { heard });
    engine?.dispose();
    void context?.close().catch(swallowed("renderer.voice", "closing a handle that may be gone"));
    options.onDone?.();
  };

  context = deps.createContext();
  logRendererEvent("renderer.voice", "DEBUG", "preview started", { chars: options.text.length, voice: options.voice });
  deps
    .createVoice(context, {
      language: options.language,
      voice: options.voice,
      rate: options.rate,
      onSpeakingChange: (speaking) => {
        if (speaking) heard = true;
        else if (heard) finish();
      },
    })
    .then((voice) => {
      engine = voice;
      if (stopped) {
        voice.dispose();
        return;
      }
      voice.enqueue(options.text, "final");
    })
    .catch((error) => {
      logRendererEvent("renderer.voice", "WARN", "preview failed", { error });
      finish();
    });

  return finish;
}
