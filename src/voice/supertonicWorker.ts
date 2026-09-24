/// <reference lib="webworker" />

import * as ort from "onnxruntime-web/webgpu";
import {
  SUPERTONIC_FILES,
  SUPERTONIC_REPO,
  parseVoiceStyle,
  synthesize,
} from "./supertonic";
import type {
  SessionLike,
  SupertonicConfig,
  TensorLike,
  SupertonicSessions,
  TensorFactory,
  VoiceStyle,
} from "./supertonic";

/** The natural voice, off the main thread. Speaks the same protocol the Kokoro worker did: init,
 * progress, ready, generate, audio, error. */

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
  lang: string;
}

type Request = InitRequest | GenerateRequest;

/** Flow-matching steps. Quality levels off near eight; on a processor five keeps a sentence well
 * ahead of real time, which matters more in a conversation than the last of the polish. */
const STEPS = { webgpu: 8, wasm: 5 } as const;
/** Supertonic's own neutral pace, scaled by the user's speed setting. */
const BASE_SPEED = 1.05;
const WARMUP = { text: "Ready.", lang: "en", voice: "F1" };

const tensor: TensorFactory = (type, data, dims) => new ort.Tensor(type, data, dims) as unknown as TensorLike;

let device: "webgpu" | "wasm" = "wasm";
let base = "";
let parts: {
  sessions: SupertonicSessions;
  config: SupertonicConfig;
  indexer: number[];
} | null = null;
const styles = new Map<string, Promise<VoiceStyle>>();

async function detectDevice(): Promise<"webgpu" | "wasm"> {
  try {
    if (!navigator.gpu) return "wasm";
    return (await navigator.gpu.requestAdapter()) ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

/** Downloads every file first, reporting bytes across all of them, then builds the sessions. */
async function fetchAll(paths: string[]): Promise<Map<string, ArrayBuffer>> {
  const sizes = new Map<string, number>();
  const loaded = new Map<string, number>();
  const report = (file: string) => {
    let done = 0;
    let total = 0;
    for (const [path, size] of sizes) {
      total += size;
      done += loaded.get(path) ?? 0;
    }
    self.postMessage({
      type: "progress",
      file,
      loaded: done,
      total,
      percent: total > 0 ? Math.min(99, (done / total) * 100) : 0,
    });
  };

  const results = new Map<string, ArrayBuffer>();
  await Promise.all(
    paths.map(async (path) => {
      const response = await fetch(`${base}${path}`);
      if (!response.ok || !response.body) throw new Error(`Could not download ${path} (${response.status})`);
      sizes.set(path, Number(response.headers.get("content-length")) || 0);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        loaded.set(path, received);
        report(path);
      }
      const joined = new Uint8Array(received);
      let at = 0;
      for (const chunk of chunks) {
        joined.set(chunk, at);
        at += chunk.length;
      }
      results.set(path, joined.buffer);
    }),
  );
  return results;
}

async function load(request: InitRequest): Promise<void> {
  base = `${request.cacheHost ?? "https://huggingface.co/"}${SUPERTONIC_REPO}/resolve/main/`;
  ort.env.wasm.wasmPaths = request.wasmPath;
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = "error";
  device = await detectDevice();

  const graphs = [
    SUPERTONIC_FILES.durationPredictor,
    SUPERTONIC_FILES.textEncoder,
    SUPERTONIC_FILES.vectorEstimator,
    SUPERTONIC_FILES.vocoder,
  ];
  const files = await fetchAll([SUPERTONIC_FILES.config, SUPERTONIC_FILES.indexer, ...graphs]);
  const json = (path: string) => JSON.parse(new TextDecoder().decode(files.get(path)!));

  const open = async (path: string, on: "webgpu" | "wasm") =>
    ort.InferenceSession.create(new Uint8Array(files.get(path)!), {
      executionProviders: [on],
      graphOptimizationLevel: "all",
    });
  const openAll = (on: "webgpu" | "wasm") => Promise.all(graphs.map((path) => open(path, on)));

  let sessions;
  try {
    sessions = await openAll(device);
  } catch {
    // A card that cannot take one of the graphs still leaves the processor.
    device = "wasm";
    sessions = await openAll("wasm");
  }
  // The arithmetic in ./supertonic only needs run(); the runtime's own types are narrower than that.
  const wrap = (session: ort.InferenceSession): SessionLike => ({
    run: (feeds) =>
      session.run(feeds as unknown as Record<string, ort.Tensor>) as unknown as Promise<Record<string, TensorLike>>,
  });
  const [durationPredictor, textEncoder, vectorEstimator, vocoder] = sessions.map(wrap);

  parts = {
    sessions: { durationPredictor, textEncoder, vectorEstimator, vocoder },
    config: json(SUPERTONIC_FILES.config) as SupertonicConfig,
    indexer: json(SUPERTONIC_FILES.indexer) as number[],
  };

  // The first run compiles shaders and sizes buffers; paid here, not before the first reply.
  await generate(WARMUP.text, WARMUP.voice, 1, WARMUP.lang);
}

function styleFor(voice: string): Promise<VoiceStyle> {
  let style = styles.get(voice);
  if (!style) {
    style = fetch(`${base}${SUPERTONIC_FILES.voice(voice)}`)
      .then((response) => {
        if (!response.ok) throw new Error(`Unknown voice ${voice}`);
        return response.json();
      })
      .then((json) => parseVoiceStyle(json, tensor));
    style.catch(() => styles.delete(voice));
    styles.set(voice, style);
  }
  return style;
}

async function generate(text: string, voice: string, speed: number, lang: string) {
  if (!parts) throw new Error("The voice is not ready yet");
  const style = await styleFor(voice);
  const samples = await synthesize(
    text,
    style,
    { ...parts, tensor },
    { lang, steps: STEPS[device], speed: BASE_SPEED * speed },
  );
  return { samples, sampleRate: parts.config.ae.sample_rate };
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    if (request.type === "init") {
      if (!parts) await load(request);
      self.postMessage({ type: "ready", id: request.id, device });
      return;
    }

    const started = performance.now();
    const { samples, sampleRate } = await generate(request.text, request.voice, request.speed, request.lang);
    const copy = samples.slice();
    self.postMessage(
      { type: "audio", id: request.id, samples: copy.buffer, sampleRate, generateMs: performance.now() - started },
      [copy.buffer],
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
