/**
 * Voice bench: how the talk pipeline cuts replies, and how rendered audio holds together.
 *
 *   node scripts/voice-bench.mjs [--lang en,fr,es,ru] [--engine neural] [--wav <dir>] [--out scratch/voice-bench]
 *
 * 1. Every reply in scripts/voice-bench/corpus.<lang>.json goes through the production chunker, a few
 *    characters at a time like streamed tokens, and the fragments are written to <out>/fragments.json.
 * 2. With --wav, audio rendered by any engine is measured. Name each file <replyId>-<n>.wav, with n the
 *    fragment number from fragments.json starting at 1 (mono PCM16 or float32). Per reply it reports
 *    the largest sample step at a join (after the production trim and fades), the loudness spread
 *    between fragments in LU, and the true peak, then a Markdown summary.
 *
 * Rendering is left to the engine under test; this script only measures. Speaker drift, round-trip WER
 * and predicted MOS need extra ONNX models and are not here. Only numbers are written, no audio.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const opts = { langs: ["en", "fr", "es", "ru"], engine: "neural", wav: null, out: path.join(root, "scratch", "voice-bench") };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    if (argv[i] === "--lang") opts.langs = next().split(",");
    else if (argv[i] === "--engine") opts.engine = next();
    else if (argv[i] === "--wav") opts.wav = path.resolve(next());
    else if (argv[i] === "--out") opts.out = path.resolve(next());
  }
  return opts;
}

/** Mono samples and sample rate from a PCM16 or float32 WAV. */
export function readWav(file) {
  const buffer = fs.readFileSync(file);
  let offset = 12;
  let format = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      format = { tag: buffer.readUInt16LE(body), channels: buffer.readUInt16LE(body + 2), rate: buffer.readUInt32LE(body + 4), bits: buffer.readUInt16LE(body + 14) };
    } else if (id === "data" && format) {
      const bytes = format.bits / 8;
      const frames = Math.floor(size / bytes / format.channels);
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        const at = body + i * bytes * format.channels;
        samples[i] = format.tag === 3 ? buffer.readFloatLE(at) : buffer.readInt16LE(at) / 32768;
      }
      return { samples, rate: format.rate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error(`no audio in ${file}`);
}

/** Peak of a 4x linearly interpolated copy: a cheap stand-in for true peak, within a fraction of a dB. */
export function truePeak(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length - 1; i++) {
    for (let k = 0; k < 4; k++) peak = Math.max(peak, Math.abs(samples[i] + ((samples[i + 1] - samples[i]) * k) / 4));
  }
  return peak;
}

const db = (value) => 20 * Math.log10(Math.max(value, 1e-9));
const median = (values) => (values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : null);
const spread = (values) => (values.length > 1 ? Math.max(...values) - Math.min(...values) : 0);

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const server = await createServer({ root, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
  try {
    const { createSentenceChunker } = await server.ssrLoadModule("/src/voice/chunker.ts");
    const { prepareFragment } = await server.ssrLoadModule("/src/voice/joins.ts");
    const { integratedLoudness } = await server.ssrLoadModule("/src/voice/loudness.ts");

    const fragments = {};
    for (const lang of opts.langs) {
      const corpus = JSON.parse(fs.readFileSync(path.join(root, "scripts", "voice-bench", `corpus.${lang}.json`), "utf8"));
      for (const reply of corpus) {
        const chunker = createSentenceChunker(lang);
        const out = [];
        for (let i = 0; i < reply.text.length; i += 3) out.push(...chunker.pushFragments(reply.text.slice(i, i + 3)));
        const rest = chunker.flushFragment();
        if (rest) out.push(rest);
        fragments[reply.id] = { lang, category: reply.category, fragments: out };
      }
    }
    fs.mkdirSync(opts.out, { recursive: true });
    fs.writeFileSync(path.join(opts.out, "fragments.json"), JSON.stringify(fragments, null, 2));

    const rows = [];
    if (opts.wav) {
      for (const [id, entry] of Object.entries(fragments)) {
        const audio = entry.fragments.map((_, n) => {
          const file = path.join(opts.wav, `${id}-${n + 1}.wav`);
          return fs.existsSync(file) ? readWav(file) : null;
        });
        if (audio.some((item) => !item)) continue;
        const prepared = audio.map((item, n) => prepareFragment(item.samples, item.rate, entry.fragments[n].boundary, entry.fragments[n].text, 1).samples);
        const steps = prepared.slice(1).map((samples, n) => Math.abs(prepared[n][prepared[n].length - 1] - samples[0]));
        const levels = audio.map((item) => integratedLoudness(item.samples, item.rate)).filter(Number.isFinite);
        rows.push({
          id,
          category: entry.category,
          fragments: entry.fragments.length,
          seamMaxStep: steps.length ? Math.max(...steps) : 0,
          loudnessSpreadLU: spread(levels),
          truePeakDbfs: db(Math.max(...audio.map((item) => truePeak(item.samples)))),
        });
      }
    }

    const report = { engine: opts.engine, replies: Object.keys(fragments).length, measured: rows.length, rows };
    fs.writeFileSync(path.join(opts.out, "report.json"), JSON.stringify(report, null, 2));

    const all = Object.values(fragments);
    const sizes = all.flatMap((entry) => entry.fragments.map((fragment) => fragment.text.length));
    const lines = [
      `# Voice bench: ${opts.engine}`,
      "",
      `Replies cut: ${report.replies}. Fragments: ${sizes.length}. Median fragment: ${median(sizes)} characters. Longest: ${Math.max(...sizes)}.`,
      "",
    ];
    if (rows.length) {
      lines.push("| Metric | Median | Worst | Gate |", "|---|---|---|---|");
      const col = (key) => rows.map((row) => row[key]);
      lines.push(`| Seam step | ${median(col("seamMaxStep")).toFixed(3)} | ${Math.max(...col("seamMaxStep")).toFixed(3)} | under 0.05 |`);
      lines.push(`| Loudness spread (LU) | ${median(col("loudnessSpreadLU")).toFixed(1)} | ${Math.max(...col("loudnessSpreadLU")).toFixed(1)} | see plan G6 |`);
      lines.push(`| True peak (dBFS) | ${median(col("truePeakDbfs")).toFixed(1)} | ${Math.max(...col("truePeakDbfs")).toFixed(1)} | at most -1 |`);
    } else {
      lines.push("No audio measured. Pass --wav <dir> with rendered fragments to add join, loudness and peak numbers.");
    }
    fs.writeFileSync(path.join(opts.out, "report.md"), lines.join("\n") + "\n");
    console.log(lines.join("\n"));
  } finally {
    await server.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
