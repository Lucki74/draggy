import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const platform = require("./platform.cjs");
const llamaProcess = require("./llamaProcess.cjs");

const quiet = { info() {}, debug() {}, warn() {}, error() {} };

describe("llamaProcess.startServer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    llamaProcess.stopServerSync();
  });

  it("launches one slot with the speed flags and the GPU runner environment", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-llama-"));
    const llama = path.join(userData, "bin", "llama");
    fs.mkdirSync(path.join(llama, "vulkan"), { recursive: true });
    const saved = { win: platform.IS_WINDOWS, mac: platform.IS_MAC };
    // A stand-in that answers the health check, but only once spawned, or startServer adopts it.
    const health = http.createServer((_req, res) => res.end("ok"));
    await new Promise((resolve) => health.listen(0, "127.0.0.1", resolve));
    const port = health.address().port;
    await new Promise((resolve) => health.close(resolve));

    let call;
    vi.spyOn(platform, "spawnHidden").mockImplementation((file, args, options) => {
      call = { file, args, options };
      health.listen(port, "127.0.0.1");
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.exitCode = null;
      return child;
    });

    try {
      platform.IS_WINDOWS = true;
      platform.IS_MAC = false;
      const result = await llamaProcess.startServer({
        binaryPath: path.join(llama, "llama-server.exe"),
        modelPath: "m.gguf",
        userDataDir: userData,
        vramGB: 4,
        port,
        log: quiet,
      });
      expect(result.success).toBe(true);
    } finally {
      platform.IS_WINDOWS = saved.win;
      platform.IS_MAC = saved.mac;
      await new Promise((resolve) => health.close(resolve));
      fs.rmSync(userData, { recursive: true, force: true });
    }

    const { args, options } = call;
    const flag = (name) => args[args.indexOf(name) + 1];
    expect(flag("--parallel")).toBe("1");
    expect(flag("-b")).toBe("2048");
    expect(flag("-ub")).toBe("512");
    expect(flag("-t")).toBe(String(Math.min(8, os.cpus().length)));
    expect(flag("--cache-reuse")).toBe("256");
    expect(flag("-ngl")).toBe("99");
    expect(flag("--host")).toBe("127.0.0.1");
    expect(args).toContain("--jinja");
    // A bare -fa would swallow the next flag as its value on current llama.cpp builds.
    expect(args).not.toContain("-fa");
    expect(options.env.LLAMA_ARG_FLASH_ATTN).toBe("on");
    expect(flag("-ctk")).toBe("q8_0");
    expect(flag("-ctv")).toBe("q8_0");
    expect(options.env.LLAMA_ARG_CACHE_TYPE_K).toBe("q8_0");
    expect(options.env.LLAMA_ARG_CACHE_TYPE_V).toBe("q8_0");
    expect(options.env.GGML_BACKEND_PATH).toBe(path.join(llama, "vulkan", "ggml-vulkan.dll"));
    expect(options.env.PATH.startsWith(path.join(llama, "vulkan") + path.delimiter + llama)).toBe(true);
    expect(options.cwd).toBe(llama);
  });
});

describe("llamaProcess.determineKvCache", () => {
  const GB = 1024 ** 3;
  const withModelSize = (bytes) => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "statSync").mockReturnValue({ size: bytes });
  };

  afterEach(() => vi.restoreAllMocks());

  it("defaults to q8_0 and the requested context when no VRAM is known", () => {
    withModelSize(9 * GB);
    expect(llamaProcess.determineKvCache("m.gguf", 16384)).toEqual({ cacheType: "q8_0", effectiveContext: 16384 });
  });

  it("defaults to q8_0 and the requested context when the model file is missing", () => {
    expect(llamaProcess.determineKvCache(path.join(os.tmpdir(), "draggy-absent.gguf"), 16384, 12)).toEqual({
      cacheType: "q8_0",
      effectiveContext: 16384,
    });
  });

  it("keeps q8_0 when the weights leave room for the cache", () => {
    withModelSize(4 * GB);
    expect(llamaProcess.determineKvCache("m.gguf", 16384, 12)).toEqual({ cacheType: "q8_0", effectiveContext: 16384 });
  });

  it("drops to q4_0 when a 9 GB model leaves too little headroom on a 12 GB card", () => {
    withModelSize(9.05 * GB);
    expect(llamaProcess.determineKvCache("phi-4-Q4_K_M.gguf", 16384, 12)).toEqual({
      cacheType: "q4_0",
      effectiveContext: 16384,
    });
  });

  it("clamps the context to what still fits, never below 4096", () => {
    withModelSize(9.05 * GB);
    expect(llamaProcess.determineKvCache("m.gguf", 16384, 11)).toEqual({ cacheType: "q4_0", effectiveContext: 4096 });
    withModelSize(9.6 * GB);
    const { effectiveContext } = llamaProcess.determineKvCache("m.gguf", 65536, 12);
    expect(effectiveContext).toBeGreaterThan(4096);
    expect(effectiveContext).toBeLessThan(65536);
  });
});
