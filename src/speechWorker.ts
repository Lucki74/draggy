const SAMPLE_RATE = 16000;
const CHUNKING_THRESHOLD = SAMPLE_RATE * 28;

type Transcriber = (
  audio: Float32Array,
  options?: Record<string, unknown>,
) => Promise<{ text: string }>;

interface InitRequest {
  type: "init";
  id: number;
  model: string;
  cacheHost: string | null;
  wasmPath: string;
}

interface TranscribeRequest {
  type: "transcribe";
  id: number;
  samples: Float32Array;
  language: string | null;
}

type Request = InitRequest | TranscribeRequest;

let transcriber: Transcriber | null = null;
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
  const { pipeline, env } = await import("@huggingface/transformers");

  if (request.cacheHost) {
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

  const instance = await pipeline(
    "automatic-speech-recognition",
    request.model,
    {
      device,
      dtype:
        device === "webgpu"
          ? { encoder_model: "fp32", decoder_model_merged: "q4" }
          : "q8",
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
    },
  );

  transcriber = instance as unknown as Transcriber;
  await transcriber(new Float32Array(SAMPLE_RATE), {
    return_timestamps: false,
  });
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;

  try {
    if (request.type === "init") {
      if (!transcriber) await load(request);
      self.postMessage({ type: "ready", id: request.id, device });
      return;
    }

    if (!transcriber) throw new Error("Speech engine is not ready");

    const samples = request.samples;

    // Telling Whisper the language up front skips its detection pass and stops
    // it from switching language halfway through a conversation.
    const options: Record<string, unknown> = { return_timestamps: false };
    if (request.language) {
      options.language = request.language;
      options.task = "transcribe";
    }
    if (samples.length > CHUNKING_THRESHOLD) {
      options.chunk_length_s = 30;
      options.stride_length_s = 5;
    }

    const result = await transcriber(samples, options);

    self.postMessage({
      type: "result",
      id: request.id,
      text: (result?.text || "").trim(),
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
