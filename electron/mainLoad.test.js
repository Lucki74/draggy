import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

/**
 * Loads the main process the way Electron would, against a stand-in for
 * Electron itself. Everything main.cjs does at the top level runs: every
 * require, every handler registration, every constant. A handler registered
 * above the helper it uses, a module that fails to load, a typo in a name, all
 * throw here instead of on a user's machine as a window that never opens.
 *
 * The ready event never fires, so no window, database or server is started.
 */

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-main-load-"));

/** Something that can be called, constructed or read from, forever. */
function anything() {
  const target = function () {};
  return new Proxy(target, {
    get: (_target, key) => {
      if (key === "then") return undefined;
      if (key === Symbol.toPrimitive) return () => "";
      return anything();
    },
    apply: () => anything(),
    construct: () => anything(),
  });
}

function fakeElectron() {
  const handlers = new Map();
  const listeners = new Map();

  const app = new Proxy(
    {
      getPath: () => scratch,
      setPath: () => {},
      getName: () => "Draggy",
      getVersion: () => "0.0.0-test",
      isPackaged: false,
      whenReady: () => new Promise(() => {}),
      on: () => app,
      once: () => app,
      commandLine: { appendSwitch: () => {} },
    },
    { get: (target, key) => (key in target ? target[key] : anything()) },
  );

  const ipcMain = {
    handle: (channel, handler) => {
      if (handlers.has(channel)) throw new Error(`${channel} is handled twice`);
      if (typeof handler !== "function") throw new Error(`${channel} has no handler`);
      handlers.set(channel, handler);
    },
    on: (channel, listener) => {
      listeners.set(channel, listener);
    },
    removeHandler: () => {},
  };

  const electron = new Proxy(
    { app, ipcMain },
    { get: (target, key) => (key in target ? target[key] : anything()) },
  );

  return { electron, handlers, listeners };
}

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe("loading the main process", () => {
  it("runs its top level without throwing, and registers its handlers", () => {
    const { electron, handlers, listeners } = fakeElectron();

    const electronPath = require.resolve("electron");
    const mainPath = require.resolve("./main.cjs");
    const previous = require.cache[electronPath];

    require.cache[electronPath] = {
      id: electronPath,
      filename: electronPath,
      loaded: true,
      exports: electron,
    };
    delete require.cache[mainPath];

    try {
      expect(() => require("./main.cjs")).not.toThrow();
    } finally {
      if (previous) require.cache[electronPath] = previous;
      else delete require.cache[electronPath];
    }

    // A few from each area, so a whole block silently not registering shows.
    for (const channel of [
      "fs:write",
      "checkpoint:revert",
      "git:status",
      "metrics:list",
      "widget:stage",
      "api-server:status",
      "mcp:call",
    ]) {
      expect(handlers.has(channel), channel).toBe(true);
    }
    expect(listeners.has("api-server:done")).toBe(true);
  });
});
