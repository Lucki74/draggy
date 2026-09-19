const { log } = require("./logger.cjs");
const urlPolicy = require("./urlPolicy.cjs");

/** Curated registry of premier open models from Hugging Face matching Draggy's download card design. */
const CURATED_MODELS = [
  {
    name: "llama3.1",
    description: "Llama 3.1 is a state-of-the-art model from Meta available in 8B and 70B parameter sizes.",
    capabilities: ["tools", "completion"],
    sizes: ["8b", "70b"],
    variants: {
      "8b": {
        repo: "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF",
        file: "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
        bytes: 4920733696,
      },
      "70b": {
        repo: "bartowski/Meta-Llama-3.1-70B-Instruct-GGUF",
        file: "Meta-Llama-3.1-70B-Instruct-Q4_K_M.gguf",
        bytes: 42520000000,
      },
    },
  },
  {
    name: "llama3.2",
    description: "Llama 3.2 is Meta's lightweight model family tuned for high-speed local inference.",
    capabilities: ["tools", "completion"],
    sizes: ["1b", "3b"],
    variants: {
      "1b": {
        repo: "bartowski/Llama-3.2-1B-Instruct-GGUF",
        file: "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
        bytes: 807694464,
      },
      "3b": {
        repo: "bartowski/Llama-3.2-3B-Instruct-GGUF",
        file: "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
        bytes: 2020000000,
      },
    },
  },
  {
    name: "deepseek-r1",
    description: "DeepSeek-R1 is a family of open reasoning models with performance approaching leading frontier models.",
    capabilities: ["tools", "thinking", "completion"],
    sizes: ["1.5b", "7b", "8b", "14b", "32b", "70b"],
    variants: {
      "1.5b": {
        repo: "bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF",
        file: "DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf",
        bytes: 1120000000,
      },
      "7b": {
        repo: "bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF",
        file: "DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf",
        bytes: 4680000000,
      },
      "8b": {
        repo: "bartowski/DeepSeek-R1-Distill-Llama-8B-GGUF",
        file: "DeepSeek-R1-Distill-Llama-8B-Q4_K_M.gguf",
        bytes: 4920000000,
      },
      "14b": {
        repo: "bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF",
        file: "DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf",
        bytes: 8990000000,
      },
      "32b": {
        repo: "bartowski/DeepSeek-R1-Distill-Qwen-32B-GGUF",
        file: "DeepSeek-R1-Distill-Qwen-32B-Q4_K_M.gguf",
        bytes: 19900000000,
      },
      "70b": {
        repo: "bartowski/DeepSeek-R1-Distill-Llama-70B-GGUF",
        file: "DeepSeek-R1-Distill-Llama-70B-Q4_K_M.gguf",
        bytes: 42500000000,
      },
    },
  },
  {
    name: "qwen2.5",
    description: "Qwen 2.5 is Alibaba's flagship series with exceptional strength in coding, math and instruction following.",
    capabilities: ["tools", "completion"],
    sizes: ["0.5b", "1.5b", "3b", "7b", "14b", "32b"],
    variants: {
      "0.5b": {
        repo: "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
        file: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
        bytes: 398000000,
      },
      "1.5b": {
        repo: "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
        file: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
        bytes: 986000000,
      },
      "3b": {
        repo: "Qwen/Qwen2.5-3B-Instruct-GGUF",
        file: "qwen2.5-3b-instruct-q4_k_m.gguf",
        bytes: 1930000000,
      },
      "7b": {
        repo: "Qwen/Qwen2.5-7B-Instruct-GGUF",
        file: "qwen2.5-7b-instruct-q4_k_m.gguf",
        bytes: 4680000000,
      },
      "14b": {
        repo: "Qwen/Qwen2.5-14B-Instruct-GGUF",
        file: "qwen2.5-14b-instruct-q4_k_m.gguf",
        bytes: 8990000000,
      },
      "32b": {
        repo: "Qwen/Qwen2.5-32B-Instruct-GGUF",
        file: "qwen2.5-32b-instruct-q4_k_m.gguf",
        bytes: 19900000000,
      },
    },
  },
  {
    name: "phi-4",
    description: "Phi-4 is Microsoft's 14B state-of-the-art synthetic data reasoning model with exceptional STEM performance.",
    capabilities: ["tools", "completion"],
    sizes: ["14b"],
    variants: {
      "14b": {
        repo: "bartowski/phi-4-GGUF",
        file: "phi-4-Q4_K_M.gguf",
        bytes: 9140000000,
      },
    },
  },
  {
    name: "mistral",
    description: "Mistral 7B Instruct v0.3 is a fast, capable general-purpose model with native function calling.",
    capabilities: ["tools", "completion"],
    sizes: ["7b"],
    variants: {
      "7b": {
        repo: "bartowski/Mistral-7B-Instruct-v0.3-GGUF",
        file: "Mistral-7B-Instruct-v0.3-Q4_K_M.gguf",
        bytes: 4370000000,
      },
    },
  },
  {
    name: "gemma-2",
    description: "Gemma 2 is Google's lightweight open model family built from Gemini research.",
    capabilities: ["tools", "completion"],
    sizes: ["2b", "9b", "27b"],
    variants: {
      "2b": {
        repo: "bartowski/gemma-2-2b-it-GGUF",
        file: "gemma-2-2b-it-Q4_K_M.gguf",
        bytes: 1630000000,
      },
      "9b": {
        repo: "bartowski/gemma-2-9b-it-GGUF",
        file: "gemma-2-9b-it-Q4_K_M.gguf",
        bytes: 5880000000,
      },
      "27b": {
        repo: "bartowski/gemma-2-27b-it-GGUF",
        file: "gemma-2-27b-it-Q4_K_M.gguf",
        bytes: 16800000000,
      },
    },
  },
  {
    name: "nomic-embed-text",
    description: "A high-performing open embedding model with a large token context window.",
    capabilities: ["embedding"],
    sizes: ["v1.5"],
    variants: {
      "v1.5": {
        repo: "nomic-ai/nomic-embed-text-v1.5-GGUF",
        file: "nomic-embed-text-v1.5.Q4_K_M.gguf",
        bytes: 274000000,
      },
    },
  },
];

