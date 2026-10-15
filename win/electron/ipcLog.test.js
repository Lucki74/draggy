import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const logger = require("./logger.cjs");
const { createIpc, sendTo, slowLimit, argBytes } = require("./ipcLog.cjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));

function fakeIpcMain() {
  const handlers = new Map();
  const listeners = new Map();
  return {
    handlers,
    listeners,
    handle: (channel, fn) => handlers.set(channel, fn),
    on: (channel, fn) => listeners.set(channel, fn),
    removeListener: (channel, fn) => {
      if (listeners.get(channel) === fn) listeners.delete(channel);
    },
  };
}

let tempDir;
let files;

const events = () =>
  fs
    .readFileSync(files.eventsFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-ipc-test-"));
  files = logger.init({ getPath: () => tempDir, getName: () => "Draggy", getVersion: () => "0" });
});

afterEach(async () => {
  await logger.closeStreams();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("ipc wrapper", () => {
  it("logs channel, duration, argument count and size, never the values", async () => {
    const main = fakeIpcMain();
    createIpc(main).handle("fs:read", async (_event, a, b) => `${b}${a.cid}`);
    const result = await main.handlers.get("fs:read")({}, { cid: "turn-7" }, "secret file name");
    await logger.flush();

    expect(result).toBe("secret file nameturn-7");
    const line = events().find((e) => e.msg === "fs:read");
    expect(line).toMatchObject({ level: "DEBUG", scope: "ipc.fs", cid: "turn-7", data: { channel: "fs:read", argc: 2 } });
    expect(line.data.bytes).toBeGreaterThan(10);
    expect(JSON.stringify(line)).not.toContain("secret file name");
  });

  it("takes an image job's request id as its correlation id", async () => {
    const main = fakeIpcMain();
    createIpc(main).handle("sd:generate", async () => "done");
    await main.handlers.get("sd:generate")({}, { requestId: "img-42", prompt: "a private prompt" });
    await logger.flush();

    const line = events().find((e) => e.msg === "sd:generate");
    expect(line.cid).toBe("img-42");
    expect(JSON.stringify(line)).not.toContain("a private prompt");
  });

  it("logs a thrown or rejected handler at ERROR with the code and rethrows", async () => {
    const main = fakeIpcMain();
    const ipc = createIpc(main);
    ipc.handle("a:sync", () => {
      throw Object.assign(new Error("nope"), { code: "EACCES" });
    });
    ipc.handle("a:async", async () => {
      throw new Error("later");
    });
    expect(() => main.handlers.get("a:sync")({})).toThrow("nope");
    await expect(main.handlers.get("a:async")({})).rejects.toThrow("later");
    await logger.flush();

    const failed = events().filter((e) => e.level === "ERROR");
    expect(failed.map((e) => e.msg)).toEqual(["a:sync failed", "a:async failed"]);
    expect(failed[0].err.code).toBe("EACCES");
  });

  it("warns when a handler passes its limit, with a higher bar for long channels", async () => {
    expect(slowLimit("fs:read")).toBe(2000);
    expect(slowLimit("gguf:start")).toBeGreaterThan(2000);
    const main = fakeIpcMain();
    createIpc(main).handle("slow:one", () => new Promise((resolve) => setTimeout(resolve, 2100)));
    await main.handlers.get("slow:one")({});
    await logger.flush();

    expect(events().find((e) => e.msg === "slow:one slow")).toMatchObject({ level: "WARN", data: { limitMs: 2000 } });
  }, 10000);

  it("does not log the log's own channels", async () => {
    const main = fakeIpcMain();
    const fn = () => 1;
    createIpc(main).handle("logs:batch", fn);
    expect(main.handlers.get("logs:batch")).toBe(fn);
  });

  it("removes a wrapped listener through the original function", () => {
    const main = fakeIpcMain();
    const ipc = createIpc(main);
    const listener = () => {};
    ipc.on("flush:done", listener);
    expect(main.listeners.has("flush:done")).toBe(true);
    ipc.removeListener("flush:done", listener);
    expect(main.listeners.has("flush:done")).toBe(false);
  });

  it("measures strings, buffers and objects without throwing on cycles", () => {
    const cyclic = {};
    cyclic.self = cyclic;
    expect(argBytes(["abc", Buffer.alloc(5), { a: 1 }, cyclic, null])).toBe(3 + 5 + 7);
  });
});

describe("sending to a window", () => {
  it("sends to a live window and drops quietly for a destroyed one", async () => {
    const sent = [];
    const live = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (...args) => sent.push(args) } };
    const dead = { isDestroyed: () => true, webContents: { isDestroyed: () => true, send: () => { throw new Error("Object has been destroyed"); } } };
    const throwing = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: () => { throw new Error("boom"); } } };

    expect(sendTo(live, "x:y", 1)).toBe(true);
    expect(sendTo(dead, "x:y", 1)).toBe(false);
    expect(sendTo(throwing, "x:z")).toBe(false);
    expect(sendTo(null, "x:y")).toBe(false);
    await logger.flush();

    expect(sent).toEqual([["x:y", 1]]);
    expect(events().filter((e) => e.scope === "ipc.send").map((e) => e.level)).toEqual(["DEBUG", "DEBUG", "DEBUG"]);
  });
});

describe("one choke point", () => {
  it("registers every IPC handler through electron/ipcLog.cjs", () => {
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "fixtures" && entry.name !== "node_modules") walk(full);
        } else if (/\.(cjs|js)$/.test(entry.name) && !entry.name.endsWith(".test.js") && entry.name !== "ipcLog.cjs") {
          const text = fs.readFileSync(full, "utf8");
          if (/\bipcMain\s*\.\s*(handle|on|once|handleOnce)\s*\(/.test(text)) offenders.push(path.relative(HERE, full));
        }
      }
    };
    walk(HERE);
    expect(offenders, "register through the wrapper from electron/ipcLog.cjs").toEqual([]);
  });
});
