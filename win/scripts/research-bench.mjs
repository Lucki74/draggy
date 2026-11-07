#!/usr/bin/env node
/**
 * Research bench, replay mode: runs the 40 multi-hop questions against a model whose search_web and
 * read_url come from the fixed corpus in shared/fixtures/research-bench/corpus. Run it by hand only.
 *
 *   node scripts/research-bench.mjs --endpoint http://127.0.0.1:8080/v1 --model name [--api-key KEY]
 *        [--grader-model name] [--ids m01,m02] [--limit 5] [--max-steps 12] [--out scratch/research-bench/<name>]
 *
 * The endpoint is any OpenAI-compatible chat API with tool calling, local llama-server or cloud.
 * Replies stay under scratch/ and are never committed; summary.md holds only numbers.
 * Offline metrics: accuracy (model grader), citation precision (quote found in the cited page),
 * citation recall (sentences with a marker), sources per report, tool calls, wall time.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCorpus, replayApi } from "./research-bench/replay.mjs";
import { citationPrecision, citationRecall, fillTemplate, mean, parseAnswer, parseVerdict } from "./research-bench/metrics.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.resolve(root, "../shared/fixtures/research-bench");

const SYSTEM = [
  "You are a research assistant. Answer the question using only the tools search_web and read_url.",
  "Search, read the pages you need, and prefer the newest source when pages disagree.",
  "When you have the answer, reply with a short answer in which every fact carries a marker like [1].",
  'Then add a line "Sources:" and one line per marker: [1] URL "an exact quote copied from that page".',
].join(" ");

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search and return a list of results with titles, URLs and snippets.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
  },
  {
    type: "function",
    function: {
      name: "read_url",
      description: "Read a web page as Markdown.",
      parameters: { type: "object", properties: { url: { type: "string" }, page: { type: "integer" } }, required: ["url"] },
    },
  },
];

function parseArgs(argv) {
  const o = { maxSteps: 12, limit: Infinity, ids: null, apiKey: process.env.DRAGGY_BENCH_API_KEY ?? "" };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case "--endpoint": o.endpoint = next().replace(/\/$/, ""); break;
      case "--model": o.model = next(); break;
      case "--grader-model": o.graderModel = next(); break;
      case "--api-key": o.apiKey = next(); break;
      case "--ids": o.ids = next().split(","); break;
      case "--limit": o.limit = Number(next()); break;
      case "--max-steps": o.maxSteps = Number(next()); break;
      case "--out": o.out = path.resolve(next()); break;
      default: throw new Error(`unknown argument ${argv[i]}`);
    }
  }
  if (!o.endpoint || !o.model) throw new Error("--endpoint and --model are required");
  o.graderModel ??= o.model;
  o.out ??= path.join(root, "scratch", "research-bench", o.model.replace(/[^\w.-]+/g, "_"));
  return o;
}

async function chat(o, body) {
  const headers = { "Content-Type": "application/json", ...(o.apiKey ? { Authorization: `Bearer ${o.apiKey}` } : {}) };
  const response = await fetch(`${o.endpoint}/chat/completions`, { method: "POST", headers, body: JSON.stringify({ temperature: 0, ...body }) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

const hits = (results) =>
  results.map((r, i) => `[Result #${i + 1}] ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`).join("\n\n") || "No results.";

async function callTool(api, name, args) {
  if (name === "search_web") return hits((await api.searchWebDetailed(String(args.query ?? ""))).results);
  if (name === "read_url") {
    const page = await api.readUrl(String(args.url ?? ""), Number(args.page) || 1);
    if (page.blocked) return page.reason;
    return `Title: ${page.title}\nPublished: ${page.published}\nContent:\n${page.text}${page.pageNote ? `\n${page.pageNote}` : ""}`;
  }
  return `Unknown tool ${name}.`;
}

async function runQuestion(o, corpus, q) {
  const log = [];
  const api = replayApi(corpus, log);
  const messages = [{ role: "system", content: SYSTEM }, { role: "user", content: q.question }];
  const started = Date.now();
  let answer = "";
  for (let step = 0; step < o.maxSteps; step++) {
    const reply = (await chat(o, { model: o.model, messages, tools: TOOLS })).choices[0].message;
    messages.push(reply);
    if (!reply.tool_calls?.length) { answer = reply.content ?? ""; break; }
    for (const call of reply.tool_calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* an unreadable call gets an empty argument set */ }
      messages.push({ role: "tool", tool_call_id: call.id, content: await callTool(api, call.function.name, args) });
    }
  }
  return { answer, log, wallMs: Date.now() - started };
}

