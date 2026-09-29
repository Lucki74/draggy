/** The providers Draggy knows how to reach. Cloud entries are fixed here; a local server's address
 * is its default and may be changed per instance. */

// Most chat models call tools; the exceptions are named per provider below.
const TOOLS = "tools";
const VISION = "vision";
const THINKING = "thinking";

const cloud = (id, name, baseUrl, keyUrl, extra = {}) => ({
  id,
  name,
  kind: "cloud",
  protocol: "openai",
  baseUrl,
  keyUrl,
  auth: "bearer",
  capabilityPatterns: [],
  defaultModels: [],
  quirks: {},
  ...extra,
});

const local = (id, name, port, probe, extra = {}) => ({
  id,
  name,
  kind: "local",
  protocol: "openai",
  baseUrl: `http://127.0.0.1:${port}/v1`,
  auth: "none",
  discovery: { port, probe },
  capabilityPatterns: [],
  defaultModels: [],
  // Local servers take llama.cpp's template switches, which is how thinking is turned on or off.
  quirks: { templateKwargs: true, reasoningContent: true },
  ...extra,
});

const CATALOG = [
  cloud("openai", "OpenAI", "https://api.openai.com/v1", "https://platform.openai.com/api-keys", {
    capabilityPatterns: [
      { match: "^(o\\d|gpt-5|gpt-6)", capabilities: [TOOLS, VISION, THINKING] },
      { match: "^gpt-4(o|\\.1)", capabilities: [TOOLS, VISION] },
      { match: "^gpt-", capabilities: [TOOLS] },
    ],
    defaultModels: ["gpt-5.5", "gpt-5-mini"],
    quirks: { maxTokensField: "max_completion_tokens", reasoningEffort: true },
  }),
  cloud("anthropic", "Anthropic", "https://api.anthropic.com/v1", "https://platform.claude.com/settings/keys", {
    protocol: "anthropic",
    auth: "x-api-key",
    // The Messages API requires a limit, so each family gets its own when Draggy asks for none.
    capabilityPatterns: [
      { match: "^claude-3-(opus|haiku)", capabilities: [TOOLS, VISION], maxOutputTokens: 4096 },
      { match: "^claude-3-5", capabilities: [TOOLS, VISION], maxOutputTokens: 8192 },
      { match: "^claude-", capabilities: [TOOLS, VISION, THINKING], maxOutputTokens: 32000 },
    ],
    defaultModels: ["claude-sonnet-5-5", "claude-opus-5-5"],
  }),
  cloud("gemini", "Google Gemini", "https://generativelanguage.googleapis.com/v1beta", "https://aistudio.google.com/apikey", {
    protocol: "gemini",
    auth: "x-goog-api-key",
    capabilityPatterns: [
      { match: "embedding|imagen|veo|tts|aqa|native-audio", capabilities: [] },
      { match: "^gemini-(2\\.5|[3-9])", capabilities: [TOOLS, VISION, THINKING] },
      { match: "^gemini", capabilities: [TOOLS, VISION] },
      { match: "^gemma", capabilities: [] },
    ],
  }),
  cloud("xai", "xAI", "https://api.x.ai/v1", "https://console.x.ai", {
    capabilityPatterns: [
      { match: "mini|reason", capabilities: [TOOLS, THINKING] },
      { match: "vision|grok-4", capabilities: [TOOLS, VISION] },
      { match: "^grok", capabilities: [TOOLS] },
    ],
    quirks: { reasoningEffort: true },
  }),
  cloud("deepseek", "DeepSeek", "https://api.deepseek.com/v1", "https://platform.deepseek.com/api_keys", {
    capabilityPatterns: [
      { match: "reasoner", capabilities: [THINKING] },
      { match: "chat", capabilities: [TOOLS] },
    ],
    defaultModels: ["deepseek-chat", "deepseek-reasoner"],
    quirks: { reasoningContent: true },
  }),
  cloud("mistral", "Mistral", "https://api.mistral.ai/v1", "https://console.mistral.ai/api-keys", {
    capabilityPatterns: [
      { match: "magistral", capabilities: [TOOLS, THINKING] },
      { match: "pixtral|medium|small", capabilities: [TOOLS, VISION] },
      { match: "", capabilities: [TOOLS] },
    ],
  }),
  cloud("groq", "Groq", "https://api.groq.com/openai/v1", "https://console.groq.com/keys", {
    capabilityPatterns: [
      { match: "whisper|tts|guard", capabilities: [] },
      { match: "qwen3|gpt-oss|deepseek-r1", capabilities: [TOOLS, THINKING] },
      { match: "llama-4|scout|maverick", capabilities: [TOOLS, VISION] },
      { match: "", capabilities: [TOOLS] },
    ],
  }),
  cloud("cerebras", "Cerebras", "https://api.cerebras.ai/v1", "https://cloud.cerebras.ai", {
    capabilityPatterns: [{ match: "", capabilities: [TOOLS] }],
  }),
  cloud("together", "Together AI", "https://api.together.xyz/v1", "https://api.together.ai/settings/api-keys", {
    capabilityPatterns: [{ match: "", capabilities: [TOOLS] }],
  }),
  cloud("fireworks", "Fireworks", "https://api.fireworks.ai/inference/v1", "https://fireworks.ai/account/api-keys", {
    capabilityPatterns: [{ match: "", capabilities: [TOOLS] }],
  }),
  // OpenRouter lists what each model supports, so its patterns are only a fallback.
  cloud("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "https://openrouter.ai/keys", {
    capabilityPatterns: [{ match: "", capabilities: [TOOLS] }],
  }),
  cloud("huggingface", "Hugging Face", "https://router.huggingface.co/v1", "https://huggingface.co/settings/tokens", {
    capabilityPatterns: [{ match: "", capabilities: [TOOLS] }],
  }),
  cloud("qwen", "Qwen (DashScope)", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "https://modelstudio.console.alibabacloud.com", {
    capabilityPatterns: [
      { match: "vl", capabilities: [TOOLS, VISION] },
      { match: "qwen3|qwq|plus|max|turbo", capabilities: [TOOLS, THINKING] },
      { match: "", capabilities: [TOOLS] },
    ],
    quirks: { reasoningContent: true, enableThinking: true },
  }),
  cloud("moonshot", "Moonshot (Kimi)", "https://api.moonshot.ai/v1", "https://platform.moonshot.ai/console/api-keys", {
    capabilityPatterns: [
      { match: "thinking", capabilities: [TOOLS, THINKING] },
      { match: "vision", capabilities: [TOOLS, VISION] },
      { match: "", capabilities: [TOOLS] },
    ],
    quirks: { reasoningContent: true },
  }),
  cloud("zai", "Z.ai (GLM)", "https://api.z.ai/api/paas/v4", "https://z.ai/manage-apikey/apikey-list", {
    capabilityPatterns: [
      { match: "\\d(\\.\\d+)?v\\b|vision", capabilities: [TOOLS, VISION] },
      { match: "", capabilities: [TOOLS, THINKING] },
    ],
    quirks: { reasoningContent: true },
  }),
  cloud("minimax", "MiniMax", "https://api.minimax.io/v1", "https://www.minimax.io/platform", {
    capabilityPatterns: [{ match: "", capabilities: [TOOLS] }],
  }),
  cloud("cohere", "Cohere", "https://api.cohere.ai/compatibility/v1", "https://dashboard.cohere.com/api-keys", {
    capabilityPatterns: [
      { match: "vision", capabilities: [VISION] },
      { match: "", capabilities: [TOOLS] },
    ],
  }),
  cloud("nvidia", "NVIDIA NIM", "https://integrate.api.nvidia.com/v1", "https://build.nvidia.com", {
    capabilityPatterns: [{ match: "", capabilities: [TOOLS] }],
  }),
  // Any OpenAI-compatible server the user points at; a key is optional for a server that has none.
  { ...cloud("custom", "Custom (OpenAI-compatible)", "", ""), keyOptional: true },
  // A plan rather than a key, reached only through the vendor's own runtime (spec §4), so it has no address.
  {
    id: "chatgpt",
    name: "ChatGPT",
    kind: "account",
    protocol: "codex",
    auth: "account",
    baseUrl: "",
    keyUrl: "",
    // The only page a sign-in may open: the vendor's own, never one Codex was talked into naming.
    signInHosts: ["auth.openai.com"],
    capabilityPatterns: [{ match: "", capabilities: [TOOLS, VISION, THINKING] }],
    defaultModels: [],
  },

  local("ollama", "Ollama", 11434, "/api/version", { protocol: "ollama", baseUrl: "http://127.0.0.1:11434" }),
  local("lmstudio", "LM Studio", 1234, "/api/v0/models"),
  local("llamacpp", "llama.cpp server", 8080, "/props"),
  local("vllm", "vLLM", 8000, "/version"),
  local("sglang", "SGLang", 30000, "/v1/models"),
  local("jan", "Jan", 1337, "/v1/models"),
  local("localai", "LocalAI", 8080, "/v1/models"),
  local("koboldcpp", "KoboldCpp", 5001, "/v1/models"),
  local("textgen", "text-generation-webui", 5000, "/v1/models"),
  local("gpt4all", "GPT4All", 4891, "/v1/models"),
  local("llamafile", "llamafile", 8080, "/v1/models"),
  local("mlx", "MLX-LM", 8080, "/v1/models"),
  local("lemonade", "Lemonade", 8000, "/api/v1/models", { baseUrl: "http://127.0.0.1:8000/api/v1" }),
];

