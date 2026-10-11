const fs = require("node:fs");
const path = require("node:path");
const { log } = require("./logger.cjs");

/**
 * How well each model's draft has guessed, from llama-server's own report at the end of every reply,
 * kept across runs. A draft that is mostly rejected costs more than it saves, and one that is mostly
 * accepted can be asked for longer runs, so the draft settings follow what was measured.
 */
const FILE = "draft-stats.json";
/** Weight of the newest reply in the running average. */
const SMOOTHING = 0.3;
/** Replies measured before a verdict is trusted. */
const MIN_SAMPLES = 3;
/** Below this acceptance rate the draft slows generation down. */
const DISABLE_BELOW = 0.3;

/** llama-server: "draft acceptance rate = 0.62857 (   44 accepted /    70 generated)". */
const ACCEPTANCE_LINE = /draft acceptance rate\s*=\s*([\d.]+)\s*\(\s*(\d+)\s*accepted\s*\/\s*(\d+)\s*generated/i;

function parseAcceptance(line) {
  const match = ACCEPTANCE_LINE.exec(String(line || ""));
  if (!match) return null;
  const generated = Number(match[3]);
  if (!(generated > 0)) return null;
  return { rate: Number(match[2]) / generated, accepted: Number(match[2]), generated };
}

let store = null;
let storeDir = null;

function load(dir) {
  if (store && storeDir === dir) return store;
  storeDir = dir;
  try {
    const saved = dir && JSON.parse(fs.readFileSync(path.join(dir, FILE), "utf8"));
    store = saved && typeof saved === "object" ? saved : {};
  } catch {
    store = {};
  }
  return store;
}

function save() {
  if (!storeDir) return;
  try {
    fs.writeFileSync(path.join(storeDir, FILE), JSON.stringify(store));
  } catch (error) {
    log.swallow("files", error, "measured again next run");
  }
}

const keyOf = (modelPath) => path.basename(String(modelPath)).toLowerCase();

/** Folds one reply's acceptance into the model's running average. */
function record(dir, modelPath, sample) {
  if (!sample || !(sample.generated > 0)) return;
  const all = load(dir);
  const key = keyOf(modelPath);
  const prev = all[key] || { rate: sample.rate, samples: 0 };
  all[key] = {
    ...prev,
    rate: prev.samples === 0 ? sample.rate : prev.rate * (1 - SMOOTHING) + sample.rate * SMOOTHING,
    samples: prev.samples + 1,
  };
  save();
}

/** Remembers that the engine would not load this model's draft, so it is not fetched or tried again. */
function recordRefusal(dir, modelPath) {
  const all = load(dir);
  const key = keyOf(modelPath);
  all[key] = { ...(all[key] || { rate: 0, samples: 0 }), refused: true };
  save();
}

function isRefused(dir, modelPath) {
  return Boolean(load(dir)[keyOf(modelPath)]?.refused);
}

/** The draft settings for a model: whether to use its draft at all, and how many tokens to draft. */
function draftSettings(dir, modelPath) {
  const entry = load(dir)[keyOf(modelPath)];
  if (!entry || entry.samples < MIN_SAMPLES) return { enabled: !entry?.refused, max: 8, rate: entry?.rate ?? null };
  if (entry.refused || entry.rate < DISABLE_BELOW) return { enabled: false, max: 0, rate: entry.rate };
  const max = entry.rate >= 0.8 ? 16 : entry.rate >= 0.6 ? 12 : entry.rate >= 0.45 ? 8 : 4;
  return { enabled: true, max, rate: entry.rate };
}

function resetForTests() {
  store = null;
  storeDir = null;
}

module.exports = { parseAcceptance, record, recordRefusal, isRefused, draftSettings, resetForTests, DISABLE_BELOW, MIN_SAMPLES };
