/** What the renderer may ask of providers, one channel per call. A key goes in and never comes back:
 * every answer is the registry's view, which carries only whether a key is set and its last four. */
const { catalog } = require("./catalog.cjs");

const failed = (error) => ({ success: false, error: error?.failure || { kind: "provider-unknown-error", message: String(error?.message || error) } });

/** The catalog as the page needs it; quirks, patterns and sign-in hosts stay in main. */
function catalogView(keystore = true) {
  return catalog().map((entry) => ({
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
    // Only in providers.json, not in this release: its address is shown and confirmed before it is added.
    remote: Boolean(entry.remote),
  }));
}

/** An account's runtime answers for it; a key instance, or one whose runtime is missing, is refused. */
function accountOf(registry, accounts, id) {
  const connection = registry.connectionFor(id);
  const runtime = connection?.entry?.kind === "account" ? accounts[connection.entry.protocol] : null;
  if (!runtime) throw Object.assign(new Error("not an account"), { failure: { kind: "account-runtime-unavailable", message: `${id} is not an account.` } });
  return { runtime, entry: connection.entry };
}

/** Opens the sign-in page only on the vendor's own host, over https, whatever the runtime asked for. */
function signInOpener(entry, openExternal) {
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !(entry.signInHosts || []).includes(parsed.hostname)) {
      throw Object.assign(new Error("refused sign-in page"), { failure: { kind: "provider-unknown-error", message: `Refused to open ${parsed.origin}.` } });
    }
    await openExternal(parsed.href);
  };
}

function createProviderHandlers({ registry, models, discovery, keystore = () => true, accounts = {}, openExternal = async () => {}, notify = () => {} }) {
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
    "providers:account-sign-in": async (id) => {
      try {
        const { runtime, entry } = accountOf(registry, accounts, id);
        const onProgress = (progress) => notify("providers:account-progress", { id, ...progress });
        const status = await runtime.signIn(id, { onProgress, openExternal: signInOpener(entry, openExternal) });
        models.forget(id);
        return { success: true, status };
      } catch (error) {
        return failed(error);
      }
    },
    "providers:account-cancel": async (id) => {
      try {
        await accountOf(registry, accounts, id).runtime.cancel(id);
        return { success: true };
      } catch (error) {
        return failed(error);
      }
    },
    "providers:account-sign-out": async (id) => {
      try {
        await accountOf(registry, accounts, id).runtime.signOut(id);
        models.forget(id);
        return { success: true };
      } catch (error) {
        return failed(error);
      }
    },
    "providers:account-status": async (id) => {
      try {
        return { success: true, status: await accountOf(registry, accounts, id).runtime.status(id) };
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
