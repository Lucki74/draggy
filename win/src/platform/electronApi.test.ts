import Module, { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { createElectronApi } from "./electronApi";
import type { IpcLike } from "./electronApi";

const require = createRequire(import.meta.url);

type Listener = (event: unknown, value: unknown) => void;

function fakeIpc() {
  const listeners = new Map<string, Listener[]>();
  const sent: unknown[][] = [];
  const ipc: IpcLike = {
    invoke: async () => null,
    send: (channel, ...args) => {
      sent.push([channel, ...args]);
    },
    on: (channel, listener) => {
      listeners.set(channel, [...(listeners.get(channel) ?? []), listener]);
    },
    removeListener: (channel, listener) => {
      listeners.set(channel, (listeners.get(channel) ?? []).filter((one) => one !== listener));
    },
  };
  const emit = (channel: string, value?: unknown) => {
    for (const listener of [...(listeners.get(channel) ?? [])]) listener({}, value);
  };
  return { ipc, sent, emit, count: (channel: string) => (listeners.get(channel) ?? []).length };
}

/** What preload.cjs exposes, loaded against a stub electron. */
function loadPreloadApi(): unknown {
  let api: unknown = null;
  const stub = fakeIpc().ipc;
  const electron = {
    ipcRenderer: stub,
    contextBridge: { exposeInMainWorld: (_name: string, value: unknown) => (api = value) },
  };
  const electronPath = require.resolve("electron");
  const preloadPath = require.resolve("../../electron/preload.cjs");
  const saved = require.cache[electronPath];
  const stand = new Module(electronPath);
  stand.exports = electron;
  stand.loaded = true;
  require.cache[electronPath] = stand;
  delete require.cache[preloadPath];
  try {
    require("../../electron/preload.cjs");
  } finally {
    delete require.cache[preloadPath];
    if (saved) require.cache[electronPath] = saved;
    else delete require.cache[electronPath];
  }
  return api;
}

/** Every key path, with functions marked, so two APIs compare by shape. */
function shape(value: unknown, prefix = ""): string[] {
  if (typeof value === "function") return [`${prefix} (fn)`];
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .flatMap((key) => shape((value as Record<string, unknown>)[key], prefix ? `${prefix}.${key}` : key));
  }
  return [`${prefix} (${typeof value})`];
}

describe("createElectronApi", () => {
  it("exposes the same key tree as preload.cjs", () => {
    expect(shape(createElectronApi(fakeIpc().ipc))).toEqual(shape(loadPreloadApi()));
  });

  it("removes only its own listener and warns once past 20", () => {
    const { ipc, sent, count } = fakeIpc();
    const api = createElectronApi(ipc);
    const disposers = Array.from({ length: 22 }, () => api.pricing.onUpdated(() => {}));
    expect(count("pricing-updated")).toBe(22);
    expect(sent.filter(([channel]) => channel === "logs:write")).toHaveLength(1);
    disposers[0]();
    disposers[0]();
    expect(count("pricing-updated")).toBe(21);
  });

  it("answers the quit handshake after the handlers settle, even with none", async () => {
    const { ipc, sent, emit } = fakeIpc();
    const api = createElectronApi(ipc);
    emit("app:flush-saves");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toContainEqual(["app:saves-flushed"]);

    let ran = false;
    const off = api.onBeforeQuit(async () => {
      ran = true;
    });
    emit("app:flush-saves");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ran).toBe(true);
    off();
  });

  it("replays a boot model that arrived before anyone subscribed", () => {
    const { ipc, emit } = fakeIpc();
    const api = createElectronApi(ipc);
    emit("boot-model", "gguf:x");
    const seen: unknown[] = [];
    api.onBootModel((model) => seen.push(model));
    expect(seen).toEqual(["gguf:x"]);
  });
});
