#!/usr/bin/env node
/**
 * Measures the engine inside the Tauri app on real models, through the app's own local API server.
 *
 *   node scripts/bench-engine.cjs --model name.gguf [--model other.gguf] [--exe path/to/draggy-win.exe]
 *        [--runs 3] [--out results.json] [--baseline previous.json] [--target 1.5] [--port 11499]
 *
 * --model names a file in the real Draggy models folder (%APPDATA%\Draggy\models); the app is launched on
 * a scratch profile that links it. Each workload runs --runs times after one warm-up; the median generation
 * speed is reported. The API path gives no prompt timings, draft acceptance or offload figures, so only
 * generation speed is measured. With --baseline, the script fails when the median speed-up is under --target
 * or any model got more than 5% slower.
 */
const fs = require("node:fs");
const path = require("node:path");
const { launch } = require("./tauri-app.cjs");
const { enableApi } = require("./bench-api.cjs");

const LONG_DOC = Array.from({ length: 400 }, (_, i) => `Line ${i}: the engine streams tokens from the model to the window.`).join("\n");
const CODE = `function total(items) {\n  let sum = 0;\n  for (const item of items) {\n    sum += item.price * item.quantity;\n  }\n  return sum;\n}\n`.repeat(6);
const WORKLOADS = [
  { name: "chat", messages: [{ role: "user", content: "Explain how a refrigerator keeps food cold, in three paragraphs." }] },
  { name: "code-edit", messages: [{ role: "user", content: `Rename the function to computeTotal and return the whole file unchanged otherwise:\n\n${CODE}` }] },
  { name: "long-prompt", messages: [{ role: "user", content: `${LONG_DOC}\n\nSummarise the text above in one sentence.` }] },
];

function parseArgs(argv) {
  const opts = { models: [], runs: 3, target: 1.5, out: null, baseline: null, port: 11499, exe: null };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case "--model": opts.models.push(next()); break;
      case "--exe": opts.exe = path.resolve(next()); break;
      case "--runs": opts.runs = Math.max(1, Number(next()) || 3); break;
      case "--out": opts.out = path.resolve(next()); break;
      case "--baseline": opts.baseline = path.resolve(next()); break;
      case "--target": opts.target = Number(next()) || 1.5; break;
      case "--port": opts.port = Number(next()) || opts.port; break;
      case "--help":
      case "-h":
        console.log("usage: node scripts/bench-engine.cjs --model name.gguf [--runs 3] [--out f.json] [--baseline f.json] [--target 1.5]");
        process.exit(0);
        break;
      default: throw new Error(`Unknown argument ${argv[i]}`);
    }
  }
  if (opts.models.length === 0) throw new Error("Pass at least one --model");
  return opts;
}

async function runOnce(endpoint, model, workload) {
  const started = performance.now();
  const response = await fetch(`${endpoint.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${endpoint.key}` },
    body: JSON.stringify({ model, messages: workload.messages, stream: false }),
  });
  if (!response.ok) throw new Error(`${workload.name}: HTTP ${response.status}`);
  const body = await response.json();
  const seconds = (performance.now() - started) / 1000;
  const tokens = body.usage?.completion_tokens ?? 0;
  return { genTps: seconds > 0 ? tokens / seconds : 0, wallMs: seconds * 1000, tokens };
}

const median = (values) => {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

async function benchModel(modelPath, opts) {
  const name = path.basename(modelPath, ".gguf");
  const app = await launch({ exe: opts.exe ?? undefined, model: modelPath, prefix: "draggy-bench-" });
  const result = { model: path.basename(modelPath), workloads: {} };
  try {
    const endpoint = await enableApi(app.page, opts.port);
    for (const workload of WORKLOADS) {
      await runOnce(endpoint, name, workload);
      const runs = [];
      for (let i = 0; i < opts.runs; i++) runs.push(await runOnce(endpoint, name, workload));
      result.workloads[workload.name] = { genTps: median(runs.map((r) => r.genTps)), wallMs: median(runs.map((r) => r.wallMs)) };
    }
  } finally {
    await app.close();
  }
  result.genTps = median(Object.values(result.workloads).map((w) => w.genTps));
  return result;
}

function compare(results, baseline, target) {
  const before = new Map(baseline.results.map((r) => [r.model, r]));
  const ratios = [];
  let regressed = false;
  for (const r of results) {
    const old = before.get(r.model);
    if (!old?.genTps || !r.genTps) continue;
    const ratio = r.genTps / old.genTps;
    ratios.push(ratio);
    if (ratio < 0.95) regressed = true;
    console.log(`${r.model.padEnd(48)} ${old.genTps.toFixed(1).padStart(7)} -> ${r.genTps.toFixed(1).padStart(7)} tok/s  x${ratio.toFixed(2)}`);
  }
  const overall = median(ratios);
  console.log(`\nMedian speed-up: x${overall?.toFixed(2) ?? "n/a"} (target x${target})${regressed ? ", with a regression over 5%" : ""}`);
  return overall !== null && overall >= target && !regressed;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const realModels = path.join(process.env.APPDATA ?? "", "Draggy", "models");
  for (const model of opts.models) {
    const file = path.basename(model);
    if (!fs.existsSync(path.join(realModels, file))) throw new Error(`${file} is not in ${realModels}`);
  }

  const results = [];
  for (const model of opts.models) {
    const r = await benchModel(path.join(realModels, path.basename(model)), opts);
    results.push(r);
    const cells = Object.entries(r.workloads).map(([name, w]) => `${name} ${w.genTps?.toFixed(1)} tok/s`).join(" | ");
    console.log(`${r.model}\n  ${cells}`);
  }

  const report = { at: new Date().toISOString(), platform: process.platform, results };
  if (opts.out) fs.writeFileSync(opts.out, JSON.stringify(report, null, 2));
  if (opts.baseline) {
    const ok = compare(results, JSON.parse(fs.readFileSync(opts.baseline, "utf8")), opts.target);
    process.exitCode = ok ? 0 : 1;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
