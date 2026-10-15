import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const require = createRequire(import.meta.url);
const { GGUF_MAGIC, parseGgufBuffer, parseGgufHeader } = require("./ggufParser.cjs");
const logger = require("./logger.cjs");

function writeGgufString(buf, offset, str) {
  const strBuf = Buffer.from(str, "utf8");
  buf.writeBigUInt64LE(BigInt(strBuf.length), offset);
  strBuf.copy(buf, offset + 8);
  return offset + 8 + strBuf.length;
}

function buildSyntheticGguf({ architecture = "llama", contextLength = 8192, blockCount = 32 } = {}) {
  const buf = Buffer.alloc(1024);
  buf.writeUInt32LE(GGUF_MAGIC, 0);
  buf.writeUInt32LE(3, 4);
  buf.writeBigUInt64LE(1n, 8);
  buf.writeBigUInt64LE(3n, 16);

  let offset = 24;

  offset = writeGgufString(buf, offset, "general.architecture");
  buf.writeUInt32LE(8, offset);
  offset += 4;
  offset = writeGgufString(buf, offset, architecture);

  offset = writeGgufString(buf, offset, `${architecture}.context_length`);
  buf.writeUInt32LE(4, offset);
  offset += 4;
  buf.writeUInt32LE(contextLength, offset);
  offset += 4;

  offset = writeGgufString(buf, offset, `${architecture}.block_count`);
  buf.writeUInt32LE(4, offset);
  offset += 4;
  buf.writeUInt32LE(blockCount, offset);
  offset += 4;

  return buf.subarray(0, offset);
}

describe("ggufParser", () => {
  it("rejects buffers smaller than 24 bytes", () => {
    expect(parseGgufBuffer(Buffer.alloc(20))).toBeNull();
  });

  it("rejects non-GGUF magic bytes", () => {
    const fake = Buffer.alloc(32);
    fake.write("NOTG", 0);
    expect(parseGgufBuffer(fake)).toBeNull();
  });

  it("parses valid synthetic GGUF buffer metadata", () => {
    const buf = buildSyntheticGguf({ architecture: "qwen2", contextLength: 32768, blockCount: 28 });
    const parsed = parseGgufBuffer(buf);

    expect(parsed).not.toBeNull();
    expect(parsed.architecture).toBe("qwen2");
    expect(parsed.contextLength).toBe(32768);
    expect(parsed.blockCount).toBe(28);
    expect(parsed.version).toBe(3);
  });

  it("reads synthetic GGUF file from disk", () => {
    const tmpFile = path.join(os.tmpdir(), `draggy-test-${Date.now()}.gguf`);
    const buf = buildSyntheticGguf({ architecture: "mistral", contextLength: 16384, blockCount: 32 });
    fs.writeFileSync(tmpFile, buf);

    try {
      const parsed = parseGgufHeader(tmpFile);
      expect(parsed).not.toBeNull();
      expect(parsed.architecture).toBe("mistral");
      expect(parsed.contextLength).toBe(16384);
      expect(parsed.blockCount).toBe(32);
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // Ignored on cleanup.
      }
    }
  });

  it("gracefully returns null for missing or invalid files", () => {
    expect(parseGgufHeader(path.join(os.tmpdir(), "non-existent-draggy-model.gguf"))).toBeNull();
  });
});

describe("ggufParser attention shape", () => {
  /** A header of u32 values after the architecture string. */
  function headerWith(arch, values) {
    const buf = Buffer.alloc(4096);
    buf.writeUInt32LE(GGUF_MAGIC, 0);
    buf.writeUInt32LE(3, 4);
    buf.writeBigUInt64LE(0n, 8);
    buf.writeBigUInt64LE(BigInt(1 + Object.keys(values).length), 16);
    let offset = writeGgufString(buf, 24, "general.architecture");
    buf.writeUInt32LE(8, offset);
    offset = writeGgufString(buf, offset + 4, arch);
    for (const [key, value] of Object.entries(values)) {
      offset = writeGgufString(buf, offset, `${arch}.${key}`);
      buf.writeUInt32LE(4, offset);
      buf.writeUInt32LE(value, offset + 4);
      offset += 8;
    }
    return buf.subarray(0, offset);
  }

  it("reads the KV heads and head sizes a cache estimate needs, and the expert count", () => {
    const parsed = parseGgufBuffer(headerWith("qwen3moe", {
      block_count: 48,
      embedding_length: 2048,
      "attention.head_count": 32,
      "attention.head_count_kv": 4,
      "attention.key_length": 128,
      expert_count: 128,
    }));
    expect(parsed).toMatchObject({ blockCount: 48, headCountKv: 4, keyLength: 128, valueLength: 128, expertCount: 128 });
  });

  it("derives the head size from the embedding when the header leaves it out", () => {
    const parsed = parseGgufBuffer(headerWith("llama", {
      block_count: 32,
      embedding_length: 4096,
      "attention.head_count": 32,
      "attention.head_count_kv": 8,
    }));
    expect(parsed).toMatchObject({ headCountKv: 8, keyLength: 128, valueLength: 128, expertCount: 0 });
  });
});

describe("parseGgufBuffer tokenizer and MTP", () => {
  it("reads the tokenizer, the vocabulary size from the token list header, and MTP heads", () => {
    const buf = Buffer.alloc(4096);
    buf.writeUInt32LE(GGUF_MAGIC, 0);
    buf.writeUInt32LE(3, 4);
    buf.writeBigUInt64LE(0n, 8);
    buf.writeBigUInt64LE(5n, 16);
    let offset = 24;
    const str = (key, value) => {
      offset = writeGgufString(buf, offset, key);
      buf.writeUInt32LE(8, offset);
      offset = writeGgufString(buf, offset + 4, value);
    };
    str("general.architecture", "glm4moe");
    offset = writeGgufString(buf, offset, "glm4moe.nextn_predict_layers");
    buf.writeUInt32LE(4, offset);
    buf.writeUInt32LE(1, offset + 4);
    offset += 8;
    str("tokenizer.ggml.model", "gpt2");
    str("tokenizer.ggml.pre", "glm4");
    // A string array far longer than the buffer: only its header is read.
    offset = writeGgufString(buf, offset, "tokenizer.ggml.tokens");
    buf.writeUInt32LE(9, offset);
    buf.writeUInt32LE(8, offset + 4);
    buf.writeBigUInt64LE(151552n, offset + 8);

    const header = parseGgufBuffer(buf);
    expect(header).toMatchObject({ mtp: true, tokenizerModel: "gpt2", tokenizerPre: "glm4", vocabSize: 151552 });
  });
});

describe("header read failure logging", () => {
  let logDir;
  let eventsFile;

  const events = () =>
    fs
      .readFileSync(eventsFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

  beforeEach(() => {
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-gguf-log-"));
    eventsFile = logger.init({ getPath: () => logDir, getName: () => "Draggy", getVersion: () => "0" }).eventsFile;
  });

  afterEach(async () => {
    await logger.closeStreams();
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  it("logs the byte offset and the field being read when the header cannot be opened", async () => {
    expect(parseGgufHeader(path.join(logDir, "missing.gguf"))).toBeNull();

    let line;
    for (let i = 0; i < 100 && !line; i++) {
      await logger.flush();
      line = events().find((e) => e.msg === "header read failed");
      if (!line) await new Promise((resolve) => setTimeout(resolve, 30));
    }
    expect(line).toMatchObject({ level: "DEBUG", scope: "engine.gguf", data: { offset: 0, field: "open", code: "ENOENT" } });
    expect(JSON.stringify(line)).not.toContain(logDir);
  });
});
