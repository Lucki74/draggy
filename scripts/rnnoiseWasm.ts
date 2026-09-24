import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/** @jitsi/rnnoise-wasm ships two builds. The loose rnnoise.wasm barely touches noise (about 1.5 dB
 * on white noise); the one embedded in rnnoise-sync.js carries the full model and removes it. This
 * pulls that binary out of the JavaScript it is inlined in, so the app can compile it off the audio
 * thread instead of shipping emscripten's loader. */
export function extractRnnoiseWasm(source: string): Uint8Array<ArrayBuffer> {
  const match = source.match(/data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)/);
  if (!match) throw new Error("No embedded RNNoise binary in @jitsi/rnnoise-wasm");
  // Copied into a plain ArrayBuffer: Node's Buffer pool may be shared, which WebAssembly rejects.
  return new Uint8Array(Buffer.from(match[1], "base64"));
}

export function loadRnnoiseWasm(from: string = process.cwd() + "/"): Uint8Array<ArrayBuffer> {
  const require = createRequire(from);
  return extractRnnoiseWasm(readFileSync(require.resolve("@jitsi/rnnoise-wasm/dist/rnnoise-sync.js"), "utf8"));
}
