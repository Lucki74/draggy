/// <reference lib="webworker" />
import * as ort from "onnxruntime-web";

/**
 * Silero VAD off the main thread: a 2 MB classifier scoring each 32 ms frame.
 * Energy thresholds missed quiet speech and answered the room instead.
 */

const FRAME = 512;
const SAMPLE_RATE = 16000;
const STATE_DIMS = [2, 1, 128];

interface InitRequest {
  type: "init";
  id: number;
  modelUrl: string;
  wasmPath: string;
}

interface ScoreRequest {
  type: "score";
  frames: ArrayBuffer[];
}

interface ResetRequest {
  type: "reset";
}

type Request = InitRequest | ScoreRequest | ResetRequest;

function freshState() {
  return new ort.Tensor("float32", new Float32Array(2 * 1 * 128), STATE_DIMS);
}

let session: ort.InferenceSession | null = null;
let state = freshState();

const rate = new ort.Tensor("int64", BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);

function resetState() {
  state = freshState();
}

async function load(request: InitRequest): Promise<void> {
  ort.env.wasm.wasmPaths = request.wasmPath;
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = "error";

  const response = await fetch(request.modelUrl);
  if (!response.ok) {
    throw new Error(`Could not download the speech detector (${response.status})`);
  }

  session = await ort.InferenceSession.create(
    new Uint8Array(await response.arrayBuffer()),
    { executionProviders: ["wasm"], graphOptimizationLevel: "all" },
  );

  // One warm pass, so the first real frame is not the one that pays for
  // allocating the runtime's arenas.
  await score(new Float32Array(FRAME));
  resetState();
}

async function score(samples: Float32Array): Promise<number> {
  if (!session) return 0;

  const outputs = await session.run({
    input: new ort.Tensor("float32", samples, [1, FRAME]),
    state,
    sr: rate,
  });

  state = outputs.stateN as typeof state;
  return (outputs.output.data as Float32Array)[0];
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;

  if (request.type === "reset") {
    resetState();
    return;
  }

  if (request.type === "init") {
    try {
      await load(request);
      self.postMessage({ type: "ready", id: request.id });
    } catch (error) {
      self.postMessage({
        type: "error",
        id: request.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  // Frames are scored in the order they arrived: the model is recurrent, so
  // running them out of order would corrupt the hidden state.
  for (const buffer of request.frames) {
    const samples = new Float32Array(buffer);
    try {
      const probability = await score(samples);
      self.postMessage({ type: "score", probability, frame: buffer }, [buffer]);
    } catch {
      self.postMessage({ type: "score", probability: 0, frame: buffer }, [buffer]);
    }
  }
};
