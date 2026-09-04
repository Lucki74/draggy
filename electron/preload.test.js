import path from "node:path";
import Module from "node:module";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

/**
 * Loads the preload with a stub `electron` and hands back the API it exposes
 * along with the channel listeners it registered.
 */
function loadPreload() {
  const listeners = new Map();

  const ipcRenderer = {
    on(channel, listener) {
      if (!listeners.has(channel)) listeners.set(channel, []);
      listeners.get(channel).push(listener);
    },
    removeListener(channel, listener) {
      const kept = (listeners.get(channel) || []).filter((one) => one !== listener);
      listeners.set(channel, kept);
    },
    removeAllListeners(channel) {
      listeners.set(channel, []);
    },
    invoke: async () => undefined,
    send: () => undefined,
  };

  let api = null;
  const electron = {
    ipcRenderer,
    contextBridge: { exposeInMainWorld: (_name, value) => (api = value) },
  };

  const electronPath = require.resolve("electron");
  const preloadPath = require.resolve("./preload.cjs");
  const savedElectron = require.cache[electronPath];

  require.cache[electronPath] = new Module(electronPath);
  require.cache[electronPath].exports = electron;
  require.cache[electronPath].loaded = true;
  delete require.cache[preloadPath];

  try {
    require("./preload.cjs");
  } finally {
    delete require.cache[preloadPath];
    if (savedElectron) require.cache[electronPath] = savedElectron;
    else delete require.cache[electronPath];
  }

  const emit = (channel, payload) => {
    for (const listener of [...(listeners.get(channel) || [])]) listener({}, payload);
  };

  return { api, emit, count: (channel) => (listeners.get(channel) || []).length };
}

describe("preload channel subscriptions", () => {
  it("delivers one channel to every listener", () => {
    // The window watches for a finished update while Settings shows the whole
    // check. Registering the second must not silence the first.
    const { api, emit } = loadPreload();

    const window = [];
    const settings = [];
    api.updater.onState((state) => window.push(state));
    api.updater.onState((state) => settings.push(state));

    emit("updater-state", { status: "checking" });

    expect(window).toEqual([{ status: "checking" }]);
    expect(settings).toEqual([{ status: "checking" }]);
  });

  it("removes only the listener that is disposed", () => {
    const { api, emit, count } = loadPreload();

    const kept = [];
    const stop = api.updater.onState(() => expect.unreachable("disposed"));
    api.updater.onState((state) => kept.push(state));

    stop();
    emit("updater-state", { status: "current" });

    expect(kept).toEqual([{ status: "current" }]);
    expect(count("updater-state")).toBe(1);
  });

  it("returns a disposer from every subscription", () => {
    const { api } = loadPreload();

    const subscriptions = [
      () => api.updater.onState(() => {}),
      () => api.mcp.onState(() => {}),
      () => api.library.onProgress(() => {}),
      () => api.browserBar.onState(() => {}),
      () => api.onDownloadProgress(() => {}),
      () => api.onBootModel(() => {}),
    ];

    for (const subscribe of subscriptions) {
      expect(typeof subscribe()).toBe("function");
    }
  });

  it("exposes no blanket unsubscribe that would drop another listener", () => {
    const { api } = loadPreload();

    const groups = [api, api.updater, api.mcp, api.library, api.browserBar];
    const offenders = groups.flatMap((group) =>
      Object.keys(group).filter((key) => /^off/.test(key)),
    );

    expect(offenders).toEqual([]);
  });
});
