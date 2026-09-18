import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
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
    expect(binaryManager.findLlamaBinary(emptyDir)).toBeNull();
  });
});
