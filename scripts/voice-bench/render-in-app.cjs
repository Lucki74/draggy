#!/usr/bin/env node
/**
 * Renders the bench fragments with the Supertonic worker inside a running Draggy.
 *
 *   npx electron . --remote-debugging-port=9222      (with the dev server up)
 *   node scripts/voice-bench/render-in-app.cjs <wavDir> [--voice F1] [--langs en,fr] [--seed 1]
 *
 * Needs scratch/voice-bench/fragments.json (run scripts/voice-bench.mjs first). Writes
 * <wavDir>/<replyId>-<n>.wav as mono float32, the raw worker output, before the production trim and
 * fades. Skips files that already exist, so an interrupted run resumes.
 */
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const outDir = path.resolve(args[0] || "scratch/voice-bench/wav");
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const voice = flag("--voice", "F1");
const langs = flag("--langs", "en,fr,es,zh").split(",");
const seed = Number(flag("--seed", "1"));
const only = flag("--only", null);
const limit = Number(flag("--timeout", "90")) * 1000;
const adhoc = flag("--text", null);
const fragments = adhoc
  ? { adhoc: { lang: flag("--lang", "en"), fragments: [{ text: adhoc, boundary: "sentence" }] } }
  : JSON.parse(fs.readFileSync(path.resolve("scratch/voice-bench/fragments.json"), "utf8"));

function wav(samples, rate) {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(3, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 4, 28);
  head.writeUInt16LE(4, 32);
  head.writeUInt16LE(32, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

async function pageId() {
  const list = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9222}/json`)).json();
  return list.find((t) => t.type === "page").webSocketDebuggerUrl;
}

let counter = 0;
const waiting = new Map();
let socket;
function evaluate(expression) {
  return new Promise((resolve, reject) => {
    const id = ++counter;
    waiting.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
}

const SETUP = `(() => {
  if (window.__bench) return "already";
  const worker = new Worker(new URL("/src/voice/supertonicWorker.ts", location.origin), { type: "module" });
  let n = 0;
  const pending = new Map();
  window.__bench = {
    ready: new Promise((resolve, reject) => {
      pending.set(0, { resolve, reject });
      worker.postMessage({ type: "init", id: 0, cacheHost: "draggy://models/", wasmPath: new URL("ort/", document.baseURI).href });
    }),
    generate: (text, boundary, voice, lang, seed) =>
      new Promise((resolve, reject) => {
        const id = ++n;
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: "generate", id, text, boundary, voice, lang, seed, speed: 1 });
      }),
  };
  worker.onmessage = (event) => {
    const m = event.data;
    const p = pending.get(m.id);
    if (!p || m.type === "progress") return;
    pending.delete(m.id);
    if (m.type === "error") p.reject(new Error(m.message));
    else if (m.type === "ready") p.resolve(m.device);
    else {
      const bytes = new Uint8Array(m.samples);
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      p.resolve({ b64: btoa(s), rate: m.sampleRate, ms: m.generateMs });
    }
  };
  return "set";
})()`;

async function main() {
  socket = new WebSocket(await pageId());
  await new Promise((r) => (socket.onopen = r));
  socket.onmessage = (m) => {
    const d = JSON.parse(m.data);
    const w = waiting.get(d.id);
    if (!w) return;
    waiting.delete(d.id);
    if (d.result?.exceptionDetails) w.reject(new Error(d.result.exceptionDetails.exception?.description || "page error"));
    else w.resolve(d.result.result.value);
  };
  await evaluate(SETUP);
  const device = await evaluate("window.__bench.ready");
  console.log("engine ready on", device);
  fs.mkdirSync(outDir, { recursive: true });
  const timings = {};
  let done = 0;
  const failed = [];
  for (const [id, entry] of Object.entries(fragments)) {
    if (!langs.includes(entry.lang) || (only && id !== only)) continue;
    for (let n = 0; n < entry.fragments.length; n++) {
      const file = path.join(outDir, `${id}-${n + 1}.wav`);
      if (!adhoc && fs.existsSync(file)) continue;
      const f = entry.fragments[n];
      const call = `window.__bench.generate(${JSON.stringify(f.text)}, ${JSON.stringify(f.boundary)}, ${JSON.stringify(voice)}, ${JSON.stringify(entry.lang)}, ${seed})`;
      const out = await Promise.race([evaluate(call), new Promise((r) => setTimeout(() => r(null), limit))]).catch((e) => ({ error: e.message }));
      if (!out || out.error) {
        console.log("FAILED", id, n + 1, out ? out.error : "timeout", JSON.stringify(f.text.slice(0, 40)));
        failed.push(`${id}-${n + 1}`);
        if (!out) break;
        continue;
      }
      const bytes = Buffer.from(out.b64, "base64");
      const samples = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
      fs.writeFileSync(file, wav(samples, out.rate));
      timings[entry.lang] = (timings[entry.lang] || []).concat(out.ms / (samples.length / out.rate));
      if (++done % 25 === 0) console.log("rendered", done);
    }
  }
  const real = Object.fromEntries(
    Object.entries(timings).map(([lang, v]) => [lang, { fragments: v.length, msPerAudioSecond: Math.round(v.reduce((a, b) => a + b, 0) / v.length) }]),
  );
  fs.writeFileSync(path.join(outDir, "timings.json"), JSON.stringify({ voice, device, seed, ...real }, null, 2));
  console.log("done", done, "failed", failed.length, JSON.stringify(real));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
