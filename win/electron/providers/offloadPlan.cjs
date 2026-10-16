/** How many layers of a local model to place on the GPU. Ollama estimates this itself, but on Windows
 * an estimate that runs a little over spills into slow shared memory, so a model that does not fully
 * fit is given an explicit layer count that leaves headroom. A model that fits is left to Ollama. */
const { log } = require("../logger.cjs");

const GB = 1024 ** 3;
/** Same reserve as `fitTargetMiB` in llamaProcess.cjs: the desktop and the KV cache share the card. */
const RESERVE_GB = 1.5;
const MIN_USABLE_FRACTION = 0.5;

const facts = new Map();
let vramGB = 0;
let primed = false;

/** Layers to offload, or null when the model fits whole or the sizes are unknown. */
function planNumGpu({ modelBytes, layers, vramGB: vram }) {
  if (!(modelBytes > 0) || !(layers > 0) || !(vram > 0)) return null;
  const usableGB = Math.max(vram * MIN_USABLE_FRACTION, vram - RESERVE_GB);
  const modelGB = modelBytes / GB;
  if (modelGB <= usableGB) return null;
  return Math.max(0, Math.floor(layers * (usableGB / modelGB)));
}

function remember(modelId, update) {
  const id = String(modelId || "");
  if (id) facts.set(id, { ...facts.get(id), ...update });
}

/** Sizes from `/api/tags`, which lists each model's bytes on disk. */
function rememberTags(json) {
  for (const model of json?.models || []) {
    const size = Number(model.size);
    if (size > 0) remember(model.name || model.model, { modelBytes: size });
  }
}

/** Layers from `/api/show`: the repeated blocks plus the output layer. */
function rememberShow(modelId, json) {
  const info = json?.model_info || {};
  const key = Object.keys(info).find((name) => name.endsWith(".block_count"));
  const blocks = key ? Number(info[key]) : 0;
  if (blocks > 0) remember(modelId, { layers: blocks + 1 });
}

/** Reads the card's size once, in the background; requests before it lands go out unplanned. */
function prime(detect = () => require("../platform.cjs").detectVideoMemoryGB()) {
  if (primed) return;
  primed = true;
  Promise.resolve()
    .then(detect)
    .then((value) => {
      vramGB = Number(value) > 0 ? Number(value) : 0;
    })
    .catch(log.swallowed("providers.offload", "no VRAM reading, Ollama keeps its own estimate"));
}

function numGpuFor(modelId) {
  const known = facts.get(String(modelId || ""));
  return planNumGpu({ ...known, vramGB });
}

/** Only an engine on this computer is limited by this computer's card. */
function isLocalUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function reset() {
  facts.clear();
  vramGB = 0;
  primed = false;
}

function setVram(value) {
  vramGB = value;
  primed = true;
}

module.exports = { planNumGpu, remember, rememberTags, rememberShow, prime, numGpuFor, isLocalUrl, setVram, reset };