const sizeCache = new Map();
const filesCache = new Map();

const FALLBACK_SIZES = ["Q4_K_M", "Q5_K_M", "Q8_0"];
const PREFERRED_QUANTS = [
  "Q4_K_M", "Q5_K_M", "Q8_0", "Q4_0", "Q6_K", "Q4_K_S", "Q5_K_S", "Q3_K_M", "IQ4_XS", "IQ3_M",
  "IQ2_S", "IQ2_XS", "IQ3_S", "IQ3_XXS", "Q2_0", "PQ2_0", "PTQ1_0", "BF16", "F16",
];
const MAX_LISTED_QUANTS = 5;
const QUANT_PATTERN = /(?:^|[-_.])([iI]?[qQ][0-9][a-zA-Z0-9_]*|[fF]16|[bB][fF]16|[fF]32|[pP][tT]?[qQ][0-9][a-zA-Z0-9_]*)(?:[-_.]|$)/;
const SHARD_PATTERN = /-[0-9]{5}-of-[0-9]{5}\.gguf$|\.part[0-9]+of[0-9]+\.gguf$/i;

/** Projector and importance-matrix files ship beside the weights but are not models to run. */
function isModelFile(filePath) {
  const lower = typeof filePath === "string" ? filePath.toLowerCase() : "";
  return lower.endsWith(".gguf") && !lower.includes("mmproj") && !lower.includes("imatrix");
}

/** Reads the quantization from the file name, then from its folders when the name carries none. */
function extractQuant(filePath) {
  const segments = String(filePath).split("/");
  const name = segments.pop().replace(/\.gguf$/i, "").replace(/\.part[0-9]+of[0-9]+$/i, "").replace(/-[0-9]{5}-of-[0-9]{5}$/i, "");
  for (const segment of [name, ...segments.reverse()]) {
    const found = QUANT_PATTERN.exec(segment);
    if (found) return found[1].toUpperCase();
  }
  return "";
}

