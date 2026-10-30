import path from "node:path";
import Module from "node:module";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

/** Loads the preload with a stub `electron` and hands back the API it exposes along with the
 * channel listeners it registered. */
function loadPreload() {
  const listeners = new Map();
  const sent = [];
  const messages = [];
  const invoked = [];

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
    invoke: async (...args) => {
      invoked.push(args);
    },
    send: (channel, ...args) => {
      sent.push(channel);
      messages.push([channel, ...args]);
    },
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

  return { api, emit, sent, messages, invoked, count: (channel) => (listeners.get(channel) || []).length };
}

describe("preload channel subscriptions", () => {
  it("delivers image progress to the card and the settings page at once", () => {
    // A chat card and the Models page both watch one image job; neither may silence the other.
    const { api, emit, count } = loadPreload();

    const card = [];
    const page = [];
    const stopCard = api.sd.onProgress((event) => card.push(event.status));
    api.sd.onProgress((event) => page.push(event.status));

    emit("sd:progress", { requestId: "a", status: "generating" });
    stopCard();
    emit("sd:progress", { requestId: "a", status: "done" });

    expect(card).toEqual(["generating"]);
    expect(page).toEqual(["generating", "done"]);
    expect(count("sd:progress")).toBe(1);
  });

  it("warns once when one channel passes 20 listeners, and stops counting disposed ones", () => {
    const { api, messages } = loadPreload();

    const disposers = [];
    for (let i = 0; i < 25; i++) disposers.push(api.updater.onState(() => {}));

    const warnings = messages.filter(([channel, entry]) => channel === "logs:write" && entry.message === "listener leak suspected");
    expect(warnings).toHaveLength(1);
    expect(warnings[0][1]).toMatchObject({ level: "WARN", data: { channel: "updater-state", listeners: 21 } });

    for (const dispose of disposers) dispose();
    for (const dispose of disposers) dispose();
    api.updater.onState(() => {});
    expect(messages.filter(([, entry]) => entry?.message === "listener leak suspected")).toHaveLength(1);
  });

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
      () => api.sd.onProgress(() => {}),
      () => api.hardware.onBenchmarkProgress(() => {}),
      () => api.colibri.onInstallProgress(() => {}),
      () => api.largeModel.onProgress(() => {}),
      () => api.browserBar.onState(() => {}),
      () => api.browserPane.onOpen(() => {}),
      () => api.onDownloadProgress(() => {}),
      () => api.onBootModel(() => {}),
      () => api.onBootOpen(() => {}),
      () => api.onBeforeQuit(() => {}),
      () => api.tts.onFrames(() => {}),
    ];

    for (const subscribe of subscriptions) {
      expect(typeof subscribe()).toBe("function");
    }
  });

  it("hands the boot model to an app that subscribes after it arrived", () => {
    // Sent once when the page loads; React subscribes later, and the window stayed blank.
    const { api, emit } = loadPreload();
    emit("boot-model", "Qwen3.5-9B-Q4_K_M.gguf");

    const seen = [];
    api.onBootModel((model) => seen.push(model));
    emit("boot-model", "other.gguf");

    expect(seen).toEqual(["Qwen3.5-9B-Q4_K_M.gguf", "other.gguf"]);
  });

  it("exposes no blanket unsubscribe that would drop another listener", () => {
    const { api } = loadPreload();

    const groups = [api, api.updater, api.mcp, api.library, api.browserBar, api.browserPane, api.sd];
    const offenders = groups.flatMap((group) =>
      Object.keys(group).filter((key) => /^off/.test(key)),
    );

    expect(offenders).toEqual([]);
  });
});

describe("the splash's handoff", () => {
  it("asks main to open only the Providers page, whatever else the renderer passes", () => {
    const { api, messages } = loadPreload();
    api.bootFinished("m.gguf");
    api.bootFinished("", "providers");
    api.bootFinished("", "../settings");
    expect(messages).toEqual([
      ["boot-finished", "m.gguf", undefined],
      ["boot-finished", "", "providers"],
      ["boot-finished", "", undefined],
    ]);
  });

  it("delivers the page to open to the main window's listener", () => {
    const { api, emit } = loadPreload();
    const opened = [];
    const dispose = api.onBootOpen((page) => opened.push(page));
    emit("boot-open", "providers");
    dispose();
    emit("boot-open", "providers");
    expect(opened).toEqual(["providers"]);
  });
});

describe("saving before a quit", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("answers only once every handler has finished", async () => {
    const { api, emit, sent } = loadPreload();

    let release;
    api.onBeforeQuit(() => new Promise((resolve) => (release = resolve)));
    emit("app:flush-saves");
    await settle();
    expect(sent).not.toContain("app:saves-flushed");

    release();
    await settle();
    expect(sent).toEqual(["app:saves-flushed"]);
  });

  it("answers straight away with nothing to save, or when a handler fails", async () => {
    const { api, emit, sent } = loadPreload();

    emit("app:flush-saves");
    await settle();
    expect(sent).toEqual(["app:saves-flushed"]);

    api.onBeforeQuit(() => {
      throw new Error("boom");
    });
    emit("app:flush-saves");
    await settle();
    expect(sent).toEqual(["app:saves-flushed", "app:saves-flushed"]);
  });
});

