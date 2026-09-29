/** The models each provider instance offers, and what each can do: the listing's own facts first,
 * then the catalog's patterns, then the user's override, which always wins. */
const { capabilitiesFor } = require("./catalog.cjs");
const { fromResponse, fromNetwork } = require("./errors.cjs");

const ADAPTERS = {
  openai: require("./adapters/openai.cjs"),
  ollama: require("./adapters/ollama.cjs"),
  anthropic: require("./adapters/anthropic.cjs"),
};
const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 15_000;
const MAX_SHOWN = 50;
const FLAGS = ["tools", "vision", "thinking"];

/** A thinking switch only counts where Draggy can send one; otherwise the pill would do nothing. */
function thinkingControllable(entry) {
  if (entry?.kind === "account") return true;
  const quirks = entry?.quirks || {};
  return entry?.protocol === "ollama" || entry?.protocol === "anthropic" || Boolean(quirks.reasoningEffort || quirks.enableThinking || quirks.templateKwargs);
}

/** What the listing itself says, as capability flags; `null` where it says nothing. */
function listedFlags(model, entry) {
  if (model.capabilities) return Object.fromEntries(FLAGS.map((flag) => [flag, model.capabilities.includes(flag)]));
  const flags = {};
  if (model.supported) {
    flags.tools = model.supported.includes("tools");
    if (thinkingControllable(entry)) flags.thinking = model.supported.includes("reasoning");
  }
  if (model.inputModalities) flags.vision = model.inputModalities.includes("image");
  return Object.keys(flags).length ? flags : null;
}

function describe(instance, entry, model) {
  const pattern = capabilitiesFor(entry, model.id);
  const flags = Object.fromEntries(FLAGS.map((flag) => [flag, pattern.capabilities.includes(flag)]));
  Object.assign(flags, listedFlags(model, entry) || {});
  if (!thinkingControllable(entry)) flags.thinking = false;
  const override = instance.modelOverrides?.[model.id] || null;
  if (override) Object.assign(flags, override);
  return {
    id: model.id,
    ref: `@${instance.id}/${model.id}`,
    contextLength: model.contextLength || pattern.contextLength || null,
    maxOutputTokens: pattern.maxOutputTokens || null,
    capabilities: ["completion", ...FLAGS.filter((flag) => flags[flag])],
    // Data leaves the machine for a cloud provider, and for a local server's cloud-hosted models.
    cloud: entry?.kind !== "local" || Boolean(model.cloud),
    pinned: (instance.pinnedModels || []).includes(model.id),
    override,
  };
}

function createModels({ registry, accounts = {}, fetchImpl = globalThis.fetch, now = Date.now }) {
  const cache = new Map();

  async function request(connection, { url, init }) {
    let response;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      throw Object.assign(new Error("unreachable"), { failure: fromNetwork(error) });
    }
    if (!response.ok) throw Object.assign(new Error("refused"), { failure: fromResponse(response.status, await response.text().catch(() => ""), response.headers) });
    return response.json();
  }

  async function fetchListing(connection) {
    const { entry } = connection;
    if (entry?.kind === "account") {
      const runtime = accounts[entry.protocol];
      if (!runtime) throw Object.assign(new Error("no runtime"), { failure: { kind: "account-runtime-unavailable", message: `${entry.name} is not available here.` } });
      return runtime.models(connection.instance.id);
    }
    if (entry?.protocol === "ollama") {
      const listed = ADAPTERS.ollama.parseModels(await request(connection, ADAPTERS.ollama.modelsRequest(connection)));
      // `/api/show` is the only place Ollama says what a model takes; a model it cannot show stays unknown.
      return Promise.all(
        listed.map(async (model, index) => {
          if (index >= MAX_SHOWN) return model;
          const shown = await request(connection, ADAPTERS.ollama.showRequest(connection, model.id)).catch(() => null);
          return shown ? { ...model, ...ADAPTERS.ollama.parseShow(shown) } : model;
        }),
      );
    }
    if (entry?.protocol === "anthropic") return ADAPTERS.anthropic.parseModels(await request(connection, ADAPTERS.anthropic.modelsRequest(connection)));
    if (entry?.id === "lmstudio") {
      const origin = connection.baseUrl.replace(/\/v1$/, "");
      const listing = await request(connection, { url: `${origin}/api/v0/models`, init: { method: "GET", headers: { ...connection.headers } } }).catch(() => null);
      if (listing?.data) return listing.data.filter((m) => m.type !== "embeddings").map(lmStudioModel);
    }
    return ADAPTERS.openai.parseModels(await request(connection, ADAPTERS.openai.modelsRequest(connection)));
  }

  /** Every model the instance lists, newest listing at most a day old unless `refresh` asks again. */
  async function list(instanceId, { refresh = false } = {}) {
    const connection = registry.connectionFor(instanceId);
    if (!connection) throw new Error(`No provider ${instanceId}`);
    const stamp = `${connection.baseUrl}|${Boolean(connection.apiKey)}`;
    const hit = cache.get(instanceId);
    let listed = hit && hit.stamp === stamp && now() - hit.at < DAY_MS && !refresh ? hit.listed : null;
    if (!listed) {
      listed = await fetchListing(connection);
      cache.set(instanceId, { stamp, at: now(), listed });
    }
    return listed.map((model) => describe(connection.instance, connection.entry, model)).sort((a, b) => a.id.localeCompare(b.id));
  }

  function forget(instanceId) {
    if (instanceId) cache.delete(instanceId);
    else cache.clear();
  }

  return { list, forget };
}

function lmStudioModel(model) {
  const capabilities = ["completion"];
  if ((model.capabilities || []).includes("tool_use")) capabilities.push("tools");
  if (model.type === "vlm") capabilities.push("vision");
  return { id: String(model.id), contextLength: Number(model.max_context_length) || null, capabilities };
}

module.exports = { createModels };