/** Lists the quantizations a repo really has, so the picker never offers one that cannot be downloaded. */
function extractAvailableSizes(siblings) {
  const found = new Set();
  for (const sibling of Array.isArray(siblings) ? siblings : []) {
    if (!isModelFile(sibling?.rfilename)) continue;
    const quant = extractQuant(sibling.rfilename);
    if (quant) found.add(quant);
  }
  if (found.size === 0) return [...FALLBACK_SIZES];

  const preferred = PREFERRED_QUANTS.filter((quant) => found.has(quant));
  const others = [...found].filter((quant) => !PREFERRED_QUANTS.includes(quant));
  return [...preferred, ...others].slice(0, MAX_LISTED_QUANTS);
}

/** Finds the file, or every shard, holding one quantization; null when the repo has none. */
function matchFilesForTag(files, tag) {
  const wanted = String(tag).toUpperCase();
  // A substring match is only trusted for names with no readable quant, or Q2_0 would pick PQ2_0.
  const hits = files.filter((file) => {
    const quant = extractQuant(file.path);
    return quant ? quant === wanted : file.path.toUpperCase().includes(wanted);
  });
  if (hits.length === 0) return null;

  const plain = hits.filter((file) => !/-mtp/i.test(file.path.split("/").pop()));
  const pool = plain.length > 0 ? plain : hits;

  const shards = pool.filter((file) => SHARD_PATTERN.test(file.path)).sort((a, b) => a.path.localeCompare(b.path));
  if (shards.length > 0) {
    const group = shards[0].path.replace(SHARD_PATTERN, "");
    const parts = shards.filter((file) => file.path.replace(SHARD_PATTERN, "") === group);
    return { files: parts, primary: parts[0], bytes: parts.reduce((sum, file) => sum + file.size, 0) };
  }
  return { files: [pool[0]], primary: pool[0], bytes: pool[0].size };
}

/** Resolves files and exact sizes for a Hugging Face model repository. */
async function fetchRepoGgufFiles(repoId) {
  if (filesCache.has(repoId)) return filesCache.get(repoId);

  const url = "https://huggingface.co/api/models/" + repoId + "/tree/main?recursive=true";
  if (!urlPolicy.isFetchableUrl(url, { allowPrivate: false })) return [];

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];

    const tree = await res.json();
    if (!Array.isArray(tree)) return [];

    const ggufFiles = tree
      .filter((item) => isModelFile(item?.path))
      .map((item) => ({ path: item.path, size: Number(item.size) || 0 }));

    filesCache.set(repoId, ggufFiles);
    return ggufFiles;
  } catch {
    return [];
  }
}

const MODELS_API = "https://huggingface.co/api/models";
// The API drops its default fields once expand[] is used, so tags, pipeline_tag and siblings are asked for.
const EXPAND = "expand[]=cardData&expand[]=baseModels&expand[]=gguf&expand[]=pipeline_tag&expand[]=tags&expand[]=siblings";
const TOP_MODELS_URL = `${MODELS_API}?filter=gguf&sort=trendingScore&direction=-1&limit=100&${EXPAND}`;
const TOP_MODELS_TTL_MS = 30 * 60 * 1000;

const EMBEDDING_TASKS = new Set(["feature-extraction", "sentence-similarity"]);
const VISION_TASKS = new Set(["image-text-to-text", "any-to-any", "visual-question-answering"]);
// Text-in, text-out tasks only; the download list also holds speech and detection repos.
const CHAT_TASKS = new Set(["text-generation", "text2text-generation", "conversational"]);

const TASK_LABELS = {
  "text-generation": "Text generation",
  "text2text-generation": "Text-to-text",
  "image-text-to-text": "Vision-language",
  "any-to-any": "Multimodal",
  "visual-question-answering": "Vision-language",
  "feature-extraction": "Embedding",
  "sentence-similarity": "Embedding",
};