async function grade(o, template, q, body) {
  const prompt = fillTemplate(template, { question: q.question, gold: [q.gold, ...(q.acceptable ?? [])].join(" | "), answer: body });
  const reply = await chat(o, { model: o.graderModel, messages: [{ role: "user", content: prompt }] });
  return parseVerdict(reply.choices[0].message.content ?? "");
}

const pct = (n, d) => (d === 0 ? "n/a" : `${Math.round((100 * n) / d)}% (${n}/${d})`);

function summarize(records, meta) {
  const ok = records.filter((r) => !r.error);
  const sum = (f) => ok.reduce((a, r) => a + f(r), 0);
  return [
    `# Research bench (replay): ${meta.model}`, "", `${ok.length} of ${records.length} questions finished; ${meta.at}.`, "",
    "| metric | value |", "|---|---|",
    `| accuracy (correct) | ${pct(ok.filter((r) => r.verdict === "correct").length, ok.length)} |`,
    `| accuracy (correct or partial) | ${pct(ok.filter((r) => r.verdict !== "incorrect").length, ok.length)} |`,
    `| citation precision | ${pct(sum((r) => r.precision.supported), sum((r) => r.precision.total))} |`,
    `| citation recall | ${pct(sum((r) => r.recall.cited), sum((r) => r.recall.total))} |`,
    `| sources per report | ${mean(ok.map((r) => r.sources))?.toFixed(2) ?? "n/a"} |`,
    `| gold pages read | ${pct(sum((r) => r.goldRead), sum((r) => r.goldTotal))} |`,
    `| tool calls per question | ${mean(ok.map((r) => r.toolCalls))?.toFixed(1) ?? "n/a"} |`,
    `| wall time per question (s) | ${mean(ok.map((r) => r.wallMs / 1000))?.toFixed(1) ?? "n/a"} |`,
    `| request errors | ${records.length - ok.length} |`, "",
  ].join("\n");
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const corpus = loadCorpus();
  const graders = JSON.parse(fs.readFileSync(path.join(fixtures, "graders.json"), "utf8"));
  const all = JSON.parse(fs.readFileSync(path.join(fixtures, "questions.json"), "utf8")).filter((q) => q.kind === "multihop");
  const questions = all.filter((q) => !o.ids || o.ids.includes(q.id)).slice(0, o.limit);
  fs.mkdirSync(o.out, { recursive: true });
  const records = [];
  for (const q of questions) {
    try {
      const run = await runQuestion(o, corpus, q);
      const { body, citations } = parseAnswer(run.answer);
      const read = new Set(run.log.filter((l) => l.tool === "read_url").map((l) => l.url));
      records.push({
        id: q.id,
        verdict: await grade(o, graders.accuracy, q, body),
        precision: citationPrecision(citations, corpus),
        recall: citationRecall(body),
        sources: new Set(citations.map((c) => c.url)).size,
        goldRead: q.goldPages.filter((u) => read.has(u)).length,
        goldTotal: q.goldPages.length,
        toolCalls: run.log.length,
        wallMs: run.wallMs,
        answer: run.answer,
      });
    } catch (error) {
      records.push({ id: q.id, error: String(error.message ?? error) });
    }
    console.log(q.id, records.at(-1).verdict ?? records.at(-1).error);
  }
  const meta = { model: o.model, at: new Date().toISOString() };
  fs.writeFileSync(path.join(o.out, "results.json"), JSON.stringify({ ...meta, records }, null, 2));
  fs.writeFileSync(path.join(o.out, "summary.md"), summarize(records, meta));
  console.log(`\nWrote ${path.join(o.out, "summary.md")}`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
