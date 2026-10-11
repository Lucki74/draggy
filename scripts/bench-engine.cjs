#!/usr/bin/env node
/**
 * Measures the Draggy engine on real models, launched exactly as the app launches them.
 *
 *   node scripts/bench-engine.cjs --model path/to/model.gguf [--model other.gguf]
 *        [--user-data <Draggy userData folder>] [--runs 3] [--out results.json]
 *        [--baseline previous.json] [--target 1.5] [--no-speculation]
 *
 * Each workload runs `--runs` times after one warm-up; the median generation speed is reported along
 * with prompt speed, time to first token and the draft acceptance rate. With --baseline, every model
 * is compared against an earlier run and the script fails when the median speed-up is under --target
 * or any model got more than 5% slower. --no-speculation launches without drafts or n-grams, for a
 * like-for-like baseline on the same build.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const llamaProcess = require("../electron/llamaProcess.cjs");
const binaryManager = require("../electron/binaryManager.cjs");
const platform = require("../electron/platform.cjs");

const quiet = { debug() {}, info() {}, warn: (...a) => console.warn(...a), error: (...a) => console.error(...a) };

function parseArgs(argv) {
  const opts = { models: [], runs: 3, target: 1.5, speculation: true, userData: null, out: null, baseline: null, port: 11499 };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case "--model": opts.models.push(path.resolve(next())); break;
      case "--user-data": opts.userData = path.resolve(next()); break;
      case "--runs": opts.runs = Math.max(1, Number(next()) || 3); break;
      case "--out": opts.out = path.resolve(next()); break;
      case "--baseline": opts.baseline = path.resolve(next()); break;
      case "--target": opts.target = Number(next()) || 1.5; break;
      case "--port": opts.port = Number(next()) || opts.port; break;
      case "--no-speculation": opts.speculation = false; break;
      default: throw new Error(`Unknown argument ${argv[i]}`);
    }
  }
  if (opts.models.length === 0) throw new Error("Pass at least one --model");
  return opts;
}

/** The kinds of turn Draggy runs: chat, editing code (which repeats its input), tool calls, a long prompt. */
const LONG_DOC = Array.from({ length: 400 }, (_, i) => `Line ${i}: the engine streams tokens from the model to the window.`).join("\n");
const CODE = `function total(items) {\n  let sum = 0;\n  for (const item of items) {\n    sum += item.price * item.quantity;\n  }\n  return sum;\n}\n`.repeat(6);
const WORKLOADS = [
  { name: "chat", maxTokens: 256, messages: [{ role: "user", content: "Explain how a refrigerator keeps food cold, in three paragraphs." }] },
  { name: "code-edit", maxTokens: 512, messages: [{ role: "user", content: `Rename the function to computeTotal and return the whole file unchanged otherwise:\n\n${CODE}` }] },
  {
    name: "tool-call",
    maxTokens: 128,
    messages: [{ role: "user", content: "What is the weather in Paris and in Tokyo?" }],
    tools: [{ type: "function", function: { name: "get_weather", description: "Weather for a city", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } } }],
  },
  { name: "long-prompt", maxTokens: 128, messages: [{ role: "user", content: `${LONG_DOC}\n\nSummarise the text above in one sentence.` }] },
];

async function runOnce(port, workload) {
  const started = performance.now();
  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: workload.messages,
      ...(workload.tools ? { tools: workload.tools } : {}),
      max_tokens: workload.maxTokens,
      temperature: 0,
      // Each run measures the full prompt, not a cache hit from the warm-up.
      cache_prompt: false,
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  if (!response.ok) throw new Error(`${workload.name}: HTTP ${response.status} ${await response.text()}`);
  const body = await response.json();
  const t = body.timings || {};
  return {
    genTps: t.predicted_per_second || 0,
    promptTps: t.prompt_per_second || 0,
    ttftMs: t.prompt_ms ?? null,
    wallMs: performance.now() - started,
    tokens: t.predicted_n || 0,
    draftN: t.draft_n ?? null,
    draftAccepted: t.draft_n_accepted ?? null,
  };
}

const median = (values) => {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

async function benchModel(modelPath, opts, env) {
  const start = await llamaProcess.startServer({
    binaryPath: env.binaryPath,
    userDataDir: env.userData,
    vramGB: env.vramGB,
    modelPath,
    contextSize: 16384,
    port: opts.port,
    speculative: opts.speculation,
    skipDraft: !opts.speculation,
    log: quiet,
  });
  if (!start.success) throw new Error(`${path.basename(modelPath)} did not load: ${start.error}`);
  const status = llamaProcess.getServerStatus();
  const result = { model: path.basename(modelPath), speculation: status.speculation, offload: status.offload, workloads: {} };
  try {
    for (const workload of WORKLOADS) {
      await runOnce(opts.port, workload);
      const runs = [];
      for (let i = 0; i < opts.runs; i++) runs.push(await runOnce(opts.port, workload));
      const drafted = runs.reduce((sum, r) => sum + (r.draftN || 0), 0);
      const accepted = runs.reduce((sum, r) => sum + (r.draftAccepted || 0), 0);
      result.workloads[workload.name] = {
        genTps: median(runs.map((r) => r.genTps)),
        promptTps: median(runs.map((r) => r.promptTps)),
        ttftMs: median(runs.map((r) => r.ttftMs)),
        acceptance: drafted > 0 ? accepted / drafted : null,
      };
    }
  } finally {
    llamaProcess.stopServerSync();
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
  const userData = opts.userData || fs.mkdtempSync(path.join(os.tmpdir(), "draggy-bench-"));
  const binaryPath = binaryManager.findLlamaBinary(userData);
  if (!binaryPath) throw new Error("No llama-server found: pass --user-data pointing at Draggy's data folder, or put one on PATH");
  const vramGB = await platform.detectVideoMemoryGB();
  const env = { userData, binaryPath, vramGB };
  console.log(`Engine ${binaryPath}, VRAM ${vramGB.toFixed(1)} GB, speculation ${opts.speculation ? "on" : "off"}\n`);

  const results = [];
  for (const model of opts.models) {
    const r = await benchModel(model, opts, env);
    results.push(r);
    const cells = Object.entries(r.workloads)
      .map(([name, w]) => `${name} ${w.genTps?.toFixed(1)} tok/s${w.acceptance !== null ? ` (${Math.round(w.acceptance * 100)}% accepted)` : ""}`)
      .join(" | ");
    const offload = r.offload ? `, ${r.offload.layers}/${r.offload.total} layers on GPU` : "";
    console.log(`${r.model} [${r.speculation}${offload}]\n  ${cells}\n  prompt ${r.workloads["long-prompt"].promptTps?.toFixed(0)} tok/s`);
  }

  const report = { at: new Date().toISOString(), platform: process.platform, vramGB, speculation: opts.speculation, results };
  if (opts.out) fs.writeFileSync(opts.out, JSON.stringify(report, null, 2));
  if (opts.baseline) {
    const ok = compare(results, JSON.parse(fs.readFileSync(opts.baseline, "utf8")), opts.target);
    process.exitCode = ok ? 0 : 1;
  }
}

main().catch((err) => {
  console.error(err.message);
  llamaProcess.stopServerSync();
  process.exitCode = 1;
});
