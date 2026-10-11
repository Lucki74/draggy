import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import http from "node:http";

const require = createRequire(import.meta.url);
const modelStorage = require("./modelStorage.cjs");
const { GGUF_MAGIC } = require("./ggufParser.cjs");
const logger = require("./logger.cjs");

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

  it("gives up on a connection that stops sending, and keeps the partial to continue from", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-stall-"));
    try {
      const url = await serve((req, res) => {
        res.writeHead(200, { "content-length": 100000 });
        res.write(Buffer.alloc(1024));
      });
      const outcome = await modelStorage.downloadGgufModel({ url, modelsDir: tmpDir, filename: "model.gguf", stallMs: 300, retries: 0 }).catch((err) => err);

      expect(outcome.message).toMatch(/stalled/);
      expect(fs.readdirSync(tmpDir)).toEqual(["model.gguf.download"]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 10_000);

  it("keeps a download going past the stall limit after a redirect, as every Hugging Face one has", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-redirect-"));
    try {
      const url = await serve((req, res) => {
        if (req.url !== "/file") {
          res.writeHead(302, { location: "/file", "content-length": 5 });
          return res.end("moved");
        }
        res.writeHead(200, { "content-length": 8 * 1024 });
        let sent = 0;
        const timer = setInterval(() => {
          res.write(Buffer.alloc(1024));
          if (++sent === 8) {
            clearInterval(timer);
            res.end();
          }
        }, 100);
      });
      const outcome = await modelStorage.downloadGgufModel({ url, modelsDir: tmpDir, filename: "model.gguf", stallMs: 300 }).catch((err) => err);

      expect(outcome.success).toBe(true);
      expect(fs.statSync(path.join(tmpDir, "model.gguf")).size).toBe(8 * 1024);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 10_000);
});

describe("downloadGgufModel resume", () => {
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

  const FILE = Buffer.from(Array.from({ length: 10_000 }, (_, i) => i % 251));

  /** A server that honours Range; `cutFirst` ends the first answer after that many bytes. */
  const rangeHandler = (cutFirst) => {
    let calls = 0;
    const seen = [];
    const handler = (req, res) => {
      calls += 1;
      const match = /bytes=(\d+)-/.exec(req.headers.range || "");
      seen.push(req.headers.range || null);
      const start = match ? Number(match[1]) : 0;
      const body = FILE.subarray(start);
      if (match) res.writeHead(206, { "content-length": body.length, "content-range": `bytes ${start}-${FILE.length - 1}/${FILE.length}` });
      else res.writeHead(200, { "content-length": body.length });
      if (calls === 1 && cutFirst) {
        res.write(body.subarray(0, cutFirst));
        setTimeout(() => res.destroy(), 20);
        return;
      }
      res.end(body);
    };
    return { handler, seen };
  };

  it("carries on from the bytes it has when the connection drops, and the file comes out whole", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-resume-"));
    try {
      const { handler, seen } = rangeHandler(4000);
      const url = await serve(handler);
      const events = [];
      const outcome = await modelStorage.downloadGgufModel({ url, modelsDir: tmpDir, filename: "model.gguf", retryDelayMs: 10, onProgress: (p) => events.push(p) });

      expect(outcome.success).toBe(true);
      expect(Buffer.compare(fs.readFileSync(path.join(tmpDir, "model.gguf")), FILE)).toBe(0);
      expect(seen[0]).toBeNull();
      expect(seen[1]).toMatch(/^bytes=\d+-$/);
      // Progress counts what was kept: it never starts the second try from zero.
      const afterDrop = events.filter((e) => e.phase === "downloading").at(-1);
      expect(afterDrop.completed).toBe(FILE.length);
      expect(afterDrop.total).toBe(FILE.length);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 10_000);

  it("continues a partial left by an earlier run", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-resume-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "model.gguf.download"), FILE.subarray(0, 6000));
      const { handler, seen } = rangeHandler(0);
      const url = await serve(handler);
      await modelStorage.downloadGgufModel({ url, modelsDir: tmpDir, filename: "model.gguf" });

      expect(seen).toEqual(["bytes=6000-"]);
      expect(Buffer.compare(fs.readFileSync(path.join(tmpDir, "model.gguf")), FILE)).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("starts over when the server ignores Range and sends the whole file", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-resume-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "model.gguf.download"), Buffer.alloc(3000, 7));
      const url = await serve((req, res) => {
        res.writeHead(200, { "content-length": FILE.length });
        res.end(FILE);
      });
      await modelStorage.downloadGgufModel({ url, modelsDir: tmpDir, filename: "model.gguf" });

      expect(Buffer.compare(fs.readFileSync(path.join(tmpDir, "model.gguf")), FILE)).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("starts over when the partial is longer than the file (416)", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-resume-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "model.gguf.download"), Buffer.alloc(FILE.length + 50, 1));
      const url = await serve((req, res) => {
        if (req.headers.range) {
          res.writeHead(416);
          return res.end();
        }
        res.writeHead(200, { "content-length": FILE.length });
        res.end(FILE);
      });
      await modelStorage.downloadGgufModel({ url, modelsDir: tmpDir, filename: "model.gguf" });

      expect(Buffer.compare(fs.readFileSync(path.join(tmpDir, "model.gguf")), FILE)).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("fails, instead of waiting forever, when the connection closes early and no tries are left", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-resume-"));
    try {
      const url = await serve((req, res) => {
        res.writeHead(200, { "content-length": 5000 });
        res.write(Buffer.alloc(1000));
        setTimeout(() => res.destroy(), 20);
      });
      const outcome = await modelStorage.downloadGgufModel({ url, modelsDir: tmpDir, filename: "model.gguf", retries: 0 }).catch((err) => err);

      expect(outcome).toBeInstanceOf(Error);
      expect(fs.existsSync(path.join(tmpDir, "model.gguf"))).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 10_000);
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

describe("modelStorage single-file checksum logging", () => {
  let logDir;
  let eventsFile;
  let server;

  const events = () =>
    fs
      .readFileSync(eventsFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

  beforeEach(() => {
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-ms-log-"));
    eventsFile = logger.init({ getPath: () => logDir, getName: () => "Draggy", getVersion: () => "0" }).eventsFile;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    server?.closeAllConnections();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
    server = null;
    await logger.closeStreams();
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  it("logs no published checksum after the file is written, since the single-file path has no hash", async () => {
    const body = Buffer.from("tiny model bytes");
    server = http.createServer((req, res) => {
      res.writeHead(200, { "content-length": body.length });
      res.end(body);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    vi.spyOn(require("./urlPolicy.cjs"), "isFetchableUrl").mockReturnValue(true);
    const url = `http://127.0.0.1:${server.address().port}/model.gguf?token=secret-value`;

    const outcome = await modelStorage.downloadGgufModel({ url, modelsDir: logDir, filename: "model.gguf", retryDelayMs: 10 });
    expect(outcome.success).toBe(true);

    let line;
    for (let i = 0; i < 100 && !line; i++) {
      await logger.flush();
      line = events().find((e) => e.msg === "no published checksum");
      if (!line) await new Promise((resolve) => setTimeout(resolve, 30));
    }
    expect(line).toMatchObject({ level: "INFO", scope: "engine.models", data: { file: "model.gguf" } });
    expect(fs.existsSync(path.join(logDir, "model.gguf"))).toBe(true);
    expect(JSON.stringify(line)).not.toContain("secret-value");
  });

  it("puts the download id the screen sent on the start and the finish", async () => {
    const body = Buffer.from("tiny model bytes");
    server = http.createServer((req, res) => {
      res.writeHead(200, { "content-length": body.length });
      res.end(body);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    vi.spyOn(require("./urlPolicy.cjs"), "isFetchableUrl").mockReturnValue(true);
    const url = `http://127.0.0.1:${server.address().port}/model.gguf`;

    await modelStorage.downloadGgufModel({ url, modelsDir: logDir, filename: "model.gguf", cid: "dl-42", retryDelayMs: 10 });

    let rows = [];
    for (let i = 0; i < 100 && rows.length < 2; i++) {
      await logger.flush();
      rows = events().filter((e) => e.msg === "download started" || e.msg === "download finished");
      if (rows.length < 2) await new Promise((resolve) => setTimeout(resolve, 30));
    }
    expect(rows.map((row) => row.cid)).toEqual(["dl-42", "dl-42"]);
  });
});
