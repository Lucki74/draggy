import { VAD_FRAME } from "./constants";

/**
 * Speech detection, with the neural model when it is available and an energy
 * detector when it is not.
 *
 * The fallback exists because a conversation that refuses to start is worse
 * than one that occasionally mishears a fan. It reports a probability on the
 * same scale, so nothing downstream has to know which one is running.
 */

const MODEL_PATH =
  "onnx-community/silero-vad/resolve/main/onnx/model.onnx";

const CACHE_HOST = "draggy://models/";
const REMOTE_HOST = "https://huggingface.co/";
const ORT_ASSET_DIR = "ort/";

export type DetectorKind = "neural" | "energy";

export interface Detector {
  kind: DetectorKind;
  /** Frames must be pushed in order; scores come back in the same order. */
  push: (frame: Float32Array) => void;
  reset: () => void;
  stop: () => void;
}

export type ScoreHandler = (frame: Float32Array, probability: number) => void;

function modelUrl(): string {
  const host = typeof window !== "undefined" && window.electronAPI
    ? CACHE_HOST
    : REMOTE_HOST;
  return host + MODEL_PATH;
}

/**
 * Root mean square, mapped onto the same 0..1 scale the neural model reports.
 * The noise floor tracks the room while nobody is speaking.
 */
export function createEnergyDetector(onScore: ScoreHandler): Detector {
  const MINIMUM_FLOOR = 0.006;
  let floor = MINIMUM_FLOOR;

  return {
    kind: "energy",

    push(frame) {
      let energy = 0;
      for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
      const level = Math.sqrt(energy / frame.length);

      const ratio = level / Math.max(floor, MINIMUM_FLOOR);
      const probability = Math.max(0, Math.min(1, (ratio - 1.5) / 3));

      if (probability < 0.2) floor = floor * 0.95 + level * 0.05;

      onScore(frame, probability);
    },

    reset() {
      floor = MINIMUM_FLOOR;
    },

    stop() {
      floor = MINIMUM_FLOOR;
    },
  };
}

function createNeuralDetector(
  worker: Worker,
  onScore: ScoreHandler,
): Detector {
  worker.onmessage = (event: MessageEvent) => {
    const reply = event.data as { type: string; probability: number; frame: ArrayBuffer };
    if (reply.type !== "score") return;
    onScore(new Float32Array(reply.frame), reply.probability);
  };

  return {
    kind: "neural",

    push(frame) {
      if (frame.length !== VAD_FRAME) return;
      const copy = frame.slice();
      worker.postMessage({ type: "score", frames: [copy.buffer] }, [copy.buffer]);
    },

    reset() {
      worker.postMessage({ type: "reset" });
    },

    stop() {
      worker.onmessage = null;
      worker.terminate();
    },
  };
}

export async function createDetector(onScore: ScoreHandler): Promise<Detector> {
  let worker: Worker | null = null;

  try {
    worker = new Worker(new URL("./vadWorker.ts", import.meta.url), {
      type: "module",
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("The speech detector took too long to start")),
        30000,
      );

      const settle = (error?: Error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };

      worker!.onerror = (event) =>
        settle(new Error(event.message || "The speech detector failed to start"));

      worker!.onmessage = (event: MessageEvent) => {
        const reply = event.data as { type: string; message?: string };
        if (reply.type === "ready") settle();
        else if (reply.type === "error") settle(new Error(reply.message));
      };

      worker!.postMessage({
        type: "init",
        id: 1,
        modelUrl: modelUrl(),
        wasmPath: new URL(ORT_ASSET_DIR, document.baseURI).href,
      });
    });

    return createNeuralDetector(worker, onScore);
  } catch {
    worker?.terminate();
    return createEnergyDetector(onScore);
  }
}
