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

  it("takes a HIP folder ahead of Vulkan", () => {
    fs.mkdirSync(path.join(dir, "rocm"));
    fs.mkdirSync(path.join(dir, "vulkan"));
    const runner = binaryManager.detectGpuRunner(dir, 8);
    expect(runner).toMatchObject({ runnerType: "rocm", runnerDir: path.join(dir, "rocm") });
    expect(runner.backendDll).toBe(path.join(dir, "rocm", "ggml-hip.dll"));
  });

  it("takes a flat HIP build", () => {
    fs.writeFileSync(path.join(dir, "ggml-hip.dll"), "");
    expect(binaryManager.detectGpuRunner(dir, 8).runnerType).toBe("rocm");
  });

  it("keeps Vulkan when no HIP build is there", () => {
    fs.mkdirSync(path.join(dir, "vulkan"));
    expect(binaryManager.detectGpuRunner(dir, 8).runnerType).toBe("vulkan");
  });

  it("takes the ROCm archive for a non-NVIDIA card", () => {
    const assets = [
      { name: "llama-b1-bin-win-vulkan-x64.zip" },
      { name: "llama-b1-bin-win-rocm-10.0-x64.zip" },
    ];
    const picked = binaryManager.pickReleaseAssets(assets, { vramGB: 16, nvidia: false });
    expect(picked.main.name).toBe("llama-b1-bin-win-rocm-10.0-x64.zip");
    expect(picked.variant).toBe("rocm-10.0");
  });
});
