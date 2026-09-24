import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import https from "node:https";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const binaryManager = require("./binaryManager.cjs");
const platform = require("./platform.cjs");

describe("binaryManager", () => {
  it("selects cuda binary on Windows when VRAM is available", () => {
    const originalWindows = platform.IS_WINDOWS;
    try {
      platform.IS_WINDOWS = true;
      expect(binaryManager.recommendedReleaseAsset(8)).toBe("llama-server-cuda-x64");
      expect(binaryManager.recommendedReleaseAsset(0)).toBe("llama-server-vulkan-x64");
    } finally {
      platform.IS_WINDOWS = originalWindows;
    }
  });

  it("selects metal binary on macOS", () => {
    const originalWindows = platform.IS_WINDOWS;
    const originalMac = platform.IS_MAC;
    try {
      platform.IS_WINDOWS = false;
      platform.IS_MAC = true;
      expect(binaryManager.recommendedReleaseAsset(16)).toBe("llama-server-metal-arm64");
    } finally {
      platform.IS_WINDOWS = originalWindows;
      platform.IS_MAC = originalMac;
    }
  });

  it("validates download URLs through URL policy", () => {
    expect(binaryManager.validateDownloadUrl("https://github.com/ggerganov/llama.cpp/releases")).toBe(true);
    expect(binaryManager.validateDownloadUrl("http://localhost:8080/llama-server")).toBe(false);
    expect(binaryManager.validateDownloadUrl("file:///C:/bin/llama-server.exe")).toBe(false);
  });

  it("finds binary in custom userData directory if present", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-bin-test-"));
    const binName = platform.IS_WINDOWS ? "llama-server.exe" : "llama-server";
    const targetDir = path.join(tmpDir, "bin", "llama");
    fs.mkdirSync(targetDir, { recursive: true });
    const targetFile = path.join(targetDir, binName);
    fs.writeFileSync(targetFile, "dummy-binary");

    try {
      const found = binaryManager.findLlamaBinary(tmpDir);
      expect(found).toBe(targetFile);
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    }
  });

  it("returns null when binary cannot be found", () => {
    const emptyDir = path.join(os.tmpdir(), `draggy-empty-${Date.now()}`);
    const origLocal = process.env.LOCALAPPDATA;
    const origPf = process.env.ProgramFiles;
    const origPf86 = process.env["ProgramFiles(x86)"];
    const origPath = process.env.PATH;
    try {
      process.env.LOCALAPPDATA = emptyDir;
      process.env.ProgramFiles = emptyDir;
      process.env["ProgramFiles(x86)"] = emptyDir;
      process.env.PATH = "";
      expect(binaryManager.findLlamaBinary(emptyDir)).toBeNull();
    } finally {
      process.env.LOCALAPPDATA = origLocal;
      process.env.ProgramFiles = origPf;
      process.env["ProgramFiles(x86)"] = origPf86;
      process.env.PATH = origPath;
    }
  });

  describe("engine folder", () => {
    const made = [];
    const tmp = () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-engine-"));
      made.push(dir);
      return dir;
    };
    const touch = (...parts) => {
      const file = path.join(...parts);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "x");
      return file;
    };
    const withPlatform = (flags, run) => {
      const saved = { w: platform.IS_WINDOWS, m: platform.IS_MAC, l: platform.IS_LINUX };
      Object.assign(platform, { IS_WINDOWS: !!flags.win, IS_MAC: !!flags.mac, IS_LINUX: !!flags.linux });
      const restore = () => Object.assign(platform, { IS_WINDOWS: saved.w, IS_MAC: saved.m, IS_LINUX: saved.l });
      let result;
      try {
        result = run();
      } catch (err) {
        restore();
        throw err;
      }
      if (result && typeof result.then === "function") return result.finally(restore);
      restore();
      return result;
    };
    const realSystemRoot = process.env.SystemRoot;
    // Fake System32 so CUDA detection does not depend on this machine's GPU.
    const fakeSystemRoot = (withDriver) => {
      const root = tmp();
      if (withDriver) touch(root, "System32", "nvcuda.dll");
      process.env.SystemRoot = root;
    };
    beforeEach(() => fakeSystemRoot(true));
    afterEach(() => {
      process.env.SystemRoot = realSystemRoot;
      for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
    });

    it("prefers CUDA over Vulkan on Windows when VRAM is present", () => {
      withPlatform({ win: true }, () => {
        const dir = tmp();
        fs.mkdirSync(path.join(dir, "cuda_v12"));
        fs.mkdirSync(path.join(dir, "vulkan"));
        const runner = binaryManager.detectGpuRunner(dir, 8);
        expect(runner.runnerType).toBe("cuda");
        expect(runner.runnerDir).toBe(path.join(dir, "cuda_v12"));
        expect(runner.backendDll).toBe(path.join(dir, "cuda_v12", "ggml-cuda.dll"));
      });
    });

    it("falls back to cuda_v13, then to Vulkan without VRAM", () => {
      withPlatform({ win: true }, () => {
        const dir = tmp();
        fs.mkdirSync(path.join(dir, "cuda_v13"));
        expect(binaryManager.detectGpuRunner(dir, 8).runnerDir).toBe(path.join(dir, "cuda_v13"));

        fs.mkdirSync(path.join(dir, "vulkan"));
        const noVram = binaryManager.detectGpuRunner(dir, 0);
        expect(noVram.runnerType).toBe("vulkan");
        expect(noVram.backendDll).toBe(path.join(dir, "vulkan", "ggml-vulkan.dll"));
      });
    });

    it("skips CUDA without an NVIDIA driver and uses Vulkan", () => {
      withPlatform({ win: true }, () => {
        fakeSystemRoot(false);
        const dir = tmp();
        fs.mkdirSync(path.join(dir, "cuda_v12"));
        fs.mkdirSync(path.join(dir, "vulkan"));
        expect(binaryManager.detectGpuRunner(dir, 8)).toMatchObject({ runnerType: "vulkan", runnerDir: path.join(dir, "vulkan") });
      });
    });

    it("falls back to CPU when only CUDA is present and no NVIDIA driver", () => {
      withPlatform({ win: true }, () => {
        fakeSystemRoot(false);
        const nested = tmp();
        fs.mkdirSync(path.join(nested, "cuda_v12"));
        expect(binaryManager.detectGpuRunner(nested, 8).runnerType).toBe("cpu");
        const flat = tmp();
        touch(flat, "ggml-cuda.dll");
        expect(binaryManager.detectGpuRunner(flat, 8).runnerType).toBe("cpu");
      });
    });

    it("recognises the flat layout of a llama.cpp release", () => {
      withPlatform({ win: true }, () => {
        const dir = tmp();
        touch(dir, "ggml-vulkan.dll");
        expect(binaryManager.detectGpuRunner(dir, 4)).toMatchObject({ runnerType: "vulkan", runnerDir: dir });
        expect(binaryManager.detectGpuRunner(tmp(), 4).runnerType).toBe("cpu");
      });
    });

    it("prefers a flat CUDA build over a leftover vulkan folder on NVIDIA", () => {
      withPlatform({ win: true }, () => {
        const dir = tmp();
        touch(dir, "ggml-cuda.dll");
        fs.mkdirSync(path.join(dir, "vulkan"));
        expect(binaryManager.detectGpuRunner(dir, 12)).toMatchObject({ runnerType: "cuda", runnerDir: dir });
      });
    });

    it("uses CUDA on Linux when the NVIDIA driver is there", () => {
      const realExists = fs.existsSync;
      const driver = (on) =>
        (fs.existsSync = (file) => (String(file).endsWith("libcuda.so.1") ? on : realExists(file)));
      try {
        withPlatform({ linux: true }, () => {
          const dir = tmp();
          touch(dir, "libggml-cuda.so");
          touch(dir, "libggml-vulkan.so");
          driver(true);
          expect(binaryManager.detectGpuRunner(dir, 12).runnerType).toBe("cuda");
          driver(false);
          expect(binaryManager.detectGpuRunner(dir, 12).runnerType).toBe("vulkan");
        });
      } finally {
        fs.existsSync = realExists;
      }
    });

    it("uses Metal on macOS and Vulkan or ROCm on Linux", () => {
      withPlatform({ mac: true }, () => {
        expect(binaryManager.detectGpuRunner(tmp(), 0)).toMatchObject({ runnerType: "metal", backendDll: null });
      });
      withPlatform({ linux: true }, () => {
        const vulkan = tmp();
        fs.mkdirSync(path.join(vulkan, "vulkan"));
        expect(binaryManager.detectGpuRunner(vulkan, 8).runnerType).toBe("vulkan");
        const rocm = tmp();
        fs.mkdirSync(path.join(rocm, "rocm"));
        expect(binaryManager.detectGpuRunner(rocm, 8).runnerType).toBe("rocm");
      });
    });

    it("builds the engine environment with the runner first on PATH", () => {
      withPlatform({ win: true }, () => {
        const userData = tmp();
        const llama = path.join(userData, "bin", "llama");
        const cuda = path.join(llama, "cuda_v12");
        fs.mkdirSync(cuda, { recursive: true });
        const exe = touch(llama, "llama-server.exe");

        const engine = binaryManager.getEngineEnvironment(userData, 12);
        expect(engine.binaryPath).toBe(exe);
        expect(engine.runnerType).toBe("cuda");
        expect(engine.env.GGML_BACKEND_PATH).toBe(path.join(cuda, "ggml-cuda.dll"));
        expect(engine.env.PATH.split(path.delimiter).slice(0, 2)).toEqual([cuda, llama]);
      });
    });

    it("finds the runner beside an external binary when the app folder is empty", () => {
      const saved = { local: process.env.LOCALAPPDATA, path: process.env.PATH };
      try {
        withPlatform({ win: true }, () => {
          const local = tmp();
          const ollama = path.join(local, "Programs", "Ollama", "lib", "ollama");
          const exe = touch(ollama, "llama-server.exe");
          const cuda = path.join(ollama, "cuda_v12");
          touch(cuda, "ggml-cuda.dll");
          process.env.LOCALAPPDATA = local;
          process.env.PATH = "";

          const engine = binaryManager.getEngineEnvironment(tmp(), 8);
          expect(engine.binaryPath).toBe(exe);
          expect(engine.runnerType).toBe("cuda");
          expect(engine.runnerDir).toBe(cuda);
          expect(engine.env.GGML_BACKEND_PATH).toBe(path.join(cuda, "ggml-cuda.dll"));
          expect(engine.env.PATH.split(path.delimiter).slice(0, 2)).toEqual([cuda, ollama]);
        });
      } finally {
        process.env.LOCALAPPDATA = saved.local;
        process.env.PATH = saved.path;
      }
    });

    it("prefers an explicit binary over the one discovered", () => {
      withPlatform({ win: true }, () => {
        const userData = tmp();
        touch(userData, "bin", "llama", "llama-server.exe");
        const external = tmp();
        const exe = touch(external, "llama-server.exe");
        const cuda = path.join(external, "cuda_v12");
        fs.mkdirSync(cuda);

        const engine = binaryManager.getEngineEnvironment(userData, 8, exe);
        expect(engine.binaryPath).toBe(exe);
        expect(engine.runnerDir).toBe(cuda);
        expect(engine.env.GGML_BACKEND_PATH).toBe(path.join(cuda, "ggml-cuda.dll"));
      });
    });

    it("also sets LD_LIBRARY_PATH to the runner folder off Windows", () => {
      withPlatform({ linux: true }, () => {
        const dir = tmp();
        const exe = touch(dir, "llama-server");
        const vulkan = path.join(dir, "vulkan");
        fs.mkdirSync(vulkan);

        const engine = binaryManager.getEngineEnvironment(tmp(), 8, exe);
        expect(engine.env.LD_LIBRARY_PATH.split(path.delimiter).slice(0, 2)).toEqual([vulkan, dir]);
        expect(engine.env.GGML_BACKEND_PATH).toBe(path.join(vulkan, "libggml-vulkan.so"));
      });
    });

    it("reports ready without touching anything when the engine is already inside", async () => {
      await withPlatform({ win: true }, async () => {
        const userData = tmp();
        const llama = path.join(userData, "bin", "llama");
        touch(llama, "llama-server.exe");
        fs.mkdirSync(path.join(llama, "vulkan"));

        const result = await binaryManager.ensureEngineReady(userData, 4, () => {});
        expect(result).toEqual({
          ready: true,
          binaryPath: path.join(llama, "llama-server.exe"),
          runnerType: "vulkan",
        });
      });
    });

    it("adopts a local Ollama install into the app folder", async () => {
      const saved = { local: process.env.LOCALAPPDATA, path: process.env.PATH };
      try {
        await withPlatform({ win: true }, async () => {
          const local = tmp();
          const ollama = path.join(local, "Programs", "Ollama", "lib", "ollama");
          touch(ollama, "llama-server.exe");
          touch(ollama, "ggml-base.dll");
          touch(ollama, "libc++.dll");
          touch(ollama, "libomp.dll");
          touch(ollama, "libunwind.dll");
          touch(ollama, "libwinpthread-1.dll");
          touch(ollama, "cuda_v12", "ggml-cuda.dll");
          touch(ollama, "vulkan", "ggml-vulkan.dll");
          touch(ollama, "unrelated.txt");
          process.env.LOCALAPPDATA = local;
          process.env.PATH = "";

          const userData = tmp();
          const llama = path.join(userData, "bin", "llama");
          const result = await binaryManager.ensureEngineReady(userData, 8, () => {});

          expect(result).toMatchObject({ ready: true, runnerType: "cuda", binaryPath: path.join(llama, "llama-server.exe") });
          expect(fs.existsSync(path.join(llama, "ggml-base.dll"))).toBe(true);
          for (const runtime of ["libc++.dll", "libomp.dll", "libunwind.dll", "libwinpthread-1.dll"]) {
            expect(fs.existsSync(path.join(llama, runtime))).toBe(true);
          }
          expect(fs.existsSync(path.join(llama, "cuda_v12", "ggml-cuda.dll"))).toBe(true);
          expect(fs.existsSync(path.join(llama, "vulkan", "ggml-vulkan.dll"))).toBe(true);
          expect(fs.existsSync(path.join(llama, "unrelated.txt"))).toBe(false);
          expect(fs.existsSync(`${llama}.staging`)).toBe(false);
        });
      } finally {
        process.env.LOCALAPPDATA = saved.local;
        process.env.PATH = saved.path;
      }
    });

    it("adopts the Ollama files but runs Vulkan when there is no NVIDIA driver", async () => {
      const saved = { local: process.env.LOCALAPPDATA, path: process.env.PATH };
      try {
        await withPlatform({ win: true }, async () => {
          fakeSystemRoot(false);
          const local = tmp();
          const ollama = path.join(local, "Programs", "Ollama", "lib", "ollama");
          touch(ollama, "llama-server.exe");
          touch(ollama, "ggml-base.dll");
          touch(ollama, "cuda_v12", "ggml-cuda.dll");
          touch(ollama, "vulkan", "ggml-vulkan.dll");
          process.env.LOCALAPPDATA = local;
          process.env.PATH = "";

          const result = await binaryManager.ensureEngineReady(tmp(), 8, () => {});
          expect(result).toMatchObject({ ready: true, runnerType: "vulkan" });
        });
      } finally {
        process.env.LOCALAPPDATA = saved.local;
        process.env.PATH = saved.path;
      }
    });

    it("does not adopt a binary that lacks its own libraries", async () => {
      const saved = { local: process.env.LOCALAPPDATA, path: process.env.PATH, pf: process.env.ProgramFiles };
      const originalGet = https.get;
      try {
        await withPlatform({ win: true }, async () => {
          const lonely = tmp();
          touch(lonely, "llama-server.exe");
          process.env.LOCALAPPDATA = tmp();
          process.env.ProgramFiles = tmp();
          process.env.PATH = lonely;
          const userData = tmp();

          // Nothing qualifies, so it goes to the network; fail that so the test stays offline.
          https.get = () => {
            const req = new EventEmitter();
            queueMicrotask(() => req.emit("error", new Error("offline")));
            return req;
          };
          const result = await binaryManager.ensureEngineReady(userData, 0, () => {});
          expect(result.ready).toBe(false);
          expect(fs.existsSync(path.join(userData, "bin", "llama", "llama-server.exe"))).toBe(false);
        });
      } finally {
        https.get = originalGet;
        process.env.LOCALAPPDATA = saved.local;
        process.env.PATH = saved.path;
        process.env.ProgramFiles = saved.pf;
      }
    });

    describe("pickReleaseAssets", () => {
      const names = [
        "llama-b1-bin-win-cpu-x64.zip",
        "llama-b1-bin-win-vulkan-x64.zip",
        "llama-b1-bin-win-cuda-12.4-x64.zip",
        "llama-b1-bin-win-cuda-13.4-x64.zip",
        "cudart-llama-bin-win-cuda-12.4-x64.zip",
        "llama-b1-bin-macos-arm64.tar.gz",
        "llama-b1-bin-ubuntu-x64.tar.gz",
        "llama-b1-bin-ubuntu-vulkan-x64.tar.gz",
        "llama-b1-bin-ubuntu-cuda-12.8-x64.tar.gz",
        "llama-b1-bin-ubuntu-cuda-13.4-x64.tar.gz",
        "cudart-llama-b1-bin-ubuntu-cuda-12.8-x64.tar.gz",
        "cudart-llama-b1-bin-ubuntu-cuda-13.4-x64.tar.gz",
        "cudart-llama-bin-win-cuda-13.4-x64.zip",
      ].map((name) => ({ name }));
      const pick = (flags, options) => withPlatform(flags, () => binaryManager.pickReleaseAssets(names, options));

      it("takes CUDA plus its runtime only when an NVIDIA driver is there", () => {
        const cuda = pick({ win: true }, { vramGB: 8, nvidia: true });
        expect(cuda.main.name).toBe("llama-b1-bin-win-cuda-12.4-x64.zip");
        expect(cuda.extra.name).toBe("cudart-llama-bin-win-cuda-12.4-x64.zip");
        expect(pick({ win: true }, { vramGB: 8, nvidia: false }).main.name).toContain("vulkan");
        expect(pick({ win: true }, { vramGB: 0 }).main.name).toContain("win-cpu");
      });

      it("gives Blackwell cards CUDA 13, and falls back to 12 without its runtime", () => {
        const win = pick({ win: true }, { vramGB: 16, nvidia: true, cuda13: true });
        expect(win.main.name).toBe("llama-b1-bin-win-cuda-13.4-x64.zip");
        expect(win.extra.name).toBe("cudart-llama-bin-win-cuda-13.4-x64.zip");
        expect(win.variant).toBe("cuda-13.4");
        const linux = pick({ linux: true }, { vramGB: 16, arch: "x64", nvidia: true, cuda13: true });
        expect(linux.extra.name).toBe("cudart-llama-b1-bin-ubuntu-cuda-13.4-x64.tar.gz");
        const noRuntime = names.filter((asset) => asset.name !== "cudart-llama-bin-win-cuda-13.4-x64.zip");
        const fallback = withPlatform({ win: true }, () =>
          binaryManager.pickReleaseAssets(noRuntime, { vramGB: 16, nvidia: true, cuda13: true }),
        );
        expect(fallback.variant).toBe("cuda-12.4");
      });

      it("names the variant and build of an archive", () => {
        expect(binaryManager.variantOf("llama-b9-bin-win-vulkan-x64.zip")).toBe("vulkan");
        expect(binaryManager.variantOf("llama-b9-bin-ubuntu-x64.tar.gz")).toBe("cpu");
        expect(binaryManager.variantOf("llama-b9-bin-macos-arm64.tar.gz")).toBe("metal");
        expect(binaryManager.variantOf("llama-b9-bin-ubuntu-cuda-12.8-x64.tar.gz")).toBe("cuda-12.8");
        expect(binaryManager.buildNumber("b11146")).toBe(11146);
        expect(binaryManager.buildNumber("v0.5.0")).toBe(0);
      });

      it("matches macOS and Linux archives", () => {
        expect(pick({ mac: true }, { arch: "arm64" }).main.name).toContain("macos-arm64");
        expect(pick({ linux: true }, { vramGB: 8, arch: "x64" }).main.name).toContain("ubuntu-vulkan-x64");
        const cuda = pick({ linux: true }, { vramGB: 8, arch: "x64", nvidia: true });
        expect(cuda.main.name).toBe("llama-b1-bin-ubuntu-cuda-12.8-x64.tar.gz");
        expect(cuda.extra.name).toBe("cudart-llama-b1-bin-ubuntu-cuda-12.8-x64.tar.gz");
        expect(pick({ linux: true }, { vramGB: 0, arch: "x64" }).main.name).toBe("llama-b1-bin-ubuntu-x64.tar.gz");
      });
    });
  });
});