describe("the providers bridge", () => {
  it("exposes exactly the provider calls, each on its own channel, and none that reads a key", async () => {
    const { api, invoked } = loadPreload();

    expect(Object.keys(api.providers).sort()).toEqual([
      "accountCancel",
      "accountSignIn",
      "accountSignOut",
      "accountStatus",
      "accountSubmitCode",
      "add",
      "catalog",
      "list",
      "models",
      "onAccountProgress",
      "onModelsChanged",
      "remove",
      "scan",
      "setKey",
      "test",
      "update",
    ]);
    await api.providers.catalog();
    await api.providers.list();
    await api.providers.add({ type: "openai" });
    await api.providers.update("openai", { enabled: true });
    await api.providers.remove("openai");
    await api.providers.setKey("openai", "sk-test");
    await api.providers.test("openai");
    await api.providers.models("openai", { refresh: true });
    await api.providers.scan();
    await api.providers.accountSignIn("chatgpt");
    await api.providers.accountCancel("chatgpt");
    await api.providers.accountSubmitCode("google", "4/0code");
    await api.providers.accountSignOut("chatgpt");
    await api.providers.accountStatus("chatgpt");

    expect(invoked).toEqual([
      ["providers:catalog"],
      ["providers:list"],
      ["providers:add", { type: "openai" }],
      ["providers:update", "openai", { enabled: true }],
      ["providers:remove", "openai"],
      ["providers:set-key", "openai", "sk-test"],
      ["providers:test", "openai"],
      ["providers:models", "openai", { refresh: true }],
      ["providers:scan"],
      ["providers:account-sign-in", "chatgpt"],
      ["providers:account-cancel", "chatgpt"],
      ["providers:account-submit-code", "google", "4/0code"],
      ["providers:account-sign-out", "chatgpt"],
      ["providers:account-status", "chatgpt"],
    ]);
  });

  it("gives every sign-in progress listener its own disposer", () => {
    const { api, emit } = loadPreload();
    const first = [];
    const second = [];
    const stopFirst = api.providers.onAccountProgress((progress) => first.push(progress.step));
    api.providers.onAccountProgress((progress) => second.push(progress.step));
    emit("providers:account-progress", { id: "chatgpt", step: "browser" });
    stopFirst();
    emit("providers:account-progress", { id: "chatgpt", step: "done" });
    expect(first).toEqual(["browser"]);
    expect(second).toEqual(["browser", "done"]);
  });
});

describe("the Brave Search key", () => {
  it("can be set and asked about, never read", async () => {
    const { api, invoked } = loadPreload();

    expect(Object.keys(api).filter((key) => /brave/i.test(key)).sort()).toEqual(["braveKeyStatus", "setBraveKey"]);
    await api.setBraveKey("BSA-x");
    await api.braveKeyStatus();
    expect(invoked).toEqual([["search:set-brave-key", "BSA-x"], ["search:brave-key-status"]]);
  });
});

describe("the first-run setup's bridge", () => {
  it("exposes exactly the four calls the spec allows, each on its own channel", async () => {
    const { api, invoked } = loadPreload();

    expect(Object.keys(api.onboarding).sort()).toEqual(["complete", "reset", "start", "state"]);
    await api.onboarding.state();
    await api.onboarding.start();
    await api.onboarding.complete("local");
    await api.onboarding.reset();

    expect(invoked).toEqual([
      ["onboarding:state"],
      ["onboarding:start"],
      ["onboarding:complete", "local"],
      ["onboarding:reset"],
    ]);
  });
});

describe("the speech bridge", () => {
  it("offers consent, speak and cancel on their own channels, and nothing that reads a key", async () => {
    const { api, invoked } = loadPreload();

    expect(Object.keys(api.tts).sort()).toEqual(["cancel", "grantConsent", "onFrames", "providers", "revokeConsent", "speak"]);

    await api.tts.providers();
    await api.tts.grantConsent("openai");
    await api.tts.revokeConsent("openai");
    await api.tts.speak(3, { provider: "openai", text: "hi" });
    await api.tts.cancel(3);

    expect(invoked.map(([channel]) => channel)).toEqual([
      "tts:providers",
      "tts:consent-grant",
      "tts:consent-revoke",
      "tts:speak",
      "tts:cancel",
    ]);
  });

  it("delivers frames to each listener and stops after its disposer runs", () => {
    const { api, emit } = loadPreload();
    const seen = [];
    const stop = api.tts.onFrames((frame) => seen.push(frame));

    emit("tts:frames", { turnId: 1 });
    stop();
    emit("tts:frames", { turnId: 2 });

    expect(seen).toEqual([{ turnId: 1 }]);
  });
});

describe("the shell bridge", () => {
  it("exposes exactly the terminal calls, and subscriptions return disposers", () => {
    const { api } = loadPreload();

    expect(Object.keys(api.shell).sort()).toEqual(["close", "list", "onData", "onExit", "open", "resize", "write"]);
    expect(typeof api.shell.onData(() => {})).toBe("function");
    expect(typeof api.shell.onExit(() => {})).toBe("function");
  });
});
