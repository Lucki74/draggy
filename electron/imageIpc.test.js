import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const imageIpc = require("./imageIpc.cjs");

const quiet = { info() {}, debug() {}, warn() {}, error() {} };
const dirs = [];

function setup() {
  const created = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-imageipc-"));
  dirs.push(created);
  const handlers = new Map();
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  const engine = imageIpc.register(ipcMain, {
    app: { getPath: () => created },
    log: quiet,
    broadcast() {},
    wrap: (_scope, handler) => handler,
    platform: {},
    llamaProcess: { getServerStatus: () => ({ running: false }), stopServerSync() {} },
    modelStorage: {},
    huggingface: {},
    fileOps: {},
    fsGuard: {},
    rootsFor: () => [],
    announceChange: (_id, result) => result,
    createdFilesDir: () => created,
    isInsideCreatedFilesDir: (resolved) => path.resolve(resolved).startsWith(path.resolve(created)),
    getSystemSpecs: async () => ({ vram: 0 }),
  });
  return { created, handlers, engine };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("image IPC", () => {
  it("registers every channel the preload exposes", () => {
    const { handlers } = setup();
    expect([...handlers.keys()].sort()).toEqual([
      "sd:cancel",
      "sd:cancel-download",
      "sd:configure",
      "sd:delete-model",
      "sd:download-repo",
      "sd:generate",
      "sd:setup-engine",
      "sd:status",
      "sd:stop",
    ]);
  });

  it("refuses a malformed request before touching the engine", async () => {
    const { handlers } = setup();
    const result = await handlers.get("sd:generate")({}, { prompt: "" });
    expect(result.success).toBe(false);
    expect(result.code).toBe("E_REQUEST");
  });

  it("serves a created picture and nothing outside the folder", async () => {
    const { created, engine } = setup();
    fs.writeFileSync(path.join(created, "lighthouse.png"), Buffer.from([1, 2, 3]));

    const found = engine.serveCreatedImage("lighthouse.png");
    expect(found.status).toBe(200);
    expect(found.headers.get("Content-Type")).toBe("image/png");
    expect(engine.serveCreatedImage("../secret.png").status).toBe(400);
    expect(engine.serveCreatedImage("notes.txt").status).toBe(400);
    expect(engine.serveCreatedImage("missing.png").status).toBe(404);
  });
});
