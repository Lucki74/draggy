import workletUrl from "./captureWorklet.ts?worker&url";
import { DENOISE_RATE } from "./denoise";

/** The microphone side of a conversation: raw frames, a level for the UI, and a mute that takes
 * effect on the audio thread rather than several frames later. The frames arrive at 16 kHz,
 * already cleaned of background noise by RNNoise when it could be loaded. */

const WORKLET_NAME = "voice-capture";
/** Emitted beside the app by the rnnoise-asset plugin in vite.config.ts. */
const RNNOISE_ASSET = "rnnoise/rnnoise.wasm";

export interface CaptureEvents {
  onFrame: (frame: Float32Array) => void;
  onLevel: (level: number) => void;
}

export interface Capture {
  stop: () => void;
  setMuted: (muted: boolean) => void;
  /** The audio graph, so a synthesiser can play into the same context. */
  context: AudioContext;
  /** Whether RNNoise is cleaning the microphone, rather than only the browser's suppressor. */
  denoising: () => boolean;
}

/** Compiled once per session: the module is reusable and small, and compiling is the only step that
 * cannot happen on the audio thread. */
let compiled: Promise<WebAssembly.Module | null> | null = null;
function loadDenoiser(): Promise<WebAssembly.Module | null> {
  if (!compiled) {
    compiled = (async () => {
      try {
        const response = await fetch(new URL(RNNOISE_ASSET, document.baseURI).href);
        if (!response.ok) return null;
        return await WebAssembly.compile(await response.arrayBuffer());
      } catch {
        return null;
      }
    })();
  }
  return compiled;
}

export async function startCapture(events: CaptureEvents): Promise<Capture> {
  const denoiser = await loadDenoiser();

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      // Two suppressors in a row smear the voice. With RNNoise running, the browser's is off; it is
      // turned back on below if RNNoise fails to start on the audio thread.
      noiseSuppression: !denoiser,
      autoGainControl: true,
    },
  });

  // 48 kHz is what RNNoise runs at and what nearly every microphone delivers, so usually nothing is
  // resampled at all; the worklet brings it down to 16 kHz after cleaning it.
  const context = new AudioContext({ sampleRate: DENOISE_RATE });

  try {
    await context.audioWorklet.addModule(workletUrl);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    await context.close();
    throw error;
  }

  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, WORKLET_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    processorOptions: { denoiser: denoiser ?? undefined },
  });

  let muted = false;
  let denoising = false;

  const fallBackToBrowserSuppression = () => {
    for (const track of stream.getAudioTracks()) {
      void track.applyConstraints({ noiseSuppression: true }).catch(() => undefined);
    }
  };

  node.port.onmessage = (event: MessageEvent) => {
    const data = event.data as {
      type?: string;
      active?: boolean;
      frame?: ArrayBuffer;
      level?: number;
    };
    if (data.type === "denoise") {
      denoising = Boolean(data.active);
      if (!denoising && denoiser) fallBackToBrowserSuppression();
      return;
    }
    if (data.type === "denoise-failed") return;
    if (!data.frame) return;
    events.onLevel(muted ? 0 : data.level ?? 0);
    if (!muted) events.onFrame(new Float32Array(data.frame));
  };

  source.connect(node);

  return {
    context,

    denoising: () => denoising,

    stop: () => {
      node.port.onmessage = null;
      node.port.postMessage({ type: "dispose" });
      node.disconnect();
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
    },

    setMuted: (value: boolean) => {
      muted = value;
      // Muting on the audio thread too, so frames already in flight when the
      // button was pressed are dropped rather than answered.
      node.port.postMessage({ type: "mute", value });
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !value;
      });
    },
  };
}
