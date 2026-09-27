/** The providers the user added. Records live in the database's kv table; a key lives only in the
 * keystore and never reaches the renderer, which sees whether one is set and its last four characters. */
const { find } = require("./catalog.cjs");

const KEY = "providers";
const PROFILES = new Set(["auto", "compact", "full"]);
const CAPABILITY_FLAGS = ["tools", "vision", "thinking"];

function createRegistry({ storage, secrets }) {
  const load = () => {
    try {
      const parsed = JSON.parse(storage.getValue(KEY) || "{}");
      return Array.isArray(parsed.instances) ? parsed.instances : [];
    } catch {
      return [];
    }
  };
  const save = (instances) => storage.setValue(KEY, JSON.stringify({ instances }));
  const secretOwner = (id) => `provider:${id}`;
  const keyOf = (id) => secrets.get(secretOwner(id)).apiKey || "";

  const needsKey = (instance) => {
    const entry = find(instance.type);
    return entry?.auth !== "none" && !entry?.keyOptional;
  };

  /** What the renderer may see: everything but the key. */
  const view = (instance) => {
    const key = keyOf(instance.id);
    const entry = find(instance.type);
    return {
      ...instance,
      name: entry?.name ?? instance.type,
      kind: entry?.kind ?? "cloud",
      protocol: entry?.protocol ?? "openai",
      baseUrl: baseUrlOf(instance),
      hasKey: Boolean(key),
      keyHint: key ? key.slice(-4) : "",
      needsKey: needsKey(instance),
    };
  };

  function baseUrlOf(instance) {
    return (instance.baseUrl || find(instance.type)?.baseUrl || "").replace(/\/+$/, "");
  }

  function list() {
    return load().map(view);
  }

  function get(id) {
    return load().find((instance) => instance.id === id) || null;
  }

  function add({ type, label, baseUrl, headers } = {}) {
    const entry = find(type);
    if (!entry) throw new Error(`Unknown provider type: ${type}`);
    const instances = load();
    let id = type;
    for (let n = 2; instances.some((i) => i.id === id); n++) id = `${type}-${n}`;
    const instance = {
      id,
      type,
      label: String(label || entry.name).slice(0, 80),
      enabled: false,
      pinnedModels: [],
      promptProfile: "auto",
      modelOverrides: {},
    };
    if (baseUrl !== undefined || type === "custom") instance.baseUrl = checkBaseUrl(entry, baseUrl);
    if (headers) instance.headers = checkHeaders(headers);
    save([...instances, instance]);
    return view(instance);
  }

  function update(id, patch = {}) {
    const instances = load();
    const index = instances.findIndex((i) => i.id === id);
    if (index === -1) throw new Error(`No provider ${id}`);
    const instance = { ...instances[index] };
    const entry = find(instance.type);
    if (patch.label !== undefined) instance.label = String(patch.label).slice(0, 80) || entry?.name || instance.type;
    if (patch.baseUrl !== undefined) instance.baseUrl = checkBaseUrl(entry, patch.baseUrl);
    if (patch.headers !== undefined) instance.headers = checkHeaders(patch.headers);
    if (patch.promptProfile !== undefined) {
      if (!PROFILES.has(patch.promptProfile)) throw new Error("Unknown prompt profile");
      instance.promptProfile = patch.promptProfile;
    }
    if (patch.pinnedModels !== undefined) {
      instance.pinnedModels = [...new Set((patch.pinnedModels || []).map(String))].slice(0, 500);
    }
    if (patch.modelOverrides !== undefined) instance.modelOverrides = checkOverrides(patch.modelOverrides);
    if (patch.enabled !== undefined) {
      const enabled = Boolean(patch.enabled);
      // Without a keystore a key could only be kept in the clear, so a provider that needs one stays off.
      if (enabled && needsKey(instance) && (!secrets.available() || !keyOf(id))) {
        throw new Error(secrets.available() ? "Add a key first." : "No keystore on this system.");
      }
      instance.enabled = enabled;
    }
    instances[index] = instance;
    save(instances);
    return view(instance);
  }

  function remove(id) {
    save(load().filter((instance) => instance.id !== id));
    secrets.remove(secretOwner(id));
    return { success: true };
  }

  /** Write-only: the key goes into the keystore and is never handed back. */
  function setKey(id, apiKey) {
    if (!get(id)) throw new Error(`No provider ${id}`);
    if (!secrets.available()) throw new Error("No keystore on this system.");
    const key = String(apiKey || "").trim();
    if (!secrets.set(secretOwner(id), key ? { apiKey: key } : {})) throw new Error("The key could not be stored.");
    if (!key) update(id, { enabled: false });
    return view(get(id));
  }

  /** For the gateway only, in the main process. */
  function connectionFor(id) {
    const instance = get(id);
    if (!instance) return null;
    return { instance, entry: find(instance.type), baseUrl: baseUrlOf(instance), apiKey: keyOf(id), headers: instance.headers || {} };
  }

  function enabledBaseUrls() {
    return load().filter((i) => i.enabled).map(baseUrlOf).filter(Boolean);
  }

  return { list, get, add, update, remove, setKey, connectionFor, enabledBaseUrls, baseUrlOf };
}

function checkBaseUrl(entry, value) {
  const text = String(value || "").trim();
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error("That address is not a URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http and https addresses are allowed.");
  if (url.username || url.password || url.search) throw new Error("Put a key in the key field, not in the address.");
  if (entry?.kind === "cloud" && entry.id !== "custom") throw new Error("This provider's address cannot be changed.");
  if (entry?.kind === "local" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("A server elsewhere on the network is added as Custom.");
  }
  return text.replace(/\/+$/, "");
}

function checkHeaders(headers) {
  const kept = {};
  for (const [name, value] of Object.entries(headers || {})) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(name)) throw new Error(`Bad header name: ${name}`);
    if (/[\r\n]/.test(String(value))) throw new Error(`Bad header value for ${name}`);
    kept[name] = String(value).slice(0, 2000);
  }
  return kept;
}

function checkOverrides(overrides) {
  const kept = {};
  for (const [model, flags] of Object.entries(overrides || {})) {
    const entry = {};
    for (const flag of CAPABILITY_FLAGS) if (typeof flags?.[flag] === "boolean") entry[flag] = flags[flag];
    if (Object.keys(entry).length > 0) kept[String(model)] = entry;
  }
  return kept;
}

module.exports = { createRegistry };