const TAG_LABELS = {
  conversational: "chat",
  coding: "coding",
  code: "coding",
  math: "math",
  roleplay: "roleplay",
  multilingual: "multilingual",
  moe: "mixture-of-experts",
  reasoning: "reasoning",
  uncensored: "uncensored",
  abliterated: "abliterated",
  "function-calling": "tool use",
  "tool-use": "tool use",
};

const RELATION_VERBS = {
  quantized: "quantized from",
  finetune: "fine-tuned from",
  merge: "merged from",
  adapter: "adapted from",
};

/** Canonical blurbs, most specific first: the first pattern found in the repo or base model wins. */
const FAMILIES = [
  {
    match: /deepseek[-_ ]?r1/i,
    description:
      "DeepSeek-R1 reasoning models, trained to think step by step. Distilled versions bring that to Qwen and Llama sizes.",
  },
  {
    match: /deepseek/i,
    description: "DeepSeek's open mixture-of-experts models, strong at coding, math and general reasoning.",
  },
  {
    match: /qwen[-_ ]?\d*(\.\d+)?[-_ ]?coder/i,
    description: "Alibaba's Qwen Coder models, tuned for code generation, repair and agentic coding work.",
  },
  {
    match: /qwen[-_ ]?3(?![0-9.])/i,
    description: "Alibaba's Qwen3 generation: dense and mixture-of-experts models with strong multilingual, coding and agent skills.",
  },
  {
    match: /qwen[-_ ]?2\.5/i,
    description: "Alibaba's Qwen 2.5 series, with exceptional strength in coding, math and instruction following.",
  },
  {
    match: /llama[-_ ]?3\.1/i,
    description: "Meta's Llama 3.1: multilingual instruction-tuned models with 128K context and native tool calling.",
  },
  {
    match: /llama[-_ ]?3\.2/i,
    description: "Meta's Llama 3.2: lightweight 1B and 3B models for fast local inference, plus larger vision variants.",
  },
  {
    match: /llama[-_ ]?3\.3/i,
    description: "Meta's Llama 3.3 70B, an instruction-tuned multilingual model with performance near Llama 3.1 405B.",
  },
  {
    match: /(^|[^a-z])phi[-_ ]?4/i,
    description: "Microsoft's Phi-4, compact models trained heavily on synthetic data for strong reasoning and STEM results.",
  },
  {
    match: /gemma[-_ ]?2/i,
    description: "Google's Gemma 2, lightweight open models built from the same research as Gemini, from 2B to 27B.",
  },
  {
    match: /gemma[-_ ]?3/i,
    description: "Google's Gemma 3, multimodal open models with a long context window and wide language coverage.",
  },
  {
    match: /gemma/i,
    description: "Google's Gemma family, lightweight open models built from the research behind Gemini.",
  },
  {
    match: /mistral|mixtral|ministral/i,
    description: "Mistral AI's open models, fast and capable general-purpose assistants with native function calling.",
  },
  {
    match: /granite/i,
    description: "IBM's Granite models, open enterprise-grade models for instruction following, tool calling and retrieval.",
  },
  {
    match: /minicpm/i,
    description: "OpenBMB's MiniCPM, compact models built for efficient on-device use, with MiniCPM-V adding vision.",
  },
  {
    match: /cohere|(^|[^a-z])command[-_ ]?[ar]/i,
    description: "Cohere's Command models, built for enterprise agents, retrieval and tool use; the family behind Cohere North.",
  },
];

/** Drops the author and the GGUF suffix: "bartowski/Llama-3.2-3B-Instruct-GGUF" is "Llama-3.2-3B-Instruct". */
function cleanModelName(repoId) {
  const base = String(repoId).split("/").pop();
  return base.replace(/[-_.]gguf$/i, "") || base;
}

function firstBaseModel(item, repoId) {
  const declared = item.cardData?.base_model;
  const candidates = Array.isArray(declared) ? declared : declared ? [declared] : [];
  const linked = Array.isArray(item.baseModels?.models) ? item.baseModels.models.map((m) => m?.id) : [];
  return [...candidates, ...linked].find((id) => typeof id === "string" && id && id !== repoId) || "";
}

