const fs = require("node:fs");
const path = require("node:path");
const ggufParser = require("./ggufParser.cjs");
const draftModel = require("./draftModel.cjs");
const { log: defaultLog } = require("./logger.cjs");

/**
 * Small models that share a tokenizer with a whole family, so any model of that family can draft
 * from them, not only the catalogue entries that name a draft. Generation is memory-bound: the big
 * model checks several drafted tokens in one pass for roughly the price of one, which is the largest
 * speed-up left once the weights are on the card.
 *
 * `vocab` is the draft's own vocabulary size; llama.cpp accepts a pair whose sizes differ by at most 128.
 * Null leaves the check to the engine.
 */
const FAMILY_DRAFTS = [
  {
    family: "qwen3",
    architectures: /^qwen3(moe)?$/,
    vocab: 151936,
    repo: "Qwen/Qwen3-0.6B-GGUF",
    file: "Qwen3-0.6B-Q8_0.gguf",
  },
  {
    // The ladder's own smallest rung: every Qwen 3.5 size shares its tokenizer. Its vocabulary is
    // left to the engine to check, and a refusal is remembered so it is never tried twice.
    family: "qwen3.5",
    architectures: /^qwen35(moe)?$/,
    vocab: null,
    repo: "unsloth/Qwen3.5-0.8B-GGUF",
    file: "Qwen3.5-0.8B-Q4_K_M.gguf",
  },
  {
    family: "qwen2",
    architectures: /^qwen2$/,
    vocab: 151936,
    repo: "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
    file: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
  },
  {
    family: "llama3",
    architectures: /^llama$/,
    vocab: 128256,
    repo: "bartowski/Llama-3.2-1B-Instruct-GGUF",
    file: "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
  },
  {
    family: "gemma3",
    architectures: /^gemma3$/,
    vocab: 262144,
    repo: "ggml-org/gemma-3-270m-it-GGUF",
    file: "gemma-3-270m-it-Q8_0.gguf",
  },
];

/** Most llama.cpp builds refuse a draft whose vocabulary differs by more than this. */
const MAX_VOCAB_DIFFERENCE = 128;
/** Below this a model is about as cheap to run as its draft: drafting only adds work. */
const MIN_TARGET_BYTES = 2.5 * 1024 ** 3;

/** The family draft for a model's header, or null when none shares its tokenizer. */
function familyDraftFor(header) {
  if (!header) return null;
  const vocabMatches = (entry) =>
    entry.vocab === null || (header.vocabSize > 0 && Math.abs(entry.vocab - header.vocabSize) <= MAX_VOCAB_DIFFERENCE);
  return FAMILY_DRAFTS.find((entry) => entry.architectures.test(header.architecture || "") && vocabMatches(entry)) || null;
}

/** Why a model gets no automatic draft, or null when it should have one. */
function skipReason(header, modelBytes) {
  if (!header) return "unreadable header";
  if (header.mtp) return "drafts from its own MTP heads";
  // A mixture of experts reads only its active experts per token; a dense draft rarely beats that.
  if ((header.expertCount || 0) > 1) return "mixture of experts";
  if (modelBytes < MIN_TARGET_BYTES) return "too small to gain from a draft";
  return null;
}

/** What an automatic draft for this model would be: { family, url, filename } or null. */
function planDraft(modelPath) {
  const dir = path.dirname(modelPath);
  const name = path.basename(modelPath);
  if (draftModel.isCompanionDraft(name)) return null;
  if (fs.existsSync(path.join(dir, draftModel.draftCompanionName(name)))) return null;
  let bytes;
  try {
    bytes = fs.statSync(modelPath).size;
  } catch {
    return null;
  }
  const header = ggufParser.parseGgufHeader(modelPath);
  if (skipReason(header, bytes)) return null;
  const entry = familyDraftFor(header);
  if (!entry) return null;
  return {
    family: entry.family,
    url: `https://huggingface.co/${entry.repo}/resolve/main/${entry.file}?download=true`,
    filename: draftModel.draftCompanionName(name),
  };
}

/** Fetches a family draft beside a model in the background, at most once per model per run.
 * The next load of the model picks it up; a failure only means the model keeps running without one. */
const attempted = new Set();
async function ensureFamilyDraft(modelPath, { download, log = defaultLog, isRefused = () => false } = {}) {
  if (attempted.has(modelPath) || isRefused(modelPath)) return null;
  const plan = planDraft(modelPath);
  if (!plan) return null;
  attempted.add(modelPath);
  const began = Date.now();
  try {
    const model = path.basename(modelPath);
    log?.info("engine.draft", "fetch started", { family: plan.family, model });
    await download({ url: plan.url, modelsDir: path.dirname(modelPath), filename: plan.filename });
    log?.info("engine.draft", "fetch done, used from next load", { family: plan.family, model, durMs: Date.now() - began });
    return plan;
  } catch (err) {
    log?.warn("engine.draft", "fetch failed", { family: plan.family, model: path.basename(modelPath), durMs: Date.now() - began, error: err?.name ?? null, code: err?.code ?? null });
    return null;
  }
}

function resetForTests() {
  attempted.clear();
}

module.exports = { FAMILY_DRAFTS, familyDraftFor, skipReason, planDraft, ensureFamilyDraft, resetForTests };
