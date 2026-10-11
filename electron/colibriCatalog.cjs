"use strict";

/**
 * Models colibri v2.0.0 ships containers for (plan appendix A.1). Sizes are the download as listed
 * on Hugging Face. `routedGB` is what one token reads from the experts; where the plan has no
 * measurement it is derived from the model's active-expert fraction and flagged `estimated`.
 */
const { log } = require("./logger.cjs");

const CATALOG = [
  { id: "qwen3-coder-30b-a3b", name: "Qwen3-Coder-30B-A3B", repo: "Justvugg/Qwen3-Coder-30B-A3B-colibri-int4", totalGB: 19.4, denseGB: 3.6, ramMinGB: 8, ramGoodGB: 18, routedGB: 1.3, estimated: true },
  { id: "qwen36-35b-a3b", name: "Qwen3.6-35B-A3B", repo: "Kreuzzelg/qwen36-35b-a3b-colibri-i4-gs64", totalGB: 23.1, denseGB: 3.5, ramMinGB: 10, ramGoodGB: 20, routedGB: 1.6 },
  { id: "dsv4-flash-reap", name: "DeepSeek V4 Flash REAP", repo: "puwaer/DeepSeek-V4-Flash-0731-reap-150b", totalGB: 84.7, denseGB: 7.9, ramMinGB: 16, ramGoodGB: 32, routedGB: 3, estimated: true },
  { id: "dsv4-flash", name: "DeepSeek V4 Flash", repo: "deepseek-ai/DeepSeek-V4-Flash-0731", totalGB: 166.9, denseGB: 7.9, ramMinGB: 16, ramGoodGB: 32, routedGB: 5.5 },
  { id: "mimo-v26-flash", name: "MiMo-V2.6 Flash", repo: "XiaomiMiMo/MiMo-V2.6-Flash-MOPD", totalGB: 171.8, denseGB: 24, ramMinGB: 32, ramGoodGB: 52, routedGB: 6, estimated: true },
  { id: "glm-52", name: "GLM-5.2", repo: "mastouri/GLM-5.2-colibri-int4-g64-with-int8-mtp", totalGB: 429.3, denseGB: 9.9, ramMinGB: 16, ramGoodGB: 24, routedGB: 11 },
  { id: "glm-53", name: "GLM-5.3", repo: "Justvugg/GLM-5.3-colibri-int4-g64", totalGB: 419.3, denseGB: 9.9, ramMinGB: 16, ramGoodGB: 24, routedGB: 11, estimated: true },
  { id: "inkling", name: "Inkling", repo: "nbeerbower/Inkling-colibri-int4", totalGB: 514.1, denseGB: 49.4, ramMinGB: 120, ramGoodGB: 128, routedGB: 10, estimated: true },
  { id: "mimo-v26-pro", name: "MiMo-V2.6 Pro", repo: "XiaomiMiMo/MiMo-V2.6-Pro-MOPD", totalGB: 563.6, denseGB: 32.4, ramMinGB: 54, ramGoodGB: 64, routedGB: 12 },
  { id: "kimi-k3", name: "Kimi K3", repo: "moonshotai/Kimi-K3", totalGB: 1561, denseGB: 20, ramMinGB: 32, ramGoodGB: 64, routedGB: 25 },
];

function find(id) {
  const entry = CATALOG.find((item) => item.id === id) || null;
  if (!entry) log.debug("engine.colibri", "catalog entry not found", { idLength: String(id ?? "").length });
  return entry;
}

module.exports = { CATALOG, find };
