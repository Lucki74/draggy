export const SPEECH_MODEL = "onnx-community/whisper-base";

const CACHE_HOST = "draggy://models/";
const ORT_ASSET_DIR = "ort/";
const SAMPLE_RATE = 16000;
const MIN_SAMPLES = SAMPLE_RATE / 4;

export interface SpeechProgress {
  file: string;
  loaded: number;
  total: number;
  percent: number;
}

export interface Recorder {
  stop: () => Promise<Blob>;
  cancel: () => void;
}

interface WorkerReply {
  type: "ready" | "result" | "error" | "progress";
  id?: number;
  text?: string;
  message?: string;
  device?: "webgpu" | "wasm";
  file?: string;
  loaded?: number;
  total?: number;
  percent?: number;
}

let worker: Worker | null = null;
let readyPromise: Promise<void> | null = null;
let activeDevice: "webgpu" | "wasm" | null = null;
let nextId = 1;

const pending = new Map<
  number,
  { resolve: (text: string) => void; reject: (error: Error) => void }
>();
let progressListener: ((progress: SpeechProgress) => void) | null = null;

export function isSpeechSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined"
  );
}

export function getSpeechDevice(): "webgpu" | "wasm" | null {
  return activeDevice;
}

function ensureWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(new URL("./speechWorker.ts", import.meta.url), {
    type: "module",
  });

  worker.onmessage = (event: MessageEvent<WorkerReply>) => {
    const reply = event.data;

    if (reply.type === "progress") {
      progressListener?.({
        file: reply.file || "",
        loaded: reply.loaded || 0,
        total: reply.total || 0,
        percent: reply.percent || 0,
      });
      return;
    }

    if (reply.id === undefined) return;
    const entry = pending.get(reply.id);
    if (!entry) return;
    pending.delete(reply.id);

    if (reply.type === "ready") {
      activeDevice = reply.device || "wasm";
      entry.resolve("");
    } else if (reply.type === "error") {
      entry.reject(new Error(reply.message));
    } else {
      entry.resolve(reply.text || "");
    }
  };

  worker.onerror = (event) => {
    const failure = new Error(event.message || "Speech engine failed to start");
    pending.forEach((entry) => entry.reject(failure));
    pending.clear();
    readyPromise = null;
    worker?.terminate();
    worker = null;
  };

  return worker;
}

export function prepareSpeech(
  onProgress?: (progress: SpeechProgress) => void,
): Promise<void> {
  progressListener = onProgress || null;

  if (!readyPromise) {
    readyPromise = new Promise<void>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: () => resolve(), reject });
      ensureWorker().postMessage({
        type: "init",
        id,
        model: SPEECH_MODEL,
        cacheHost: window.electronAPI ? CACHE_HOST : null,
        wasmPath: new URL(ORT_ASSET_DIR, document.baseURI).href,
      });
    }).catch((error) => {
      readyPromise = null;
      throw error;
    });
  }

  return readyPromise;
}

export interface TranscribeOptions {
  /** ISO 639-1 code. Skips Whisper's language detection pass when given. */
  language?: string | null;
  onProgress?: (progress: SpeechProgress) => void;
}

/** True while the engine is working, so callers can avoid queueing behind it. */
export function isTranscribing(): boolean {
  return pending.size > 0;
}

export async function transcribeSamples(
  samples: Float32Array,
  options: TranscribeOptions | ((progress: SpeechProgress) => void) = {},
): Promise<string> {
  const settings: TranscribeOptions =
    typeof options === "function" ? { onProgress: options } : options;

  if (samples.length < MIN_SAMPLES) return "";

  await prepareSpeech(settings.onProgress);

  return new Promise<string>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });

    const copy = samples.slice();
    ensureWorker().postMessage(
      {
        type: "transcribe",
        id,
        samples: copy,
        language: settings.language ?? null,
      },
      [copy.buffer],
    );
  });
}

export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start();

  const releaseMicrophone = () => {
    stream.getTracks().forEach((track) => track.stop());
  };

  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          releaseMicrophone();
          resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
        };
        recorder.stop();
      }),
    cancel: () => {
      recorder.onstop = releaseMicrophone;
      recorder.stop();
    },
  };
}

export async function decodeToMono(blob: Blob): Promise<Float32Array> {
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (decoded.numberOfChannels === 1) return decoded.getChannelData(0);

    const left = decoded.getChannelData(0);
    const right = decoded.getChannelData(1);
    const mixed = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) {
      mixed[i] = (left[i] + right[i]) / 2;
    }
    return mixed;
  } finally {
    await context.close();
  }
}

export async function transcribe(
  blob: Blob,
  onProgress?: (progress: SpeechProgress) => void,
): Promise<string> {
  return transcribeSamples(await decodeToMono(blob), { onProgress });
}
