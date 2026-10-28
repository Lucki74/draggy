// Turns LiteLLM's and OpenRouter's public price lists into the table Draggy prices replies from.
// Shared by the app's refresh (refresh.cjs) and by scripts/update-prices.mjs, which writes the bundled snapshot.

const LITELLM_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";

/** LiteLLM's provider name for each Draggy catalog id that has a public per-token price. */
const LITELLM_PROVIDERS = {
  openai: "openai",
  anthropic: "anthropic",
  gemini: "gemini",
  xai: "xai",
  deepseek: "deepseek",
  mistral: "mistral",
  groq: "groq",
  cerebras: "cerebras",
  together_ai: "together",
  fireworks_ai: "fireworks",
  nebius: "nebius",
  sambanova: "sambanova",
  novita: "novita",
  dashscope: "qwen",
  moonshot: "moonshot",
  zai: "zai",
  minimax: "minimax",
  cohere_chat: "cohere",
  cohere: "cohere",
  nvidia_nim: "nvidia",
};

const PER_M = 1_000_000;

/** Per-token dollars to per-million dollars, without float noise such as 2.4999999999999998. */
const perMillion = (perToken) => Number((Number(perToken) * PER_M).toPrecision(10));

const isNumber = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Drops the keys that are undefined so the written file stays small. */
const compact = (object) => Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined));

/** `above_200k_tokens` style tiers: LiteLLM prices the whole request at the higher rate once the prompt passes the size. */
function litellmTiers(entry) {
  const sizes = new Set();
  for (const key of Object.keys(entry)) {
    const match = /^input_cost_per_token_above_(\d+)k_tokens$/.exec(key);
    if (match) sizes.add(Number(match[1]));
  }
  return [...sizes]
    .sort((a, b) => a - b)
    .map((k) => {
      const suffix = `_above_${k}k_tokens`;
      const rate = (base) => (isNumber(entry[base + suffix]) ? perMillion(entry[base + suffix]) : undefined);
      return compact({
        aboveInputTokens: k * 1000,
        inputPerM: rate("input_cost_per_token"),
        outputPerM: rate("output_cost_per_token"),
        cacheReadPerM: rate("cache_read_input_token_cost"),
        cacheWritePerM: rate("cache_creation_input_token_cost"),
      });
    });
}

/** One LiteLLM entry as a price, or null when it is not a priced chat model. */
function fromLitellm(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (entry.mode !== "chat" && entry.mode !== "responses") return null;
  if (!isNumber(entry.input_cost_per_token) || !isNumber(entry.output_cost_per_token)) return null;
  const tiers = litellmTiers(entry);
  return compact({
    inputPerM: perMillion(entry.input_cost_per_token),
    outputPerM: perMillion(entry.output_cost_per_token),
    cacheReadPerM: isNumber(entry.cache_read_input_token_cost) ? perMillion(entry.cache_read_input_token_cost) : undefined,
    cacheWritePerM: isNumber(entry.cache_creation_input_token_cost) ? perMillion(entry.cache_creation_input_token_cost) : undefined,
    reasoningPerM: isNumber(entry.output_cost_per_reasoning_token) ? perMillion(entry.output_cost_per_reasoning_token) : undefined,
    tiers: tiers.length ? tiers : undefined,
  });
}

/** One OpenRouter model as a price. Its pricing strings are dollars per token. */
function fromOpenRouter(model) {
  const p = model?.pricing;
  if (!p) return null;
  const read = (value) => {
    if (value === undefined || value === null || value === "") return undefined;
    const n = Number(value);
    return isNumber(n) ? n : undefined;
  };
  const input = read(p.prompt);
  const output = read(p.completion);
  // OpenRouter marks routers whose price depends on the pick with -1, which is not a price.
  if (input === undefined || output === undefined) return null;
  const cacheRead = read(p.input_cache_read);
  const cacheWrite = read(p.input_cache_write);
  const reasoning = read(p.internal_reasoning);
  return compact({
    inputPerM: perMillion(input),
    outputPerM: perMillion(output),
    cacheReadPerM: cacheRead === undefined ? undefined : perMillion(cacheRead),
    cacheWritePerM: cacheWrite === undefined ? undefined : perMillion(cacheWrite),
    reasoningPerM: reasoning ? perMillion(reasoning) : undefined,
  });
}

/** The Draggy provider id and the bare model id for one LiteLLM key, or null when Draggy has no such provider. */
function splitLitellmKey(key, entry) {
  const provider = LITELLM_PROVIDERS[entry?.litellm_provider];
  if (!provider) return null;
  const prefix = `${entry.litellm_provider}/`;
  const id = key.startsWith(prefix) ? key.slice(prefix.length) : key;
  if (!id || id.startsWith("ft:") || id.includes("*")) return null;
  return { provider, id };
}

function buildTable({ litellm, openrouter, now = new Date() }) {
  const providers = {};
  const put = (provider, id, price) => {
    (providers[provider] ??= {})[id] = price;
  };
  for (const [key, entry] of Object.entries(litellm ?? {})) {
    const where = splitLitellmKey(key, entry);
    const price = where && fromLitellm(entry);
    if (price) put(where.provider, where.id, price);
  }
  for (const model of openrouter?.data ?? []) {
    const price = fromOpenRouter(model);
    if (price && typeof model.id === "string") put("openrouter", model.id, price);
  }
  const sorted = Object.fromEntries(
    Object.keys(providers)
      .sort()
      .map((provider) => [provider, Object.fromEntries(Object.keys(providers[provider]).sort().map((id) => [id, providers[provider][id]]))]),
  );
  return {
    version: 1,
    generatedAt: now.toISOString(),
    sources: [LITELLM_URL, OPENROUTER_URL],
    providers: sorted,
  };
}

/** One model per line so a price change shows up as a one-line diff. */
function serialize(table) {
  const lines = ["{", `  "version": ${table.version},`, `  "generatedAt": ${JSON.stringify(table.generatedAt)},`, `  "sources": ${JSON.stringify(table.sources)},`, '  "providers": {'];
  const names = Object.keys(table.providers);
  names.forEach((provider, i) => {
    lines.push(`    ${JSON.stringify(provider)}: {`);
    const ids = Object.keys(table.providers[provider]);
    ids.forEach((id, j) => lines.push(`      ${JSON.stringify(id)}: ${JSON.stringify(table.providers[provider][id])}${j < ids.length - 1 ? "," : ""}`));
    lines.push(`    }${i < names.length - 1 ? "," : ""}`);
  });
  lines.push("  }", "}", "");
  return lines.join("\n");
}

module.exports = {
  LITELLM_URL,
  OPENROUTER_URL,
  LITELLM_PROVIDERS,
  perMillion,
  fromLitellm,
  fromOpenRouter,
  splitLitellmKey,
  buildTable,
  serialize,
};