const PROTOCOLS = new Set(["openai", "ollama", "anthropic", "gemini", "codex", "claude", "gemini-cli"]);
const AUTHS = new Set(["bearer", "x-api-key", "x-goog-api-key", "account", "none"]);
const CAPABILITIES = new Set([TOOLS, VISION, THINKING]);

/** Why an entry cannot be used, or null. Shared with the remote catalog, which must meet the same bar. */
function problemWith(entry) {
  if (!entry || typeof entry !== "object") return "not an object";
  if (!/^[a-z0-9-]+$/.test(entry.id || "")) return "bad id";
  if (!entry.name) return "no name";
  if (!["cloud", "local", "account"].includes(entry.kind)) return "bad kind";
  if (!PROTOCOLS.has(entry.protocol)) return "bad protocol";
  if (!AUTHS.has(entry.auth)) return "bad auth";
  if ((entry.kind === "account") !== (entry.auth === "account")) return "account auth outside an account";
  if (entry.kind === "account" && entry.baseUrl) return "account with a baseUrl";
  if (entry.baseUrl) {
    let url;
    try {
      url = new URL(entry.baseUrl);
    } catch {
      return "bad baseUrl";
    }
    if (url.search || url.username || url.password) return "baseUrl carries a query or credentials";
    if (entry.kind === "cloud" && url.protocol !== "https:") return "cloud baseUrl is not https";
    if (entry.kind === "local" && url.hostname !== "127.0.0.1") return "local baseUrl is not loopback";
  } else if (entry.id !== "custom" && entry.kind !== "account") return "no baseUrl";
  for (const pattern of entry.capabilityPatterns || []) {
    try {
      new RegExp(pattern.match, "i");
    } catch {
      return "bad pattern";
    }
    if (!(pattern.capabilities || []).every((c) => CAPABILITIES.has(c))) return "unknown capability";
  }
  if (!Array.isArray(entry.defaultModels)) return "bad defaultModels";
  return null;
}

function catalog() {
  return CATALOG;
}

function find(id) {
  return CATALOG.find((entry) => entry.id === id) || null;
}

/** Tools, vision and thinking for a model by the first pattern its id matches. */
function capabilitiesFor(entry, modelId) {
  const pattern = (entry?.capabilityPatterns || []).find((p) => new RegExp(p.match, "i").test(modelId));
  return pattern
    ? { capabilities: [...pattern.capabilities], contextLength: pattern.contextLength ?? null, maxOutputTokens: pattern.maxOutputTokens ?? null }
    : { capabilities: [], contextLength: null, maxOutputTokens: null };
}

module.exports = { catalog, find, capabilitiesFor, problemWith };
