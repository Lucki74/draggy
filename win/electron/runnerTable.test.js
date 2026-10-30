import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const binaryManager = require("./binaryManager.cjs");

const TABLE = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../shared/fixtures/runner-table.json"), "utf8"));

describe("runner table", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-runner-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("matches the shared fixture's windows column", () => {
    const fromFixture = TABLE.rows.map((row) => ({
      runnerType: row.runnerType,
      needsNvidia: row.needsNvidia,
      rocm: row.rocm,
      folders: row.windows.folders,
      marker: row.windows.marker,
    }));
    expect(binaryManager.RUNNER_TABLE).toEqual(fromFixture);
  });

  it("ignores a HIP folder while gpu.rocm is off", () => {
    fs.mkdirSync(path.join(dir, "rocm"));
    expect(binaryManager.detectGpuRunner(dir, 8).runnerType).toBe("cpu");
    expect(binaryManager.detectGpuRunner(dir, 8, { rocm: false }).runnerType).toBe("cpu");
  });

  it("takes a HIP folder ahead of Vulkan when gpu.rocm is on", () => {
    fs.mkdirSync(path.join(dir, "rocm"));
    fs.mkdirSync(path.join(dir, "vulkan"));
    const runner = binaryManager.detectGpuRunner(dir, 8, { rocm: true });
    expect(runner).toMatchObject({ runnerType: "rocm", runnerDir: path.join(dir, "rocm") });
    expect(runner.backendDll).toBe(path.join(dir, "rocm", "ggml-hip.dll"));
  });

  it("takes a flat HIP build when gpu.rocm is on and Vulkan otherwise", () => {
    fs.writeFileSync(path.join(dir, "ggml-hip.dll"), "");
    expect(binaryManager.detectGpuRunner(dir, 8, { rocm: true }).runnerType).toBe("rocm");
    expect(binaryManager.detectGpuRunner(dir, 8).runnerType).toBe("cpu");
  });

  it("keeps Vulkan when gpu.rocm is on but no HIP build is there", () => {
    fs.mkdirSync(path.join(dir, "vulkan"));
    expect(binaryManager.detectGpuRunner(dir, 8, { rocm: true }).runnerType).toBe("vulkan");
  });

  it("takes the ROCm archive for a non-NVIDIA card only when gpu.rocm is on", () => {
    const assets = [
      { name: "llama-b1-bin-win-vulkan-x64.zip" },
      { name: "llama-b1-bin-win-rocm-10.0-x64.zip" },
    ];
    const gpu = { vramGB: 16, nvidia: false };
    expect(binaryManager.pickReleaseAssets(assets, gpu).main.name).toBe("llama-b1-bin-win-vulkan-x64.zip");
    const picked = binaryManager.pickReleaseAssets(assets, { ...gpu, rocm: true });
    expect(picked.main.name).toBe("llama-b1-bin-win-rocm-10.0-x64.zip");
    expect(picked.variant).toBe("rocm-10.0");
  });

  it("setRunnerOptions changes the default and resets", () => {
    fs.mkdirSync(path.join(dir, "rocm"));
    binaryManager.setRunnerOptions({ rocm: true });
    try {
      expect(binaryManager.detectGpuRunner(dir, 8).runnerType).toBe("rocm");
    } finally {
      binaryManager.setRunnerOptions({});
    }
    expect(binaryManager.detectGpuRunner(dir, 8).runnerType).toBe("cpu");
  });
});
