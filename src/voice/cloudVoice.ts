import { createOutputChain } from "./outputChain";
import { DUCK_GAIN } from "./voiceEngine";
import playerUrl from "./playerWorklet.ts?worker&url";
import type { Boundary } from "./chunker";
import type { EngineOptions, VoiceEngine } from "./voiceEngine";
import { logRendererEvent } from "../logger";

/** A cloud voice: the main process makes the request with the provider's key, and the 24 kHz PCM it
 * streams back plays through the shared ring-buffer player and output chain. When a fragment fails
 * or stalls, the voice stops and hands the rest of the reply to the caller to speak locally. */

const FIRST_STALL_MS = 6000;
const STALL_MS = 1500;
const DUCK_RAMP_S = 0.06;
const CANCEL_RAMP_S = 0.03;

export interface CloudFailure {
  /** A short code such as "no-key", "http-429" or "stalled". */
  code: string;
  /** The fragment that was being spoken and everything queued behind it, in order. */
  remaining: string[];
}

export interface CloudVoiceOptions extends EngineOptions {
  provider: string;
  model?: string;
  onFailure: (failure: CloudFailure) => void;
  /** Characters sent so far, for the diagnostics row. */
  onUsage?: (characters: number) => void;
}

export async function createCloudVoice(context: AudioContext, options: CloudVoiceOptions): Promise<VoiceEngine> {
  const api = window.electronAPI?.tts;
  if (!api) throw new Error("Cloud voices need the desktop app.");
  logRendererEvent("renderer.voice", "INFO", "cloud voice starting", { provider: options.provider });

  await context.audioWorklet.addModule(playerUrl);
  const node = new AudioWorkletNode(context, "voice-player", { numberOfInputs: 0, outputChannelCount: [1] });
  const chain = createOutputChain(context);
  node.connect(chain.input);
  logRendererEvent("renderer.voice", "INFO", "cloud voice ready", { provider: options.provider });

  let turn = 1;
  const queue: { text: string; boundary: Boundary }[] = [];
  let current: string | null = null;
  let running = false;
  let speaking = false;
  let sounding = false;
  let failed = false;
  let sent = 0;
  /** Set by the first frame of the fragment in flight, which disarms its stall timer. */
  let heard = false;

  const refresh = () => {
    const value = running || queue.length > 0 || sounding;
    if (value === speaking) return;
    speaking = value;
    options.onSpeakingChange(value);
  };

  node.port.onmessage = (event: MessageEvent) => {
    if ((event.data as { type?: string })?.type === "idle") {
      sounding = false;
      refresh();
    }
  };

  const stopFrames = api.onFrames((frame) => {
    if (frame.turnId !== turn || failed) return;
    const pcm = new Float32Array(frame.pcm.length);
    for (let i = 0; i < pcm.length; i++) pcm[i] = frame.pcm[i] / 32768;
    heard = true;
    sounding = true;
    node.port.postMessage({ type: "pcm", samples: pcm, rate: frame.sampleRate }, [pcm.buffer]);
  });

  const fail = (code: string) => {
    failed = true;
    const remaining = [...(current ? [current] : []), ...queue.map((item) => item.text)];
    queue.length = 0;
    current = null;
    running = false;
    logRendererEvent("renderer.voice", "WARN", "cloud voice failed", { code, remaining: remaining.length, sent });
    api.cancel(turn);
    refresh();
    options.onFailure({ code, remaining });
  };

  const pump = async () => {
    if (running || failed) return;
    const next = queue.shift();
    if (!next) {
      node.port.postMessage({ type: "finish" });
      refresh();
      return;
    }
    running = true;
    current = next.text;
    heard = false;
    const startedAt = performance.now();
    const mine = turn;
    const stall = setTimeout(() => {
      if (mine === turn && running && !heard) fail("stalled");
    }, sent === 0 ? FIRST_STALL_MS : STALL_MS);
    // A stall is "no audio at all": the first frame of the fragment disarms the timer.
    const result = await api.speak(mine, { provider: options.provider, text: next.text, model: options.model, voice: options.voice });
    clearTimeout(stall);
    if (mine !== turn || failed) return;
    if (!result.success) {
      if (result.code !== "cancelled") fail(result.code ?? "failed");
      return;
    }
    sent += result.characters ?? 0;
    logRendererEvent("renderer.voice", "DEBUG", "cloud fragment spoken", {
      chars: next.text.length,
      sent,
      durMs: Math.round(performance.now() - startedAt),
    });
    options.onUsage?.(sent);
    current = null;
    running = false;
    void pump();
  };

  return {
    id: "cloud",
    chunking: { min: 80, max: 220 },

    enqueue(text, boundary = "final") {
      const trimmed = text.trim();
      if (!trimmed || failed) return;
      queue.push({ text: trimmed, boundary });
      refresh();
      void pump();
    },

    cancel() {
      queue.length = 0;
      current = null;
      running = false;
      api.cancel(turn);
      turn++;
      node.port.postMessage({ type: "cancel" });
      sounding = false;
      refresh();
    },

    duck(active) {
      const now = context.currentTime;
      const gain = chain.gain.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(active ? DUCK_GAIN : 1, now + (active ? DUCK_RAMP_S : CANCEL_RAMP_S));
    },

    dispose() {
      logRendererEvent("renderer.voice", "DEBUG", "cloud voice disposed", { sent });
      stopFrames();
      api.cancel(turn);
      node.port.postMessage({ type: "cancel" });
      node.disconnect();
      chain.dispose();
    },
  };
}
