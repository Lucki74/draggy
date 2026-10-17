import { workerThreads } from "./voice/threads";
import { createFileProgressTracker } from "./utils";

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
let loadedModel = "";
let device: "webgpu" | "wasm" = "wasm";

const isWhisper = () => loadedModel.includes("whisper");

async function detectDevice(): Promise<"webgpu" | "wasm"> {
  try {
    if (!navigator.gpu) return "wasm";
    const adapter = await navigator.gpu.requestAdapter();
    return adapter ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

/**
 * The pipeline loads its processor only when the model's file list names one. Moonshine reads the
 * sampling rate from it, so a missing processor fails the first transcription with a null error.
 */
async function ensureProcessor(instance: { processor?: unknown }, model: string): Promise<void> {
  if (instance.processor) return;
  try {
    const { AutoProcessor } = await import("@huggingface/transformers");
    instance.processor = await AutoProcessor.from_pretrained(model);
  } catch {
    // Moonshine takes the raw waveform, so a callable that wraps it is all the pipeline needs.
    const { Tensor } = await import("@huggingface/transformers");
    const processor = async (audio: Float32Array) => ({
      input_values: new Tensor("float32", audio, [1, audio.length]),
    });
    processor.feature_extractor = { config: { sampling_rate: SAMPLE_RATE } };
    instance.processor = processor;
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
    wasmBackend.numThreads = workerThreads();
    wasmBackend.wasmPaths = request.wasmPath;
  }

  device = await detectDevice();
  const track = createFileProgressTracker();
  transcriber = null;
  loadedModel = "";

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
        self.postMessage({
          type: "progress",
          file: event.file || "",
          loaded: event.loaded || 0,
          total: event.total || 0,
          percent: track(event),
        });
      },
    },
  );

  await ensureProcessor(instance as unknown as { processor?: unknown }, request.model);
  transcriber = instance as unknown as Transcriber;
  loadedModel = request.model;
  await transcriber(new Float32Array(SAMPLE_RATE), isWhisper() ? { return_timestamps: false } : {});
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;

  try {
    if (request.type === "init") {
      if (!transcriber || loadedModel !== request.model) await load(request);
      self.postMessage({ type: "ready", id: request.id, device });
      return;
    }

    if (!transcriber) throw new Error("Speech engine is not ready");

    const samples = request.samples;

    // Telling Whisper the language up front skips its detection pass and stops
    // it from switching language halfway through a conversation.
    // Moonshine takes no language, task or chunking options; they are Whisper's.
    const options: Record<string, unknown> = isWhisper() ? { return_timestamps: false } : {};
    if (isWhisper() && request.language) {
      options.language = request.language;
      options.task = "transcribe";
    }
    if (isWhisper() && samples.length > CHUNKING_THRESHOLD) {
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
