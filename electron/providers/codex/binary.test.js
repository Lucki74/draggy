import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { ASSETS, VERSION, assetFor, ensureCodex, installedBinary } = require("./binary.cjs");

const payload = Buffer.from("pretend archive");
const digest = crypto.createHash("sha256").update(payload).digest("hex");
const table = { "win32-x64": ["x86_64-pc-windows-msvc.exe.zip", digest, payload.length] };

let appData;
beforeEach(() => {
  appData = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-codex-"));
});
afterEach(() => fs.rmSync(appData, { recursive: true, force: true }));

/** Writes `bytes` as the download and, when extracted, one app-server executable. */
const fakes = (bytes = payload) => ({
  download: vi.fn(async (url, file, onBytes) => {
    fs.writeFileSync(file, bytes);
    onBytes(bytes.length);
  }),
  extract: vi.fn(async (archive, dir) => fs.writeFileSync(path.join(dir, "codex-app-server-x86_64-pc-windows-msvc.exe"), "exe")),
});

describe("codex binary", () => {
  it("pins one digest per platform the app ships on, from the pinned release", () => {
    expect(Object.keys(ASSETS).sort()).toEqual(
      ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"],
    );
    for (const [, sha256, size] of Object.values(ASSETS)) {
      expect(sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(size).toBeGreaterThan(50_000_000);
    }
    expect(assetFor("win32", "x64")).toEqual({
      name: "codex-app-server-x86_64-pc-windows-msvc.exe.zip",
      url: `https://github.com/openai/codex/releases/download/rust-v${VERSION}/codex-app-server-x86_64-pc-windows-msvc.exe.zip`,
      sha256: "85ca951a6859757fe425407c4afe3ee1c59f3d35f739cdbd3be109393493048c",
      size: 79967102,
    });
    expect(assetFor("freebsd", "x64")).toBeNull();
  });

  it("downloads, verifies and installs once, reporting progress", async () => {
    const { download, extract } = fakes();
    const onProgress = vi.fn();
    const options = { download, extract, onProgress, platformName: "win32", arch: "x64", assets: table };
    const binary = await ensureCodex(appData, options);
    expect(binary).toBe(path.join(appData, "codex", "bin", VERSION, "codex-app-server-x86_64-pc-windows-msvc.exe"));
    expect(onProgress).toHaveBeenLastCalledWith({ completed: payload.length, total: payload.length, percent: 100 });
    expect(fs.readdirSync(path.dirname(binary))).toEqual([path.basename(binary)]);
    await ensureCodex(appData, options);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("refuses an archive whose digest differs, and leaves nothing behind to run", async () => {
    const { download, extract } = fakes(Buffer.from("tampered archive"));
    const run = ensureCodex(appData, { download, extract, platformName: "win32", arch: "x64", assets: table });
    await expect(run).rejects.toMatchObject({ code: "account-runtime-unavailable", message: /Checksum mismatch/ });
    expect(extract).not.toHaveBeenCalled();
    expect(installedBinary(appData)).toBeNull();
    expect(fs.existsSync(path.join(appData, "codex", "bin", `${VERSION}.part`))).toBe(false);
  });

  it("says so on a platform Codex does not build for", async () => {
    const run = ensureCodex(appData, { ...fakes(), platformName: "freebsd", arch: "x64" });
    await expect(run).rejects.toMatchObject({ code: "account-runtime-unavailable" });
  });

  it("ships the plain catalog: every model without code mode, sub-agents or extra tools", () => {
    const { models } = JSON.parse(fs.readFileSync(path.join(__dirname, "models.json"), "utf8"));
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(model).toMatchObject({ tool_mode: null, multi_agent_version: null, use_responses_lite: false, experimental_supported_tools: [] });
    }
  });
});
