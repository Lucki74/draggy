import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { ASSETS, VERSION, assetFor, ensureClaude, installedBinary } = require("./binary.cjs");

const payload = Buffer.from("pretend claude.exe");
const digest = crypto.createHash("sha256").update(payload).digest("hex");
const table = { "win32-x64": [digest, payload.length] };

let appData;
beforeEach(() => {
  appData = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-claude-"));
});
afterEach(() => fs.rmSync(appData, { recursive: true, force: true }));

const fakeDownload = (bytes = payload) =>
  vi.fn(async (url, file, onBytes) => {
    fs.writeFileSync(file, bytes);
    onBytes(bytes.length);
  });

describe("claude binary", () => {
  it("pins one digest per platform the app ships on, musl included", () => {
    expect(Object.keys(ASSETS).sort()).toEqual([
      "darwin-arm64", "darwin-x64", "linux-arm64", "linux-arm64-musl",
      "linux-x64", "linux-x64-musl", "win32-arm64", "win32-x64",
    ]);
    for (const [sha256, size] of Object.values(ASSETS)) {
      expect(sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(size).toBeGreaterThan(50_000_000);
    }
  });

  it("names the file from Anthropic's own download host, and picks the musl build on musl", () => {
    expect(assetFor("win32", "x64", ASSETS, false)).toEqual({
      name: "claude.exe",
      url: `https://downloads.claude.ai/claude-code-releases/${VERSION}/win32-x64/claude.exe`,
      sha256: "4e4c1746aff835bb05e5ed14cda72d21ee6fbda4147aa99b3135718614da117e",
      size: 233691808,
    });
    expect(assetFor("linux", "x64", ASSETS, true).url).toMatch(/\/linux-x64-musl\/claude$/);
    expect(assetFor("darwin", "arm64", ASSETS, true).url).toMatch(/\/darwin-arm64\/claude$/);
    expect(assetFor("freebsd", "x64", ASSETS, false)).toBeNull();
  });

  it("downloads, verifies and installs once, reporting progress", async () => {
    const download = fakeDownload();
    const onProgress = vi.fn();
    const options = { download, onProgress, platformName: "win32", arch: "x64", assets: table, musl: false };
    const binary = await ensureClaude(appData, options);
    expect(binary).toBe(path.join(appData, "claude", "bin", VERSION, "claude.exe"));
    expect(fs.readFileSync(binary)).toEqual(payload);
    expect(onProgress).toHaveBeenLastCalledWith({ completed: payload.length, total: payload.length, percent: 100 });
    await ensureClaude(appData, options);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("refuses a download whose digest differs, and leaves nothing behind to run", async () => {
    const run = ensureClaude(appData, { download: fakeDownload(Buffer.from("tampered")), platformName: "win32", arch: "x64", assets: table, musl: false });
    await expect(run).rejects.toMatchObject({ code: "account-runtime-unavailable", message: /Checksum mismatch/ });
    expect(installedBinary(appData)).toBeNull();
    expect(fs.existsSync(path.join(appData, "claude", "bin", `${VERSION}.part`))).toBe(false);
  });

  it("says so on a platform Claude Code does not build for", async () => {
    const run = ensureClaude(appData, { download: fakeDownload(), platformName: "freebsd", arch: "x64", musl: false });
    await expect(run).rejects.toMatchObject({ code: "account-runtime-unavailable" });
  });
});
