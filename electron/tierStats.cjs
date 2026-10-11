const fs = require("node:fs");
const path = require("node:path");
const { log } = require("./logger.cjs");

/**
 * What each large model has actually done on this computer: tokens per second and, when the gateway
 * reports it, the expert cache hit rate. Numbers only, never text. The planner trusts them over its
 * own estimate once enough replies have been measured.
 */
const FILE = "tier-stats.json";
const SMOOTHING = 0.3;
/** Replies measured before the plan's range is replaced by the measured one. */
const MIN_SAMPLES = 3;
/** Replies shorter than this say little about steady speed. */
const MIN_TOKENS = 16;
/** The band around a measured speed; replies vary with prompt length and cache warmth. */
const BAND = 0.25;

let store = null;
let storeDir = null;

function load(dir) {
  if (store && storeDir === dir) return store;
  storeDir = dir;
  try {
    const saved = dir && JSON.parse(fs.readFileSync(path.join(dir, FILE), "utf8"));
    store = saved && typeof saved === "object" ? saved : {};
  } catch (error) {
    // A missing file is the first run; a damaged one starts over.
    if (error?.code !== "ENOENT") log.warn("engine.tier", "tier stats unreadable, starting empty", { code: error?.code ?? error?.name ?? null });
    store = {};
  }
  return store;
}

function save() {
  if (!storeDir) return;
  try {
    fs.writeFileSync(path.join(storeDir, FILE), JSON.stringify(store));
  } catch (error) {
    log.warn("engine.tier", "tier stats not saved, measured again next run", { code: error?.code ?? null });
  }
}

const finite = (value) => (Number.isFinite(value) && value > 0 ? value : null);
const blend = (previous, next) => (previous == null ? next : previous * (1 - SMOOTHING) + next * SMOOTHING);

/** Folds one reply into the model's running averages. */
function record(dir, modelId, { tokPerSec, hitRate = null, tokens = MIN_TOKENS }) {
  const rate = finite(tokPerSec);
  if (!modelId || !rate || tokens < MIN_TOKENS) return;
  const all = load(dir);
  const prev = all[modelId] || { tokPerSec: null, hitRate: null, samples: 0 };
  const hit = Number.isFinite(hitRate) && hitRate >= 0 && hitRate <= 1 ? hitRate : null;
  all[modelId] = {
    tokPerSec: blend(prev.tokPerSec, rate),
    hitRate: hit == null ? prev.hitRate : blend(prev.hitRate, hit),
    samples: prev.samples + 1,
  };
  save();
}

/** The measured speed of a model, or null until enough replies back it. */
function observed(dir, modelId) {
  const entry = load(dir)[modelId];
  return entry && entry.samples >= MIN_SAMPLES ? entry : null;
}

const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

/** A plan whose speed range is centred on what this computer measured. */
function applyObserved(plan, entry) {
  if (!entry || !plan || plan.refusal || !plan.expectedTokPerSec) return plan;
  const rate = entry.tokPerSec;
  return {
    ...plan,
    expectedTokPerSec: [round(rate * (1 - BAND), 2), round(rate * (1 + BAND), 2)],
    ...(entry.hitRate == null ? {} : { expectedHitRate: [round(entry.hitRate, 2), round(entry.hitRate, 2)] }),
    measured: true,
  };
}

/** Hit rate from the gateway's `/experts` counts; null when it sends none we recognise. */
function hitRateFrom(experts) {
  const hits = Number(experts?.hits);
  const misses = Number(experts?.misses);
  if (!Number.isFinite(hits) || !Number.isFinite(misses) || hits < 0 || misses < 0 || hits + misses === 0) return null;
  return hits / (hits + misses);
}

/** Every model's running numbers, for the diagnostics report. */
function summary(dir) {
  return { ...load(dir) };
}

const USAGE_DIR = "colibri-usage";
const USAGE_FILE = ".coli_usage";

/** Keeps colibri's learned hot set outside the model folder, so a re-download or a moved model keeps it. */
function backupUsage(userDataDir, modelId, modelDir) {
  try {
    const source = path.join(modelDir, USAGE_FILE);
    if (!fs.existsSync(source)) return false;
    const target = path.join(userDataDir, USAGE_DIR, modelId);
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(source, path.join(target, USAGE_FILE), { recursive: true, force: true });
    return true;
  } catch (error) {
    log.warn("engine.tier", "colibri usage backup failed", { model: modelId, code: error?.code ?? null });
    return false;
  }
}

/** Puts a backed-up history back when the model folder has none. */
function restoreUsage(userDataDir, modelId, modelDir) {
  try {
    const destination = path.join(modelDir, USAGE_FILE);
    const backup = path.join(userDataDir, USAGE_DIR, modelId, USAGE_FILE);
    if (fs.existsSync(destination) || !fs.existsSync(backup)) return false;
    fs.cpSync(backup, destination, { recursive: true });
    return true;
  } catch (error) {
    log.warn("engine.tier", "colibri usage restore failed", { model: modelId, code: error?.code ?? null });
    return false;
  }
}

function resetForTests() {
  store = null;
  storeDir = null;
}

module.exports = { record, observed, summary, applyObserved, hitRateFrom, backupUsage, restoreUsage, resetForTests, MIN_SAMPLES, MIN_TOKENS };
