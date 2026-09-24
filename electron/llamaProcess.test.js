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
const mmproj = require("./mmproj.cjs");
const cpuTopology = require("./cpuTopology.cjs");

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
    // Vulkan keeps the default micro-batch; CUDA gets a bigger one (see batchSizes).
    expect(flag("-ub")).toBe("512");
    const cores = await cpuTopology.getCpuTopology();
    expect(flag("-t")).toBe(String(cores.performance));
    expect(flag("-tb")).toBe(String(Math.max(cores.performance, cores.physical)));
    // The stand-in binary does not exist, so no --help answer: nothing newer than the base flags is passed.
    expect(args).not.toContain("--spec-default");
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
      expect(result.kind).toBe("parts-missing");
      expect(result.params.parts).toBe("big-Q4_K_M-00002-of-00003.gguf, big-Q4_K_M-00003-of-00003.gguf");
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

  it("hands a vision model its projector, and only when it has one", async () => {
    vi.spyOn(platform, "killTreeSync").mockImplementation(() => {});
    const spawn = vi.spyOn(platform, "spawnHidden").mockImplementation(() => fakeChild());
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-vision-"));
    const launch = async (modelPath) => {
      const before = spawn.mock.calls.length;
      const pending = llamaProcess.startServer({ binaryPath: "llama-server", modelPath, port: await freePort(), log: quiet });
      await vi.waitFor(() => expect(spawn.mock.calls.length).toBe(before + 1));
      const args = spawn.mock.calls.at(-1)[1];
      llamaProcess.stopServerSync();
      await pending;
      return args;
    };

    try {
      fs.writeFileSync(path.join(dir, "seer.gguf"), "x");
      expect(await launch(path.join(dir, "seer.gguf"))).not.toContain("--mmproj");

      fs.writeFileSync(path.join(dir, "seer-mmproj.gguf"), "x");
      const args = await launch(path.join(dir, "seer.gguf"));
      expect(args[args.indexOf("--mmproj") + 1]).toBe(path.join(dir, "seer-mmproj.gguf"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("starts the model without image support when the engine refuses its projector", async () => {
    vi.spyOn(platform, "killTreeSync").mockImplementation(() => {});
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-vision-"));
    fs.writeFileSync(path.join(dir, "seer.gguf"), "x");
    fs.writeFileSync(path.join(dir, "seer-mmproj.gguf"), "x");
    const port = await freePort();
    const health = http.createServer((_req, res) => res.end("ok"));
    const launches = [];
    vi.spyOn(platform, "spawnHidden").mockImplementation((_file, args) => {
      launches.push(args);
      const child = fakeChild();
      if (args.includes("--mmproj")) {
        setImmediate(() => {
          child.stderr.emit("data", Buffer.from("0.00.100.001 E srv    load_model: failed to load multimodal model 'x'\n"));
          child.emit("exit", 1, null);
        });
      } else {
        health.listen(port, "127.0.0.1");
      }
      return child;
    });

    try {
      const result = await start(path.join(dir, "seer.gguf"), port);

      // A projector the engine cannot read costs the images, not the model.
      expect(result.success).toBe(true);
      expect(launches).toHaveLength(2);
      expect(launches[0]).toContain("--mmproj");
      expect(launches[1]).not.toContain("--mmproj");

      // The caller is told, and the projector is no longer counted as one the model has.
      expect(result.projectorRefused).toBe(true);
      expect(mmproj.findCompanion(dir, "seer.gguf")).toBeNull();

      // Every later start says so again: a screen that was not listening the first time still learns.
      const again = await start(path.join(dir, "seer.gguf"), port);
      expect(again.alreadyRunning).toBe(true);
      expect(again.projectorRefused).toBe(true);
    } finally {
      llamaProcess.stopServerSync();
      await new Promise((resolve) => health.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
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

    // The app words this in the reader's language from the kind, not from the English above.
    expect(result.kind).toBe("stopped-loading");
    expect(result.params).toMatchObject({ model: "m.gguf", code: "1" });
    expect(result.params.reason).toContain("no such tensor");
    expect(result.params.log).toContain("no such tensor");
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
    expect(result.kind).toBe("another-model");
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

describe("llamaProcess speed tuning", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    llamaProcess.stopServerSync();
  });

  it("gives CUDA a bigger micro-batch, and MoE the biggest", () => {
    expect(llamaProcess.batchSizes("cuda", 12, false)).toEqual({ batch: 2048, ubatch: 2048 });
    expect(llamaProcess.batchSizes("cuda", 8, false)).toEqual({ batch: 2048, ubatch: 1024 });
    expect(llamaProcess.batchSizes("cuda", 8, true)).toEqual({ batch: 2048, ubatch: 2048 });
    expect(llamaProcess.batchSizes("vulkan", 12, false)).toEqual({ batch: 2048, ubatch: 512 });
    expect(llamaProcess.batchSizes("metal", 36, true)).toEqual({ batch: 2048, ubatch: 512 });
    expect(llamaProcess.batchSizes(undefined, 0, false)).toEqual({ batch: 2048, ubatch: 512 });
  });

  it("leaves a mixture-of-experts model its q8_0 cache and full context, since --fit moves experts first", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "statSync").mockReturnValue({ size: 16 * 1024 ** 3 });
    expect(llamaProcess.determineKvCache("moe.gguf", 32768, 8, { moe: true })).toEqual({ cacheType: "q8_0", effectiveContext: 32768 });
    expect(llamaProcess.determineKvCache("dense.gguf", 32768, 8).cacheType).toBe("q4_0");
  });

  it.skipIf(process.platform === "win32")("turns on n-gram speculation only when the engine lists it", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-flags-"));
    const bin = (name, flags) => {
      const file = path.join(dir, name);
      const help = Array.from({ length: 30 }, (_, i) => `--flag-${i}`).concat(flags).join("\n");
      fs.writeFileSync(file, `#!/bin/sh\ncat <<'EOF'\n${help}\nEOF\n`);
      fs.chmodSync(file, 0o755);
      return file;
    };
    const health = http.createServer((_req, res) => res.end("ok"));
    await new Promise((resolve) => health.listen(0, "127.0.0.1", resolve));
    const port = health.address().port;
    await new Promise((resolve) => health.close(resolve));

    const calls = [];
    vi.spyOn(platform, "spawnHidden").mockImplementation((file, args) => {
      calls.push(args);
      if (!health.listening) health.listen(port, "127.0.0.1");
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.exitCode = null;
      return child;
    });

    try {
      const start = (binaryPath, modelPath) =>
        llamaProcess.startServer({ binaryPath, modelPath, port, log: quiet });
      expect((await start(bin("new-server", ["--spec-default"]), "a.gguf")).success).toBe(true);
      llamaProcess.stopServerSync();
      // The port has to be free again, or the second start adopts the first "server".
      await new Promise((resolve) => health.close(resolve));
      expect((await start(bin("old-server", []), "b.gguf")).success).toBe(true);
    } finally {
      if (health.listening) await new Promise((resolve) => health.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
    expect(calls[0]).toContain("--spec-default");
    expect(calls[1]).not.toContain("--spec-default");
  });
});

describe("llamaProcess context and memory sizing", () => {
  const GB = 1024 ** 3;
  afterEach(() => {
    vi.restoreAllMocks();
    llamaProcess.stopServerSync();
  });
  const withModelSize = (bytes) => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "statSync").mockReturnValue({ size: bytes });
  };

  it("rounds a small window up when the card has room, so a growing chat does not reload", () => {
    withModelSize(4 * GB);
    const traits = { trainedContext: 131072, kvBytesQ8: 72 * 1024 };
    expect(llamaProcess.determineKvCache("m.gguf", 4096, 12, traits)).toEqual({ cacheType: "q8_0", effectiveContext: 32768 });
    // Never past what the model was trained for.
    expect(llamaProcess.determineKvCache("m.gguf", 4096, 12, { ...traits, trainedContext: 8192 }).effectiveContext).toBe(8192);
    // Asking for more than the rounding still gets what was asked.
    expect(llamaProcess.determineKvCache("m.gguf", 65536, 24, traits).effectiveContext).toBe(65536);
  });

  it("does not round up when the cache already had to shrink", () => {
    withModelSize(9.05 * GB);
    expect(llamaProcess.determineKvCache("m.gguf", 16384, 12, { trainedContext: 131072 })).toEqual({
      cacheType: "q4_0",
      effectiveContext: 16384,
    });
  });

  it("prices the cache from the model's own attention shape", () => {
    withModelSize(6 * GB);
    // 12 GB card: 4 GB free, 3.2 GB of it usable for rounding up.
    const heavy = { trainedContext: 131072, kvBytesQ8: 300 * 1024 };
    const light = { trainedContext: 131072, kvBytesQ8: 40 * 1024 };
    expect(llamaProcess.determineKvCache("m.gguf", 4096, 12, heavy).effectiveContext).toBe(8192);
    expect(llamaProcess.determineKvCache("m.gguf", 4096, 12, light).effectiveContext).toBe(32768);
  });

  it("starts a mixture-of-experts model at 16K at least", () => {
    expect(llamaProcess.determineKvCache("moe.gguf", 4096, 8, { moe: true, trainedContext: 262144 }).effectiveContext).toBe(16384);
    expect(llamaProcess.determineKvCache("moe.gguf", 4096, 8, { moe: true, trainedContext: 8192 }).effectiveContext).toBe(8192);
  });

  it("sizes the prompt RAM cache from what the weights leave", () => {
    withModelSize(16 * GB);
    expect(llamaProcess.promptCacheMiB("m.gguf", 64 * GB)).toBe(16384);
    expect(llamaProcess.promptCacheMiB("m.gguf", 32 * GB)).toBe(5120);
    expect(llamaProcess.promptCacheMiB("m.gguf", 16 * GB)).toBe(1024);
  });

  it("keeps the running window for a caller that does not name one", async () => {
    const health = http.createServer((_req, res) => res.end("ok"));
    await new Promise((resolve) => health.listen(0, "127.0.0.1", resolve));
    const port = health.address().port;
    await new Promise((resolve) => health.close(resolve));
    let spawns = 0;
    vi.spyOn(platform, "spawnHidden").mockImplementation(() => {
      spawns++;
      if (!health.listening) health.listen(port, "127.0.0.1");
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.exitCode = null;
      return child;
    });
    try {
      const base = { binaryPath: "llama-server", modelPath: "chat.gguf", port, log: quiet };
      expect((await llamaProcess.startServer({ ...base, contextSize: 32768 })).success).toBe(true);
      // A voice reply names no window: it must not reload the chat model at 8K.
      expect(await llamaProcess.startServer(base)).toMatchObject({ success: true, alreadyRunning: true });
      expect(spawns).toBe(1);
      expect(llamaProcess.getServerStatus().contextSize).toBe(32768);

      // A smaller automatic window is served by the bigger one; a window the user fixed is loaded as asked.
      expect(await llamaProcess.startServer({ ...base, contextSize: 8192 })).toMatchObject({ alreadyRunning: true, contextSize: 32768 });
      expect(spawns).toBe(1);
      // Stand-in for the reload stopping the old engine, whose port the fake health check holds.
      await new Promise((resolve) => health.close(resolve));
      await llamaProcess.startServer({ ...base, contextSize: 8192, exactContext: true });
      expect(spawns).toBe(2);
      expect(llamaProcess.getServerStatus().contextSize).toBe(8192);
    } finally {
      if (health.listening) await new Promise((resolve) => health.close(resolve));
    }
  });

  it("never rounds up a window the user fixed", () => {
    withModelSize(4 * GB);
    const traits = { trainedContext: 131072, kvBytesQ8: 72 * 1024, exact: true };
    expect(llamaProcess.determineKvCache("m.gguf", 4096, 12, traits).effectiveContext).toBe(4096);
    expect(llamaProcess.determineKvCache("moe.gguf", 4096, 12, { ...traits, moe: true }).effectiveContext).toBe(4096);
  });
});