function formatParameters(repoId, total) {
  const named = /(?:^|[-_ .])[ea]?(\d+(?:\.\d+)?)([bm])(?![a-z])/i.exec(cleanModelName(repoId));
  if (named) return `${named[1]}${named[2].toUpperCase()}`;
  if (total >= 1e9) return `${(total / 1e9).toFixed(total < 1e10 ? 1 : 0)}B`;
  if (total >= 1e8) return `${Math.round(total / 1e6)}M`;
  return "";
}

function describeModel(item, { repoId, author, base, task, tags }) {
  // Only the repo's own name counts; a community model built on Qwen is not stock Qwen.
  const family = FAMILIES.find((entry) => entry.match.test(cleanModelName(repoId)));
  if (family) return `${family.description} GGUF by ${author}.`;

  const params = formatParameters(repoId, Number(item.gguf?.total) || 0);
  const verb = RELATION_VERBS[item.baseModels?.relation] || "based on";
  const label = TASK_LABELS[task] || "Language";
  let text = `${label} model${params ? ` with ${params} parameters` : ""}${base ? `, ${verb} ${base}` : ""}.`;
  text += ` GGUF by ${author}.`;

  const traits = [...new Set(tags.map((tag) => TAG_LABELS[tag]).filter(Boolean))].slice(0, 3);
  if (traits.length > 0) text += ` Tagged ${traits.join(", ")}.`;
  return text;
}

function detectCapabilities({ repoId, base, task, tags }, chatTemplate) {
  const isEmbedding =
    EMBEDDING_TASKS.has(task) ||
    tags.includes("text-embeddings-inference") ||
    /(^|[^a-z])embed/i.test(cleanModelName(repoId));
  if (isEmbedding) return ["embedding"];

  const named = `${repoId} ${base}`;
  const tools = /\btools?\b/.test(chatTemplate) || tags.includes("function-calling") || tags.includes("tool-use");
  const thinking =
    /<think>|enable_thinking/.test(chatTemplate) ||
    tags.includes("reasoning") ||
    tags.includes("thinking") ||
    /(^|[^a-z0-9])(r1|qwq|thinking|reasoning)([^a-z0-9]|$)/i.test(named);
  const vision = VISION_TASKS.has(task) || tags.includes("vision") || tags.includes("multimodal");

  const capabilities = [];
  if (tools) capabilities.push("tools");
  if (thinking) capabilities.push("thinking");
  if (vision) capabilities.push("vision");
  capabilities.push("completion");
  return capabilities;
}

/** Turns one Hugging Face API item into a library entry, or null when it is not a chat or embedding model. */
function toLibraryModel(item) {
  const repoId = typeof item?.id === "string" ? item.id : "";
  if (!repoId.includes("/")) return null;

  const task = item.pipeline_tag || item.cardData?.pipeline_tag || "";
  if (task && !CHAT_TASKS.has(task) && !VISION_TASKS.has(task) && !EMBEDDING_TASKS.has(task)) return null;

  const tags = (Array.isArray(item.tags) ? item.tags : item.cardData?.tags || [])
    .filter((tag) => typeof tag === "string")
    .map((tag) => tag.toLowerCase());
  const context = {
    repoId,
    author: repoId.split("/")[0],
    base: firstBaseModel(item, repoId),
    task,
    tags,
  };

  // The chat template is only read for capability hints; it is far too large to send to the renderer.
  const chatTemplate = typeof item.gguf?.chat_template === "string" ? item.gguf.chat_template : "";

  return {
    name: cleanModelName(repoId),
    repo: repoId,
    description: describeModel(item, context),
    capabilities: detectCapabilities(context, chatTemplate),
    sizes: extractAvailableSizes(item.siblings),
  };
}

async function fetchModelList(url, timeoutMs) {
  if (!urlPolicy.isFetchableUrl(url, { allowPrivate: false })) return null;

  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) return null;

  const data = await response.json();
  return Array.isArray(data) ? data.map(toLibraryModel).filter(Boolean) : null;
}

