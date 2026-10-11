import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const sd = require("./sdBinaryManager.cjs");
const urlPolicy = require("./urlPolicy.cjs");

describe("the pinned image engine release", () => {
  it("has a hash and a size for every archive any runner can ask for", () => {
    const needed = Object.values(sd.RUNNER_ASSETS).flatMap((runners) =>
      Object.values(runners).flatMap((entry) => [entry.main, entry.extra].filter(Boolean)),
    );
    expect(needed.length).toBeGreaterThan(0);
    for (const name of needed) {
      expect(sd.SD_CPP_ASSETS[name], name).toBeDefined();
      expect(sd.SD_CPP_ASSETS[name].sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(sd.SD_CPP_ASSETS[name].size).toBeGreaterThan(0);
    }
  });

  it("names every archive after the pinned commit, so a table from another release cannot slip in", () => {
    const commit = sd.SD_CPP_RELEASE.split("-").pop();
    for (const name of Object.keys(sd.SD_CPP_ASSETS)) {
      if (name.startsWith("cudart-")) continue;
      expect(name).toContain(commit);
    }
  });

  it("downloads from the pinned tag on GitHub, which the outbound policy allows", () => {
    const url = sd.downloadUrl("sd-master-2bb7294-bin-win-vulkan-x64.zip");
    expect(url).toBe(`https://github.com/leejet/stable-diffusion.cpp/releases/download/${sd.SD_CPP_RELEASE}/sd-master-2bb7294-bin-win-vulkan-x64.zip`);
    expect(urlPolicy.isFetchableUrl(url, { allowPrivate: false })).toBe(true);
  });
});

describe("choosing the archive for this machine", () => {
  it("takes CUDA on an NVIDIA card and Vulkan on any other GPU", () => {
    expect(sd.pickSdAssets({ system: "win32", arch: "x64", vramGB: 12, nvidia: true })).toEqual({
      runner: "cuda",
      main: "sd-master-2bb7294-bin-win-cuda12-x64.zip",
      extra: "cudart-sd-bin-win-cu12-x64.zip",
    });
    expect(sd.pickSdAssets({ system: "win32", arch: "x64", vramGB: 8, nvidia: false }).runner).toBe("vulkan");
    expect(sd.pickSdAssets({ system: "linux", arch: "x64", vramGB: 8, nvidia: true }).runner).toBe("vulkan");
  });

  it("brings the CUDA runtime along when CUDA is chosen", () => {
    expect(sd.pickSdAssets({ system: "win32", arch: "x64", vramGB: 12, nvidia: true, runner: "cuda" })).toEqual({
      runner: "cuda",
      main: "sd-master-2bb7294-bin-win-cuda12-x64.zip",
      extra: "cudart-sd-bin-win-cu12-x64.zip",
    });
  });

  it("refuses CUDA without an NVIDIA driver", () => {
    expect(sd.pickSdAssets({ system: "win32", arch: "x64", vramGB: 8, nvidia: false, runner: "cuda" })).toBeNull();
  });

  it("falls back to the CPU build without a GPU", () => {
    expect(sd.pickSdAssets({ system: "win32", arch: "x64", vramGB: 0 }).runner).toBe("cpu");
    expect(sd.pickSdAssets({ system: "linux", arch: "x64", vramGB: 0 }).main).toBe("sd-master-2bb7294-bin-Linux-Ubuntu-24.04-x86_64.zip");
  });

  it("uses Metal on Apple Silicon and Vulkan on a Linux GPU", () => {
    expect(sd.pickSdAssets({ system: "darwin", arch: "arm64" }).runner).toBe("metal");
    expect(sd.pickSdAssets({ system: "linux", arch: "x64", vramGB: 8 }).runner).toBe("vulkan");
  });

  it("offers ROCm where it is published", () => {
    expect(sd.runnersFor({ system: "linux", arch: "x64" })).toContain("rocm");
    expect(sd.runnersFor({ system: "win32", arch: "x64" })).toContain("rocm");
  });

  it("has nothing for a system with no published build", () => {
    expect(sd.pickSdAssets({ system: "win32", arch: "arm64", vramGB: 0 })).toBeNull();
    expect(sd.pickSdAssets({ system: "darwin", arch: "x64" })).toBeNull();
    expect(sd.runnersFor({ system: "linux", arch: "arm64" })).toEqual([]);
  });
});

describe("unpacking", () => {
  it("refuses archive entries that climb out of their folder or are absolute", () => {
    expect(sd.unsafeEntries(["sd-server.exe", "lib/ggml.dll", "../evil.dll", "a/../../b", "/etc/passwd", "C:\\Windows\\x.dll", "..\\x"])).toEqual([
      "../evil.dll",
      "a/../../b",
      "/etc/passwd",
      "C:\\Windows\\x.dll",
      "..\\x",
    ]);
  });

  it("allows names that only contain two dots", () => {
    expect(sd.unsafeEntries(["libfoo..so", "a..b/c"])).toEqual([]);
  });

  it("finds the server one folder down", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-sdbin-"));
    fs.mkdirSync(path.join(dir, "build", "bin"), { recursive: true });
    fs.writeFileSync(path.join(dir, "build", "bin", sd.serverName()), "");
    expect(sd.findServerIn(dir)).toBe(path.join(dir, "build", "bin", sd.serverName()));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("verifying a download", () => {
  const name = "sd-master-2bb7294-bin-win-cpu-x64.zip";

  it("refuses bytes whose hash is not the pinned one, and removes them", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-sddl-"));
    const target = path.join(dir, name);
    const counted = { bytes: 0, add(n) { this.bytes += n; } };

    await expect(
      sd.downloadAsset(name, target, counted, async () => Readable.from([Buffer.from("tampered")])),
    ).rejects.toThrow(/Checksum mismatch/);
    expect(fs.existsSync(target)).toBe(false);
    expect(counted.bytes).toBe(8);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("refuses to download anything outside the pinned table", async () => {
    await expect(sd.downloadAsset("sd-master-evil.zip", "x", { add() {} })).rejects.toThrow(/not part of the pinned/);
  });
});

describe("the smoke test's verdict", () => {
  it("passes a server that printed its version", () => {
    expect(sd.classifySmoke({ code: 0, stdout: "stable-diffusion.cpp version master-898" })).toEqual({ ok: true });
  });

  it("fails a silent exit rather than calling it ready", () => {
    expect(sd.classifySmoke({ code: 0, stdout: "" })).toEqual({ ok: false, kind: "failed" });
  });

  it("names a missing DLL, signed or unsigned", () => {
    expect(sd.classifySmoke({ error: new Error("x"), code: 0xc0000135 }).kind).toBe("missing-library");
    expect(sd.classifySmoke({ error: new Error("x"), code: -1073741515 }).kind).toBe("missing-library");
  });

  it("names an instruction set the CPU lacks", () => {
    expect(sd.classifySmoke({ error: new Error("x"), code: 0xc000001d }).kind).toBe("unsupported-cpu");
    expect(sd.classifySmoke({ error: new Error("x"), code: null, signal: "SIGILL" }).kind).toBe("unsupported-cpu");
  });

  it("names a hang", () => {
    expect(sd.classifySmoke({ error: Object.assign(new Error("x"), { killed: true }), code: null, signal: "SIGTERM" }).kind).toBe("timeout");
  });

  it("runs a real process hidden and reads what it printed", async () => {
    // Node prints its version for --version, which is exactly what the check asks of sd-server.
    expect(await sd.smokeTest(process.execPath)).toEqual({ ok: true });
  });
});
