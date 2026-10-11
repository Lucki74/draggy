import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const platform = require("./platform.cjs");
const embedServer = require("./embedServer.cjs");

const quiet = { info() {}, debug() {}, warn() {}, error() {} };

const fakeChild = () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  return child;
};

const freePort = async () => {
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
};

function modelsFolder(...names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-embed-"));
  for (const name of names) fs.writeFileSync(path.join(dir, name), "x");
  return dir;
}

describe("embedServer.resolveModelFile", () => {
  it("finds the exact file, or the first one of the family a tier is named after", () => {
    const dir = modelsFolder("Qwen3-Embedding-0.6B-Q8_0.gguf", "Qwen3-Embedding-4B-Q4_K_M.gguf", "chat-Q4_K_M.gguf");
    try {
      expect(embedServer.resolveModelFile(dir, "Qwen3-Embedding-4B-Q4_K_M.gguf")).toBe(path.join(dir, "Qwen3-Embedding-4B-Q4_K_M.gguf"));
      expect(embedServer.resolveModelFile(dir, "qwen3-embedding-0.6b")).toBe(path.join(dir, "Qwen3-Embedding-0.6B-Q8_0.gguf"));
      expect(embedServer.resolveModelFile(dir, "nomic-embed-text")).toBeNull();
      expect(embedServer.resolveModelFile(dir, "")).toBeNull();
      expect(embedServer.resolveModelFile(path.join(dir, "absent"), "anything")).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("embedServer.ensure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(platform, "killTreeSync").mockImplementation(() => {});
    embedServer.stopSync();
    vi.restoreAllMocks();
  });

  const configure = (dir, port) =>
    embedServer.configure(async () => ({ binaryPath: "llama-server", modelsDir: dir, port, vramGB: 0, log: quiet }));

  it("starts one server in embedding mode that leaves layer placement to --fit, and reuses it", async () => {
    const dir = modelsFolder("nomic-embed-text-v1.5.Q8_0.gguf");
    const port = await freePort();
    const health = http.createServer((_req, res) => res.end("ok"));
    const spawn = vi.spyOn(platform, "spawnHidden").mockImplementation(() => {
      health.listen(port, "127.0.0.1");
      return fakeChild();
    });
    configure(dir, port);

    try {
      const url = await embedServer.ensure("nomic-embed-text");
      expect(url).toBe(`http://127.0.0.1:${port}`);

      const args = spawn.mock.calls[0][1];
      expect(args[args.indexOf("-m") + 1]).toBe(path.join(dir, "nomic-embed-text-v1.5.Q8_0.gguf"));
      expect(args).toContain("--embedding");
      expect(args).not.toContain("-ngl");
      expect(args[args.indexOf("--port") + 1]).toBe(String(port));

      expect(await embedServer.ensure("nomic-embed-text")).toBe(url);
      expect(spawn).toHaveBeenCalledTimes(1);
    } finally {
      vi.spyOn(platform, "killTreeSync").mockImplementation(() => {});
      embedServer.stopSync();
      await new Promise((resolve) => health.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("says the model is not downloaded instead of starting anything", async () => {
    const dir = modelsFolder("chat-Q4_K_M.gguf");
    const spawn = vi.spyOn(platform, "spawnHidden");
    configure(dir, await freePort());

    try {
      await expect(embedServer.ensure("mxbai-embed-large")).rejects.toThrow(/mxbai-embed-large is not downloaded/);
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports why the server stopped as soon as it does", async () => {
    const dir = modelsFolder("all-MiniLM-L6-v2-Q8_0.gguf");
    const child = fakeChild();
    const spawn = vi.spyOn(platform, "spawnHidden").mockReturnValue(child);
    configure(dir, await freePort());

    try {
      const pending = embedServer.ensure("all-minilm");
      await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
      child.stderr.emit("data", Buffer.from("0.00.100.001 E llama_model_load: error loading model: bad magic\n"));
      child.emit("exit", 1, null);

      await expect(pending).rejects.toThrow(/did not start: .*bad magic/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("kills the server tree on stop", async () => {
    const dir = modelsFolder("all-MiniLM-L6-v2-Q8_0.gguf");
    const child = fakeChild();
    const kill = vi.spyOn(platform, "killTreeSync").mockImplementation(() => {});
    const spawn = vi.spyOn(platform, "spawnHidden").mockReturnValue(child);
    configure(dir, await freePort());

    try {
      const pending = embedServer.ensure("all-minilm").catch(() => null);
      await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
      embedServer.stopSync();
      await pending;

      expect(kill).toHaveBeenCalledWith(child);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
