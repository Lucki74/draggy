import { SAMPLE_RATE } from "./constants";

/**
 * The microphone side of a conversation: raw frames, a level for the UI, and a
 * mute that takes effect on the audio thread rather than several frames later.
 */

const WORKLET_URL = "voice-capture-worklet.js";
const WORKLET_NAME = "voice-capture";

export interface CaptureEvents {
  onFrame: (frame: Float32Array) => void;
  onLevel: (level: number) => void;
}

export interface Capture {
  stop: () => void;
  setMuted: (muted: boolean) => void;
  /** The audio graph, so a synthesiser can play into the same context. */
  context: AudioContext;
}

export async function startCapture(events: CaptureEvents): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  // Asking the context for 16 kHz makes the browser resample once, in native
  // code, instead of leaving it to be done badly in JavaScript later.
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });

  try {
    await context.audioWorklet.addModule(
      new URL(WORKLET_URL, document.baseURI).href,
    );
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
  });

  let muted = false;

  node.port.onmessage = (event: MessageEvent) => {
    const { frame, level } = event.data as { frame: ArrayBuffer; level: number };
    events.onLevel(muted ? 0 : level);
    if (!muted) events.onFrame(new Float32Array(frame));
  };

  source.connect(node);

  return {
    context,

    stop: () => {
      node.port.onmessage = null;
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
