import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import http from "node:http";

const require = createRequire(import.meta.url);
const modelStorage = require("./modelStorage.cjs");
const { GGUF_MAGIC } = require("./ggufParser.cjs");

function writeDummyGguf(filePath) {
  const buf = Buffer.alloc(128);
  buf.writeUInt32LE(GGUF_MAGIC, 0);
  buf.writeUInt32LE(3, 4);
  buf.writeBigUInt64LE(0n, 8);
  buf.writeBigUInt64LE(0n, 16);
  fs.writeFileSync(filePath, buf);
}

describe("modelStorage", () => {
  it("returns empty array for non-existent directory", () => {
    const missing = path.join(os.tmpdir(), `draggy-models-${Date.now()}`);
    expect(modelStorage.listGgufModels(missing)).toEqual([]);
  });

  it("lists only gguf models and ignores unrelated files", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-models-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "notes.txt"), "hello");
      fs.writeFileSync(path.join(tmpDir, "download.tmp"), "partial");
      writeDummyGguf(path.join(tmpDir, "tiny-test.gguf"));

      const list = modelStorage.listGgufModels(tmpDir);
      expect(list.length).toBe(1);
      expect(list[0].filename).toBe("tiny-test.gguf");
      expect(list[0].size).toBe(128);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("deletes existing model safely and blocks path traversal", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-delete-"));
    try {
      const modelFile = path.join(tmpDir, "to-remove.gguf");
      writeDummyGguf(modelFile);

      expect(fs.existsSync(modelFile)).toBe(true);
      const deleted = modelStorage.deleteGgufModel(tmpDir, "to-remove.gguf");
      expect(deleted).toBe(true);
      expect(fs.existsSync(modelFile)).toBe(false);

      expect(modelStorage.deleteGgufModel(tmpDir, "non-existent.gguf")).toBe(false);

      // Path traversal attempt should strip directory and safely miss target.
      expect(modelStorage.deleteGgufModel(tmpDir, "../../../outside.gguf")).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects download from unsafe private URL", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-dl-"));
    try {
      await expect(
        modelStorage.downloadGgufModel({
          url: "http://192.168.1.1/model.gguf",
          modelsDir: tmpDir,
          filename: "test.gguf",
        })
      ).rejects.toThrow(/security policy/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
