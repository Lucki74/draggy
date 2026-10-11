import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const binaryManager = require("./binaryManager.cjs");
const platform = require("./platform.cjs");
const engineUpdater = require("./engineUpdater.cjs");

const quiet = { info() {}, debug() {}, warn() {}, error() {} };
const DAY = 24 * 3600 * 1000;

const made = [];
function userData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-engine-upd-"));
  made.push(dir);
  return dir;
}
function engineAt(dir, meta = {}, files = []) {
  fs.mkdirSync(dir, { recursive: true });
  // Named when written, so it matches whichever platform the test is standing in for.
  fs.writeFileSync(path.join(dir, binaryManager.serverName()), "x");
  for (const file of files) fs.writeFileSync(path.join(dir, file), "x");
  binaryManager.writeEngineMeta(dir, meta);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("engineUpdater families", () => {
  it("compares builds by what they run on", () => {
    expect(engineUpdater.variantFamily("cuda-12.4")).toBe("cuda-12");
    expect(engineUpdater.variantFamily("rocm-10.0")).toBe("rocm");
    expect(engineUpdater.sameFamily("cuda-12", "cuda-12.8")).toBe(true);
    expect(engineUpdater.sameFamily("cuda-12", "cuda-13.4")).toBe(false);
    expect(engineUpdater.sameFamily("vulkan", "cuda-12.4")).toBe(false);
    // An engine from before engine.json whose CUDA version could not be read.
    expect(engineUpdater.sameFamily("cuda", "cuda-13.4")).toBe(true);
  });

  it("reads the build from both --version formats", () => {
    expect(engineUpdater.parseBuild("version: 0.25.1 (build 11146, commit a1b2c3)\nbuilt with gcc")).toBe(11146);
    expect(engineUpdater.parseBuild("version: 6789 (a1b2c3)\nbuilt with MSVC")).toBe(6789);
    expect(engineUpdater.parseBuild("usage: llama-server")).toBe(0);
  });

  it("reads the CUDA major from the runtime libraries", () => {
    const dir = userData();
    fs.writeFileSync(path.join(dir, "cudart64_13.dll"), "x");
    expect(engineUpdater.cudaMajorIn(dir)).toBe(13);
    expect(engineUpdater.cudaMajorIn(userData())).toBe(0);
  });
});

describe("engineUpdater swap, confirm and rollback", () => {
  it("swaps a staged engine in, keeps the old one until a model loads, then drops it", () => {
    const root = userData();
    const llama = engineAt(binaryManager.engineDir(root), { tag: "b100" });
    engineAt(`${llama}.pending`, { tag: "b200", previousTag: "b100" });

    expect(engineUpdater.applyPendingEngine(root, { log: quiet })).toEqual({ applied: true, tag: "b200" });
    expect(binaryManager.readEngineMeta(llama).tag).toBe("b200");
    expect(engineUpdater.isUnconfirmed(root)).toBe(true);
    expect(fs.existsSync(`${llama}.pending`)).toBe(false);

    expect(engineUpdater.confirmEngine(root)).toBe(true);
    expect(engineUpdater.isUnconfirmed(root)).toBe(false);
    expect(fs.existsSync(`${llama}.previous`)).toBe(false);
  });

  it("brings the old engine back after a crashed first load and blacklists the build", () => {
    const root = userData();
    const llama = engineAt(binaryManager.engineDir(root), { tag: "b100" });
    engineAt(`${llama}.pending`, { tag: "b200" });
    engineUpdater.applyPendingEngine(root, { log: quiet });

    expect(engineUpdater.rollbackEngine(root, { log: quiet })).toEqual({ rolledBack: true, tag: "b200" });
    const meta = binaryManager.readEngineMeta(llama);
    expect(meta.tag).toBe("b100");
    expect(meta.failedTags).toEqual(["b200"]);
    expect(engineUpdater.isUnconfirmed(root)).toBe(false);
    expect(engineUpdater.rollbackEngine(root, { log: quiet }).rolledBack).toBe(false);
  });

  it("does nothing without a complete staged engine", () => {
    const root = userData();
    engineAt(binaryManager.engineDir(root), { tag: "b100" });
    expect(engineUpdater.applyPendingEngine(root, { log: quiet }).applied).toBe(false);
  });
});

describe("engineUpdater.checkForUpdate", () => {
  const now = Date.parse("2026-09-24T12:00:00Z");
  const release = (build, ageDays, variant = "vulkan") => ({
    tag_name: `b${build}`,
    published_at: new Date(now - ageDays * DAY).toISOString(),
    assets: [{ name: `llama-b${build}-bin-ubuntu-${variant}-x64.tar.gz` }],
  });

  function setup({ releases, installed = { tag: "b100", variant: "vulkan" }, starts = true }) {
    const root = userData();
    const llama = engineAt(binaryManager.engineDir(root), installed, ["libggml-vulkan.so"]);
    vi.spyOn(binaryManager, "gpuProfile").mockResolvedValue({ vramGB: 8, nvidia: false, cuda13: false });
    vi.spyOn(binaryManager, "fetchJson").mockResolvedValue(releases);
    const download = vi.spyOn(binaryManager, "downloadEngine").mockImplementation(async (stage, _vram, _progress, { release: rel }) => {
      const outDir = engineAt(path.join(stage, "engine"), {}, ["libggml-vulkan.so"]);
      return { outDir, tag: rel.tag_name, variant: "vulkan" };
    });
    vi.spyOn(platform, "execFileHidden").mockImplementation((_file, _args, _options, callback) => {
      callback(starts ? null : new Error("crash"), "", starts ? "version: 0.25.1 (build 200, commit abc)" : "");
    });
    return { root, llama, download };
  }

  const check = (root, options = {}) => engineUpdater.checkForUpdate(root, 8, { now, log: quiet, ...options });

  // The releases are Linux builds, so the whole test runs as Linux, installed engine included:
  // on the Windows runner it would otherwise be written as llama-server.exe and never found.
  let saved;
  beforeEach(() => {
    saved = { IS_WINDOWS: platform.IS_WINDOWS, IS_MAC: platform.IS_MAC, IS_LINUX: platform.IS_LINUX };
    Object.assign(platform, { IS_WINDOWS: false, IS_MAC: false, IS_LINUX: true });
  });
  afterEach(() => {
    Object.assign(platform, saved);
  });

  it("stages the newest settled build, skipping ones too fresh to trust", async () => {
    const { root, llama, download } = setup({ releases: [release(300, 1), release(200, 4), release(150, 9)] });
    expect(await check(root)).toMatchObject({ status: "staged", tag: "b200" });
    expect(download).toHaveBeenCalledTimes(1);
    expect(binaryManager.readEngineMeta(`${llama}.pending`)).toMatchObject({ tag: "b200", previousTag: "b100" });
    expect(await check(root, { force: true })).toEqual({ status: "pending" });
  });

  it("waits days between checks unless forced", async () => {
    const { root, download } = setup({ releases: [release(100, 5)] });
    expect((await check(root)).status).toBe("current");
    expect((await check(root)).status).toBe("recent");
    expect(download).not.toHaveBeenCalled();
  });

  it("never stages a build that will not start here, and remembers it", async () => {
    const { root, llama } = setup({ releases: [release(200, 4)], starts: false });
    expect((await check(root)).status).toBe("failed");
    expect(fs.existsSync(`${llama}.pending`)).toBe(false);
    expect(binaryManager.readEngineMeta(llama).failedTags).toEqual(["b200"]);
    expect((await check(root, { force: true })).status).toBe("current");
  });

  it("moves to a faster build for the GPU even at the same version", async () => {
    const { root } = setup({
      releases: [release(100, 5, "cuda-13.4")],
      installed: { tag: "b100", variant: "cuda-12.8" },
    });
    // The CUDA pick needs its runtime archive too.
    binaryManager.fetchJson.mockResolvedValue([
      {
        ...release(100, 5, "cuda-13.4"),
        assets: [
          { name: "llama-b100-bin-ubuntu-cuda-13.4-x64.tar.gz" },
          { name: "cudart-llama-b100-bin-ubuntu-cuda-13.4-x64.tar.gz" },
        ],
      },
    ]);
    binaryManager.gpuProfile.mockResolvedValue({ vramGB: 16, nvidia: true, cuda13: true });
    expect(await check(root)).toMatchObject({ status: "staged", tag: "b100" });
  });
});
