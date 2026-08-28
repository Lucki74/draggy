/// <reference lib="webworker" />

/**
 * Kokoro, an 82 million parameter speech synthesiser, running locally.
 *
 * This is what makes the assistant sound like a person rather than a car
 * navigation system. It is an optional download because the model is around
 * 90 MB and only covers English; every other language keeps the system voice.
 */

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const WARMUP_TEXT = "Ready.";

interface InitRequest {
  type: "init";
  id: number;
  cacheHost: string | null;
  wasmPath: string;
}

interface GenerateRequest {
  type: "generate";
  id: number;
  text: string;
  voice: string;
  speed: number;
}

type Request = InitRequest | GenerateRequest;

interface Synthesiser {
  generate: (
    text: string,
    options: { voice: string; speed: number },
  ) => Promise<{ audio: Float32Array; sampling_rate: number }>;
}

let synthesiser: Synthesiser | null = null;
let device: "webgpu" | "wasm" = "wasm";

async function detectDevice(): Promise<"webgpu" | "wasm"> {
  try {
    if (!navigator.gpu) return "wasm";
    const adapter = await navigator.gpu.requestAdapter();
    return adapter ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

async function load(request: InitRequest): Promise<void> {
  const [{ KokoroTTS }, { env }] = await Promise.all([
    import("kokoro-js"),
    import("@huggingface/transformers"),
  ]);

  if (request.cacheHost) {
    // Weights come through the app's own cache, so a conversation started
    // offline still works after the first download.
    env.remoteHost = request.cacheHost;
    env.useBrowserCache = false;
  }
  env.allowLocalModels = false;

  const wasmBackend = env.backends.onnx.wasm;
  if (wasmBackend) {
    wasmBackend.numThreads = 1;
    wasmBackend.wasmPaths = request.wasmPath;
  }

  device = await detectDevice();

  const instance = await KokoroTTS.from_pretrained(MODEL_ID, {
    // q8 keeps the download near 90 MB and stays comfortably faster than
    // real time on a CPU, which matters more here than the last of the quality.
    dtype: "q8",
    device,
    progress_callback: (event: {
      status?: string;
      file?: string;
      loaded?: number;
      total?: number;
    }) => {
      if (event.status !== "progress") return;
      const loaded = event.loaded || 0;
      const total = event.total || 0;
      self.postMessage({
        type: "progress",
        file: event.file || "",
        loaded,
        total,
        percent: total > 0 ? (loaded / total) * 100 : 0,
      });
    },
  });

  synthesiser = instance as unknown as Synthesiser;

  // The first call allocates buffers and compiles shaders. Paying for that
  // here means the first thing the user hears is not preceded by a pause.
  await synthesiser.generate(WARMUP_TEXT, { voice: "af_heart", speed: 1 });
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;

  try {
    if (request.type === "init") {
      if (!synthesiser) await load(request);
      self.postMessage({ type: "ready", id: request.id, device });
      return;
    }

    if (!synthesiser) throw new Error("The voice is not ready yet");

    const started = performance.now();
    const result = await synthesiser.generate(request.text, {
      voice: request.voice,
      speed: request.speed,
    });

    const samples = new Float32Array(result.audio);

    self.postMessage(
      {
        type: "audio",
        id: request.id,
        samples: samples.buffer,
        sampleRate: result.sampling_rate,
        generateMs: performance.now() - started,
      },
      [samples.buffer],
    );
  } catch (error) {
    self.postMessage({
      type: "error",
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
