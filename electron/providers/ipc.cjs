/** What the renderer may ask of providers, one channel per call. A key goes in and never comes back:
 * every answer is the registry's view, which carries only whether a key is set and its last four. */
const { catalog } = require("./catalog.cjs");

const failed = (error) => ({ success: false, error: error?.failure || { kind: "provider-unknown-error", message: String(error?.message || error) } });

/** The catalog as the Add list needs it; quirks and patterns stay in main. */
function catalogView(keystore = true) {
  // Accounts are signed in to, not added with a key, so they have a group of their own.
  return catalog().filter((entry) => entry.kind !== "account").map((entry) => ({
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    protocol: entry.protocol,
    keyUrl: entry.keyUrl || null,
    needsKey: entry.auth !== "none" && !entry.keyOptional,
    // Without a keystore a key could only be kept in the clear, so such a provider cannot be switched on.
    available: entry.auth === "none" || Boolean(entry.keyOptional) || keystore,
    baseUrl: entry.baseUrl || null,
    editableBaseUrl: entry.kind === "local" || entry.id === "custom",
  }));
}

function createProviderHandlers({ registry, models, discovery, keystore = () => true }) {
  const attempt = (work) => {
    try {
      return { success: true, ...work() };
    } catch (error) {
      return failed(error);
    }
  };
  return {
    "providers:catalog": () => catalogView(keystore()),
    "providers:list": () => registry.list(),
    "providers:add": (input) => attempt(() => ({ instance: registry.add(input || {}) })),
    "providers:update": (id, patch) =>
      attempt(() => {
        const instance = registry.update(id, patch || {});
        if (patch && ("baseUrl" in patch || "headers" in patch)) models.forget(id);
        return { instance };
      }),
    "providers:remove": (id) =>
      attempt(() => {
        registry.remove(id);
        models.forget(id);
        return {};
      }),
    "providers:set-key": (id, apiKey) =>
      attempt(() => {
        const instance = registry.setKey(id, apiKey);
        models.forget(id);
        return { instance };
      }),
    "providers:models": async (id, options) => {
      try {
        return { success: true, models: await models.list(id, { refresh: Boolean(options?.refresh) }) };
      } catch (error) {
        return failed(error);
      }
    },
    /** A fresh listing is the test: it proves the address, the key and the network in one request. */
    "providers:test": async (id) => {
      try {
        return { success: true, count: (await models.list(id, { refresh: true })).length };
      } catch (error) {
        return failed(error);
      }
    },
    "providers:scan": async () => {
      try {
        return { success: true, servers: await discovery.scan() };
      } catch (error) {
        return failed(error);
      }
    },
  };
}

module.exports = { createProviderHandlers, catalogView };
