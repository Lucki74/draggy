import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import http from "node:http";

const require = createRequire(import.meta.url);
const modelStorage = require("./modelStorage.cjs");
const { GGUF_MAGIC } = require("./ggufParser.cjs");

const until = async (check) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
};

function writeDummyGguf(filePath) {
  const buf = Buffer.alloc(128);
  buf.writeUInt32LE(GGUF_MAGIC, 0);
  buf.writeUInt32LE(3, 4);
  buf.writeBigUInt64LE(0n, 8);
  buf.writeBigUInt64LE(0n, 16);
  fs.writeFileSync(filePath, buf);
}

describe("modelStorage", () => {
  it("returns empty array for non-existent directory", () => {
    const missing = path.join(os.tmpdir(), `draggy-models-${Date.now()}`);
    expect(modelStorage.listGgufModels(missing)).toEqual([]);
  });

  it("lists only gguf models and ignores unrelated files", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-models-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "notes.txt"), "hello");
      fs.writeFileSync(path.join(tmpDir, "download.tmp"), "partial");
      writeDummyGguf(path.join(tmpDir, "tiny-test.gguf"));

      const list = modelStorage.listGgufModels(tmpDir);
      expect(list.length).toBe(1);
      expect(list[0].filename).toBe("tiny-test.gguf");
      expect(list[0].size).toBe(128);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("deletes existing model safely and blocks path traversal", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-delete-"));
    try {
      const modelFile = path.join(tmpDir, "to-remove.gguf");
      writeDummyGguf(modelFile);

      expect(fs.existsSync(modelFile)).toBe(true);
      const deleted = modelStorage.deleteGgufModel(tmpDir, "to-remove.gguf");
      expect(deleted).toBe(true);
      expect(fs.existsSync(modelFile)).toBe(false);

      expect(modelStorage.deleteGgufModel(tmpDir, "non-existent.gguf")).toBe(false);

      // Path traversal attempt should strip directory and safely miss target.
      expect(modelStorage.deleteGgufModel(tmpDir, "../../../outside.gguf")).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects download from unsafe private URL", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-dl-"));
    try {
      await expect(
        modelStorage.downloadGgufModel({
          url: "http://192.168.1.1/model.gguf",
          modelsDir: tmpDir,
          filename: "test.gguf",
        })
      ).rejects.toThrow(/security policy/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("cancelDownloadGgufModel", () => {
  let server;
  afterEach(async () => {
    vi.restoreAllMocks();
    server?.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve) ?? resolve());
    server = null;
  });

  // A server that sends part of a body and then stalls, so the download stays in flight.
  async function stallingServer() {
    const state = { closed: false };
    server = http.createServer((req, res) => {
      req.on("close", () => (state.closed = true));
      res.writeHead(200, { "content-length": 100000 });
      res.write(Buffer.alloc(1024));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    vi.spyOn(require("./urlPolicy.cjs"), "isFetchableUrl").mockReturnValue(true);
    return { state, url: `http://127.0.0.1:${server.address().port}/model.gguf` };
  }

  it("destroys the request and leaves no file on disk", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-cancel-"));
    try {
      const { state, url } = await stallingServer();
      const destPath = path.join(tmpDir, "model.gguf");
      let downloaded = 0;
      const download = modelStorage.downloadGgufModel({
        url,
        modelsDir: tmpDir,
        filename: "model",
        onProgress: (p) => (downloaded = p.completed),
      });
      const outcome = download.then(
        () => null,
        (err) => err,
      );
      await until(() => downloaded > 0 && fs.existsSync(`${destPath}.download`));
      fs.writeFileSync(destPath, "older copy");

      await expect(modelStorage.cancelDownloadGgufModel(tmpDir, "model.gguf")).resolves.toEqual({ success: true });

      expect((await outcome).name).toBe("AbortError");
      await until(() => state.closed);
      expect(fs.readdirSync(tmpDir)).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reports a cancel as cancelled even while data is still arriving", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-cancel-"));
    try {
      // Keeps writing after the response starts, so a chunk is always in flight when the cancel lands.
      let timer;
      server = http.createServer((req, res) => {
        res.writeHead(200, { "content-length": 100000000 });
        timer = setInterval(() => { for (let i = 0; i < 8; i++) res.write(Buffer.alloc(65536)); }, 0);
        req.on("close", () => clearInterval(timer));
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      vi.spyOn(require("./urlPolicy.cjs"), "isFetchableUrl").mockReturnValue(true);
      let downloaded = 0;
      const outcome = modelStorage
        .downloadGgufModel({ url: `http://127.0.0.1:${server.address().port}/m.gguf`, modelsDir: tmpDir, filename: "m", onProgress: (p) => (downloaded = p.completed) })
        .catch((err) => err);
      await until(() => downloaded > 0);

      await modelStorage.cancelDownloadGgufModel(tmpDir, "m.gguf");

      expect((await outcome).name).toBe("AbortError");
      clearInterval(timer);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("hands a cancel to the caller as a result, not as an error the main process prints", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-cancel-"));
    try {
      const { url } = await stallingServer();
      const pending = modelStorage.downloadGgufModelForIpc({ url, modelsDir: tmpDir, filename: "model.gguf" });
      await modelStorage.cancelDownloadGgufModel(tmpDir, "model.gguf");

      await expect(pending).resolves.toEqual({ success: false, cancelled: true });

      // The real policy again, so this is refused before any request is made.
      vi.restoreAllMocks();
      await expect(
        modelStorage.downloadGgufModelForIpc({ url: "http://192.168.1.1/m.gguf", modelsDir: tmpDir, filename: "x.gguf" }),
      ).rejects.toThrow(/security policy/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("lets the same file be downloaded again after a cancel", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-cancel-"));
    try {
      const { url } = await stallingServer();
      const first = modelStorage.downloadGgufModel({ url, modelsDir: tmpDir, filename: "model.gguf" });
      const outcome = first.catch((err) => err);
      await modelStorage.cancelDownloadGgufModel(tmpDir, "model");
      expect((await outcome).name).toBe("AbortError");

      const second = modelStorage.downloadGgufModel({ url, modelsDir: tmpDir, filename: "model.gguf" });
      expect(second).not.toBe(first);
      await modelStorage.cancelDownloadGgufModel(tmpDir, "model.gguf");
      await expect(second).rejects.toThrow(/cancelled/);
      expect(fs.readdirSync(tmpDir)).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("keeps an installed model when nothing is downloading", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-cancel-"));
    try {
      writeDummyGguf(path.join(tmpDir, "kept.gguf"));
      fs.writeFileSync(path.join(tmpDir, "kept.gguf.download"), "stale");

      await expect(modelStorage.cancelDownloadGgufModel(tmpDir, "kept.gguf")).resolves.toEqual({ success: true });

      expect(fs.readdirSync(tmpDir)).toEqual(["kept.gguf"]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("downloadGgufModel time remaining", () => {
  let server;
  afterEach(async () => {
    vi.restoreAllMocks();
    server?.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve) ?? resolve());
    server = null;
  });

  async function serve(handler) {
    server = http.createServer(handler);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    vi.spyOn(require("./urlPolicy.cjs"), "isFetchableUrl").mockReturnValue(true);
    return `http://127.0.0.1:${server.address().port}/model.gguf`;
  }

  it("has no estimate until a speed sample exists, then a whole number of seconds", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-eta-"));
    try {
      const url = await serve((req, res) => {
        res.writeHead(200, { "content-length": 100000 });
        res.write(Buffer.alloc(1024));
        setTimeout(() => res.write(Buffer.alloc(1024)), 700);
      });
      const events = [];
      const outcome = modelStorage
        .downloadGgufModel({ url, modelsDir: tmpDir, filename: "model.gguf", onProgress: (p) => events.push(p) })
        .catch((err) => err);
      await until(() => events.some((e) => e.completed === 2048));

      expect(events.find((e) => e.phase === "downloading").remainingSeconds).toBeNull();
      const last = events[events.length - 1];
      expect(Number.isInteger(last.remainingSeconds)).toBe(true);
      expect(last.remainingSeconds).toBeGreaterThan(0);

      await modelStorage.cancelDownloadGgufModel(tmpDir, "model.gguf");
      expect((await outcome).name).toBe("AbortError");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reports zero remaining once the download has finished", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-eta-"));
    try {
      const body = Buffer.alloc(2048);
      const url = await serve((req, res) => {
        res.writeHead(200, { "content-length": body.length });
        res.end(body);
      });
      const events = [];
      await modelStorage.downloadGgufModel({ url, modelsDir: tmpDir, filename: "model.gguf", onProgress: (p) => events.push(p) });

      expect(events[events.length - 1]).toMatchObject({ phase: "done", remainingSeconds: 0 });
      expect(events.filter((e) => e.phase === "downloading").pop().remainingSeconds).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("split models on disk", () => {
  const parts = ["big-Q4_K_M-00001-of-00003.gguf", "big-Q4_K_M-00002-of-00003.gguf", "big-Q4_K_M-00003-of-00003.gguf"];

  it("lists the parts as one model with their combined size", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-split-"));
    try {
      for (const name of parts) writeDummyGguf(path.join(tmpDir, name));
      writeDummyGguf(path.join(tmpDir, "small.gguf"));

      const list = modelStorage.listGgufModels(tmpDir);

      expect(list.map((model) => model.filename).sort()).toEqual([parts[0], "small.gguf"]);
      expect(list.find((model) => model.filename === parts[0]).size).toBe(128 * 3);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("still lists a later part whose first part is gone, so it can be deleted", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-split-"));
    try {
      writeDummyGguf(path.join(tmpDir, parts[1]));
      expect(modelStorage.listGgufModels(tmpDir).map((model) => model.filename)).toEqual([parts[1]]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("deletes every part along with the first", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-split-"));
    try {
      for (const name of parts) writeDummyGguf(path.join(tmpDir, name));
      writeDummyGguf(path.join(tmpDir, "keep.gguf"));

      expect(modelStorage.deleteGgufModel(tmpDir, parts[0])).toBe(true);
      expect(fs.readdirSync(tmpDir)).toEqual(["keep.gguf"]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("vision models", () => {
  const withFolder = (files, run) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-vision-"));
    try {
      for (const name of files) writeDummyGguf(path.join(dir, name));
      return run(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it("marks a model as able to read images when its projector sits beside it, and lists it once", () => {
    withFolder(["seer-Q4_K_M.gguf", "seer-Q4_K_M-mmproj.gguf", "plain-Q4_K_M.gguf"], (dir) => {
      const models = modelStorage.listGgufModels(dir);
      const byName = Object.fromEntries(models.map((model) => [model.filename, model]));

      expect(models.map((model) => model.filename).sort()).toEqual(["plain-Q4_K_M.gguf", "seer-Q4_K_M.gguf"]);
      expect(byName["seer-Q4_K_M.gguf"].capabilities).toContain("vision");
      expect(byName["plain-Q4_K_M.gguf"].capabilities).not.toContain("vision");
    });
  });

  it("removes the projector with the model", () => {
    withFolder(["seer-Q4_K_M.gguf", "seer-Q4_K_M-mmproj.gguf"], (dir) => {
      expect(modelStorage.deleteGgufModel(dir, "seer-Q4_K_M.gguf")).toBe(true);
      expect(fs.readdirSync(dir)).toEqual([]);
    });
  });
});