let topModelsCache = null;
let topModelsPending = null;

/** The most downloaded GGUF models, kept in memory so repeated empty searches cost nothing. */
async function loadTopModels() {
  if (topModelsCache && topModelsCache.expires > Date.now()) return topModelsCache.models;

  topModelsPending ??= fetchModelList(TOP_MODELS_URL, 12000)
    .then((models) => {
      if (models?.length) topModelsCache = { models, expires: Date.now() + TOP_MODELS_TTL_MS };
      return models || [];
    })
    .catch((err) => {
      log.error("huggingface", `Top models error: ${err.message}`);
      return [];
    })
    .finally(() => {
      topModelsPending = null;
    });
  return topModelsPending;
}

function resetSearchCache() {
  topModelsCache = null;
  topModelsPending = null;
}

/** Searches Hugging Face for GGUF models; an empty query lists the most downloaded ones. */
async function searchHuggingFace(query = "") {
  const term = String(query || "").trim().toLowerCase();
  if (!term) return loadTopModels();

  // Filter curated matches first.
  const localMatches = CURATED_MODELS.filter(
    (m) => m.name.toLowerCase().includes(term) || m.description.toLowerCase().includes(term),
  ).map((model) => ({
    name: model.name,
    description: model.description,
    capabilities: model.capabilities,
    sizes: model.sizes,
  }));

  const searchUrl = `${MODELS_API}?search=${encodeURIComponent(term)}&filter=gguf&sort=downloads&direction=-1&limit=20&${EXPAND}`;

  try {
    const remoteModels = await fetchModelList(searchUrl, 12000);
    return [...localMatches, ...(remoteModels || [])];
  } catch (err) {
    log.error("huggingface", `Search error: ${err.message}`);
    return localMatches;
  }
}

/** Looks up file size in bytes for a specific model variant. */
async function fetchModelSize(name, tag = "latest") {
  const ref = `${name}:${tag}`;
  if (sizeCache.has(ref)) return { success: true, bytes: sizeCache.get(ref) };

  // Check curated list first.
  const curated = CURATED_MODELS.find((m) => m.name === name);
  if (curated?.variants?.[tag]) {
    const bytes = curated.variants[tag].bytes;
    sizeCache.set(ref, bytes);
    return { success: true, bytes };
  }

  // If name is a repoId or contains slash, query repo tree.
  if (name.includes("/")) {
    const files = await fetchRepoGgufFiles(name);
    const match = matchFilesForTag(files, tag);
    if (match?.bytes) {
      sizeCache.set(ref, match.bytes);
      return { success: true, bytes: match.bytes };
    }
  }

  return { success: false, error: "Size lookup unavailable" };
}

/** Resolves a model reference into a downloadable Hugging Face direct URL and filename. */
async function resolveModelDownload(reference) {
  const [name, tag = "latest"] = reference.split(":");

  // Check curated models first.
  const curated = CURATED_MODELS.find((m) => m.name === name);
  if (curated) {
    const variantKey = curated.variants[tag] ? tag : curated.sizes[0];
    const variant = curated.variants[variantKey];
    if (variant) {
      return {
        url: `https://huggingface.co/${variant.repo}/resolve/main/${variant.file}?download=true`,
        filename: variant.file,
        size: variant.bytes,
      };
    }
  }

  // Handle direct Hugging Face repo reference.
  if (name.includes("/")) {
    const files = await fetchRepoGgufFiles(name);
    const match = matchFilesForTag(files, tag);
    if (match) {
      return {
        url: `https://huggingface.co/${name}/resolve/main/${match.primary.path}?download=true`,
        filename: match.primary.path.split("/").pop(),
        size: match.bytes,
      };
    }
  }

  return null;
}

module.exports = {
  CURATED_MODELS,
  extractAvailableSizes,
  searchHuggingFace,
  resetSearchCache,
  fetchModelSize,
  resolveModelDownload,
};
