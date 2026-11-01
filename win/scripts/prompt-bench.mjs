#!/usr/bin/env node
/**
 * Prompt bench: runs a per-language corpus against a model with the production prompt builders.
 *
 *   node scripts/prompt-bench.mjs --model path/to/model.gguf [--tier compact|full] [--variant name]
 *        [--lang en,fr,es,ru] [--runs 3] [--seed 1000] [--out scratch/prompt-bench/<name>]
 *        [--user-data <Draggy userData>] [--ctx 8192] [--max-tokens 1024] [--group a,b]
 *   node scripts/prompt-bench.mjs --endpoint http://host/v1 --api-key KEY --name label [--caps tools,thinking]
 *   node scripts/prompt-bench.mjs --sizes            prompt token sizes only, no model
 *   node scripts/prompt-bench.mjs --report dirA dirB combine results.json files into a markdown table
 *
 * Cases are judged by check functions (scripts/prompt-bench/checks.mjs), not reference answers.
 * Replies stay under scratch/prompt-bench/ and are never committed; summary.md holds only numbers.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "vite";
import { runCheck, mentionsClock, clockShare } from "./prompt-bench/checks.mjs";
import { loadHarness } from "./prompt-bench/harness.mjs";
import { pct, summarize } from "./prompt-bench/summary.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const benchDir = path.join(root, "scripts", "prompt-bench");
const LANGS = ["en", "fr", "es", "ru"];

function parseArgs(argv) {
  const o = { tier: "compact", langs: LANGS, runs: 3, seed: 1000, ctx: 8192, maxTokens: 1024, port: 11499, caps: null, groups: null, report: [] };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case "--model": o.model = path.resolve(next()); break;
      case "--endpoint": o.endpoint = next().replace(/\/$/, ""); break;
      case "--api-key": o.apiKey = next(); break;
      case "--name": o.name = next(); break;
      case "--caps": o.caps = next().split(","); break;
      case "--tier": o.tier = next(); break;
      case "--variant": o.variant = next(); break;
      case "--lang": o.langs = next().split(","); break;
      case "--group": o.groups = next().split(","); break;
      case "--runs": o.runs = Math.max(1, Number(next()) || 3); break;
      case "--seed": o.seed = Number(next()) || 1000; break;
      case "--ctx": o.ctx = Number(next()) || 8192; break;
      case "--max-tokens": o.maxTokens = Number(next()) || 400; break;
      case "--port": o.port = Number(next()) || 11499; break;
      case "--out": o.out = path.resolve(next()); break;
      case "--user-data": o.userData = path.resolve(next()); break;
      case "--sizes": o.sizes = true; break;
      case "--report": o.reportMode = true; break;
      default:
        if (o.reportMode) o.report.push(path.resolve(argv[i]));
        else throw new Error(`Unknown argument ${argv[i]}`);
    }
  }
  return o;
}

async function chat(base, headers, body) {
  const response = await fetch(`${base}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

async function printSizes(harness) {
  const rows = [];
  const caps = ["tools", "thinking"];
  for (const tier of ["compact", "full"]) {
    for (const surface of ["chat", "code"]) {
      for (const web of ["auto", "on", "off"]) {
        for (const thinking of ["low", "medium", "high"]) {
          const built = harness.buildCase({ surface, tier, caps, turns: [{ role: "user", content: "hi" }], lang: "en", settings: { webMode: web, effort: thinking } });
          const tools = JSON.stringify(built.definitions).length;
          rows.push({ tier, surface, web, thinking, systemTokens: Math.round(built.system.length / 4), toolTokens: Math.round(tools / 4) });
        }
      }
    }
  }
  console.log("| tier | surface | web | thinking | system tokens | tool-definition tokens |\n|---|---|---|---|---|---|");
  for (const r of rows) console.log(`| ${r.tier} | ${r.surface} | ${r.web} | ${r.thinking} | ${r.systemTokens} | ${r.toolTokens} |`);
  return rows;
}

function report(dirs) {
  const rows = dirs.map((d) => ({ dir: d, ...JSON.parse(fs.readFileSync(path.join(d, "results.json"), "utf8")) }));
  const groups = [...new Set(rows.flatMap((r) => r.records.map((x) => x.group)))];
  const out = [`| run | ${groups.join(" | ")} |`, `|---|${groups.map(() => "---").join("|")}|`];
  for (const r of rows) {
    const cells = groups.map((g) => {
      const rs = r.records.filter((x) => x.group === g && !x.error);
      return rs.length ? pct(rs.filter((x) => x.pass).length, rs.length) : "-";
    });
    out.push(`| ${r.meta.name} (${r.meta.tier}${r.meta.variant ? `/${r.meta.variant}` : ""}) | ${cells.join(" | ")} |`);
  }
  console.log(out.join("\n"));
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.reportMode) return report(o.report);

  const server = await createServer({ root, logLevel: "error", server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  let llama = null;
  try {
    const harness = await loadHarness(server);
    if (o.sizes) return await printSizes(harness);

    let variant = null;
    if (o.variant) variant = (await import(pathToFileURL(path.join(benchDir, "variants", `${o.variant}.mjs`)).href)).default;

    let base, headers = { "Content-Type": "application/json" }, caps, name;
    if (o.model) {
      const ggufParser = require("../electron/ggufParser.cjs");
      const llamaProcess = require("../electron/llamaProcess.cjs");
      const binaryManager = require("../electron/binaryManager.cjs");
      const platform = require("../electron/platform.cjs");
      caps = o.caps ?? ggufParser.capabilitiesFromTemplate(ggufParser.readChatTemplate(o.model));
      name = o.name ?? path.basename(o.model, ".gguf");
      const userData = o.userData ?? path.join(process.env.APPDATA ?? os.homedir(), "Draggy");
      const binaryPath = binaryManager.findLlamaBinary(userData);
      if (!binaryPath) throw new Error("No llama-server found: pass --user-data");
      const quiet = { debug() {}, info() {}, warn: console.warn, error: console.error };
      const start = await llamaProcess.startServer({
        binaryPath, userDataDir: userData, vramGB: await platform.detectVideoMemoryGB(), modelPath: o.model,
        contextSize: o.ctx, port: o.port, speculative: false, skipDraft: true, log: quiet,
      });
      if (!start.success) throw new Error(`${name} did not load: ${start.error}`);
      llama = llamaProcess;
      base = `http://127.0.0.1:${o.port}/v1`;
    } else if (o.endpoint) {
      base = o.endpoint;
      name = o.name ?? o.endpoint;
      caps = o.caps ?? ["tools"];
      if (o.apiKey) headers.Authorization = `Bearer ${o.apiKey}`;
    } else throw new Error("Pass --model, --endpoint, --sizes or --report");

    const out = o.out ?? path.join(root, "scratch", "prompt-bench", `${name}-${o.tier}${o.variant ? `-${o.variant}` : ""}`);
    fs.mkdirSync(out, { recursive: true });
    const records = [];
    const at = new Date().toISOString();
    console.log(`${name} [${caps.join(",") || "no caps"}] tier ${o.tier}`);

    for (const lang of o.langs) {
      const corpus = JSON.parse(fs.readFileSync(path.join(benchDir, `corpus.${lang}.json`), "utf8"));
      for (const item of corpus) {
        if (o.groups && !o.groups.includes(item.group)) continue;
        if (item.needs === "tools" && !caps.includes("tools") && !caps.includes("textTools")) { /* text-mode catalogue still applies */ }
        const surface = item.surface ?? "chat";
        for (let run = 0; run < o.runs; run++) {
          const built = harness.buildCase({ surface, tier: o.tier, caps, turns: item.turns, lang, variant });
          const body = {
            messages: built.messages, temperature: 0.7, seed: o.seed + run, max_tokens: o.maxTokens, stream: false,
            ...(built.definitions.length ? { tools: built.definitions } : {}),
            ...(built.thinkingFlag !== null && o.model ? { chat_template_kwargs: { enable_thinking: built.thinkingFlag } } : {}),
            ...(o.model ? { cache_prompt: true } : { model: name }),
          };
          const record = { id: item.id, group: item.group, lang, run };
          try {
            const res = await chat(base, headers, body);
            const message = res.choices?.[0]?.message ?? {};
            const reply = message.content ?? "";
            const toolCalls = harness.readToolCalls(message);
            const ctx = { reply, lang, now: new Date(), toolCalls, requiredArgs: harness.requiredArgs };
            const results = item.checks.map((spec) => runCheck(spec, ctx));
            Object.assign(record, {
              pass: results.every((r) => r.pass),
              failed: results.filter((r) => !r.pass).map((r) => r.type),
              clockEcho: clockShare(reply) >= 0.5,
              clockMention: mentionsClock(reply),
              wrongLanguage: results.some((r) => r.type === "sameLanguage" && !r.pass),
              falseRefusal: results.some((r) => r.type === "noRefusal" && !r.pass),
              creator: results.some((r) => r.type === "noCreatorMention" && !r.pass),
              promptTokens: res.usage?.prompt_tokens,
              outputTokens: res.usage?.completion_tokens,
              ttftMs: res.timings?.prompt_ms,
              reply,
            });
          } catch (err) {
            record.error = String(err.message ?? err);
          }
          records.push(record);
        }
      }
      console.log(`  ${lang}: ${records.filter((r) => r.lang === lang && r.pass).length}/${records.filter((r) => r.lang === lang).length} passed`);
    }

    const meta = { name, tier: o.tier, variant: o.variant ?? null, runs: o.runs, seed: o.seed, langs: o.langs, caps, at };
    fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ meta, records }, null, 1));
    // The summary carries numbers only; replies never leave results.json under scratch/.
    const summary = summarize(records, meta);
    fs.writeFileSync(path.join(out, "summary.md"), summary);
    console.log(`\n${summary}\nWritten to ${out}`);
  } finally {
    llama?.stopServerSync();
    await server.close();
  }
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exitCode = 1;
});
