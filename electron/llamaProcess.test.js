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
    // Passing -ngl at all switches off llama.cpp's --fit, which is what keeps a big model off shared memory.
    expect(args).not.toContain("-ngl");
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

describe("llamaProcess.startServer failures", () => {
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

  const start = (modelPath, port) => llamaProcess.startServer({ binaryPath: "llama-server", modelPath, port, log: quiet });

  afterEach(() => {
    vi.restoreAllMocks();
    llamaProcess.stopServerSync();
  });

  it("says which parts of a split model are missing instead of spawning", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-split-"));
    fs.writeFileSync(path.join(dir, "big-Q4_K_M-00001-of-00003.gguf"), "x");
    const spawn = vi.spyOn(platform, "spawnHidden");

    try {
      const result = await start(path.join(dir, "big-Q4_K_M-00001-of-00003.gguf"), await freePort());

      expect(result.success).toBe(false);
      expect(result.error).toContain("big-Q4_K_M-00002-of-00003.gguf");
      expect(result.error).toContain("big-Q4_K_M-00003-of-00003.gguf");
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds nothing missing when every part, or a single file, is there", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-split-"));
    try {
      for (const name of ["m-00001-of-00002.gguf", "m-00002-of-00002.gguf"]) fs.writeFileSync(path.join(dir, name), "x");
      expect(llamaProcess.missingShards(path.join(dir, "m-00001-of-00002.gguf"))).toEqual([]);
      expect(llamaProcess.missingShards(path.join(dir, "single.gguf"))).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes -ngl only when the caller asks for a layer count, so --fit decides otherwise", async () => {
    vi.spyOn(platform, "killTreeSync").mockImplementation(() => {});
    const spawn = vi.spyOn(platform, "spawnHidden").mockImplementation(() => fakeChild());
    const launch = async (gpuLayers) => {
      const before = spawn.mock.calls.length;
      const pending = llamaProcess.startServer({ binaryPath: "llama-server", modelPath: "m.gguf", gpuLayers, port: await freePort(), log: quiet });
      await vi.waitFor(() => expect(spawn.mock.calls.length).toBe(before + 1));
      const args = spawn.mock.calls.at(-1)[1];
      llamaProcess.stopServerSync();
      await pending;
      return args;
    };

    expect(await launch(undefined)).not.toContain("-ngl");
    const args = await launch(20);
    expect(args[args.indexOf("-ngl") + 1]).toBe("20");
  });

  it("reports why the engine stopped as soon as it does, not after the health check times out", async () => {
    const child = fakeChild();
    const spawn = vi.spyOn(platform, "spawnHidden").mockReturnValue(child);

    const pending = start("m.gguf", await freePort());
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    child.stderr.emit("data", Buffer.from("0.00.130.001 E llama_model_load: error loading model: no such tensor\n"));
    child.emit("exit", 1, null);

    const startedAt = Date.now();
    const result = await pending;

    expect(Date.now() - startedAt).toBeLessThan(3000);
    expect(result.success).toBe(false);
    expect(result.error).toContain("exit code 1");
    expect(result.error).toContain("no such tensor");
  });

  it("gives up on a start that another model replaced, and leaves the newer engine running", async () => {
    const kill = vi.spyOn(platform, "killTreeSync").mockImplementation(() => {});
    const first = fakeChild();
    const second = fakeChild();
    const spawn = vi.spyOn(platform, "spawnHidden").mockReturnValueOnce(first).mockReturnValueOnce(second);
    const port = await freePort();

    const older = start("a.gguf", port);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    const newer = start("b.gguf", port);

    const result = await older;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/another model/i);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(first);
    expect(llamaProcess.getServerStatus().model).toBe("b.gguf");

    llamaProcess.stopServerSync();
    expect((await newer).success).toBe(false);
  });

  it("lets a second request for the same model wait on the first instead of restarting it", async () => {
    const child = fakeChild();
    const spawn = vi.spyOn(platform, "spawnHidden").mockReturnValue(child);
    const port = await freePort();

    const one = start("m.gguf", port);
    const two = start("m.gguf", port);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    child.emit("exit", 1, null);

    expect(await one).toEqual(await two);
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});
