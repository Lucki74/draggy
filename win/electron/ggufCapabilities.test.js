import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { GGUF_MAGIC, capabilitiesFromTemplate, readChatTemplate } = require("./ggufParser.cjs");
const modelStorage = require("./modelStorage.cjs");
const logger = require("./logger.cjs");

const TYPE = { UINT32: 4, INT32: 5, STRING: 8, ARRAY: 9 };

const text = (value) => {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(bytes.length));
  return Buffer.concat([length, bytes]);
};

const u32 = (value) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
};

const u64 = (value) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
};

const entry = (key, type, value) => Buffer.concat([text(key), u32(type), value]);

const stringArray = (items) =>
  Buffer.concat([u32(TYPE.STRING), u64(items.length), ...items.map((item) => text(item))]);

const intArray = (count) => Buffer.concat([u32(TYPE.INT32), u64(count), Buffer.alloc(count * 4)]);

/** A GGUF file laid out like a real model: the architecture first, then a tokenizer whose word lists
 * are megabytes long, and only then the chat template. */
function buildModel({ template, tokens = 150_000, arch = "qwen3", pooling }) {
  const words = Array.from({ length: tokens }, (_, index) => `tok${index}`);
  const entries = [
    entry("general.architecture", TYPE.STRING, text(arch)),
    entry(`${arch}.block_count`, TYPE.UINT32, u32(32)),
    entry("tokenizer.ggml.tokens", TYPE.ARRAY, stringArray(words)),
    entry("tokenizer.ggml.token_type", TYPE.ARRAY, intArray(tokens)),
  ];
  if (pooling !== undefined) entries.push(entry(`${arch}.pooling_type`, TYPE.UINT32, u32(pooling)));
  if (template !== undefined) entries.push(entry("tokenizer.chat_template", TYPE.STRING, text(template)));

  const header = Buffer.alloc(24);
  header.writeUInt32LE(GGUF_MAGIC, 0);
  header.writeUInt32LE(3, 4);
  header.writeBigUInt64LE(0n, 8);
  header.writeBigUInt64LE(BigInt(entries.length), 16);
  return Buffer.concat([header, ...entries]);
}

const dirs = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-caps-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("readChatTemplate", () => {
  it("finds a template that sits megabytes past the start of the file", () => {
    const file = path.join(tempDir(), "model.gguf");
    const template = "{% if enable_thinking %}<think>{% endif %}";
    const bytes = buildModel({ template });
    fs.writeFileSync(file, bytes);

    expect(bytes.length).toBeGreaterThan(2 * 1024 * 1024);
    expect(readChatTemplate(file)).toBe(template);
  });

  it("returns null for a model without a template", () => {
    const file = path.join(tempDir(), "plain.gguf");
    fs.writeFileSync(file, buildModel({ tokens: 100 }));

    expect(readChatTemplate(file)).toBeNull();
  });

  it("returns null for a missing file, a non-GGUF file and a truncated one", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "notes.gguf"), "not a model at all, just text");
    const truncated = buildModel({ template: "x" }).subarray(0, 5000);
    fs.writeFileSync(path.join(dir, "cut.gguf"), truncated);

    expect(readChatTemplate(path.join(dir, "missing.gguf"))).toBeNull();
    expect(readChatTemplate(path.join(dir, "notes.gguf"))).toBeNull();
    expect(readChatTemplate(path.join(dir, "cut.gguf"))).toBeNull();
  });
});

describe("capabilitiesFromTemplate", () => {
  it("gives a model tools when its template handles them, or cannot be read", () => {
    expect(capabilitiesFromTemplate(null)).toEqual(["tools", "completion"]);
    expect(capabilitiesFromTemplate("{% if tools %}{{ tools }}{% endif %}")).toEqual(["tools", "completion"]);
    expect(capabilitiesFromTemplate("{{ message.tool_calls }}")).toContain("tools");
  });

  it("leaves tools out for a template that never mentions them", () => {
    expect(capabilitiesFromTemplate("{{ messages }}")).toEqual(["completion"]);
    expect(capabilitiesFromTemplate("<think>{{ messages }}")).toEqual(["completion", "thinking"]);
  });

  it("adds thinking for a template that opens a thinking block or takes an option for one", () => {
    expect(capabilitiesFromTemplate("<think>")).toContain("thinking");
    expect(capabilitiesFromTemplate("{% if enable_thinking %}")).toContain("thinking");
    expect(capabilitiesFromTemplate("Reasoning: {{ reasoning_effort }}")).toContain("thinking");
  });
});

describe("listGgufModels capabilities", () => {
  it("reports thinking for a model whose template supports it and not for one that does not", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "thinker.gguf"), buildModel({ template: "<think>", tokens: 500 }));
    fs.writeFileSync(path.join(dir, "tooler.gguf"), buildModel({ template: "{{ tools }} <think>", tokens: 500 }));
    fs.writeFileSync(path.join(dir, "plain.gguf"), buildModel({ template: "{{ messages }}", tokens: 500 }));

    const byName = Object.fromEntries(modelStorage.listGgufModels(dir).map((model) => [model.filename, model]));

    expect(byName["thinker.gguf"].capabilities).toEqual(["completion", "thinking"]);
    expect(byName["plain.gguf"].capabilities).toEqual(["completion"]);
    expect(byName["tooler.gguf"].capabilities).toEqual(["tools", "completion", "thinking"]);
  });

  it("lists an embedding model and a speech model without the ability to chat", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "embedder.gguf"), buildModel({ arch: "qwen3", pooling: 3, tokens: 100 }));
    fs.writeFileSync(path.join(dir, "bert.gguf"), buildModel({ arch: "nomic-bert", tokens: 100 }));
    fs.writeFileSync(path.join(dir, "speech.gguf"), buildModel({ arch: "sortformer", tokens: 100 }));
    fs.writeFileSync(path.join(dir, "unknown.gguf"), buildModel({ arch: "unknown", tokens: 100 }));

    const byName = Object.fromEntries(modelStorage.listGgufModels(dir).map((model) => [model.filename, model]));

    expect(byName["embedder.gguf"].capabilities).toEqual(["embedding"]);
    expect(byName["bert.gguf"].capabilities).toEqual(["embedding"]);
    expect(byName["speech.gguf"].capabilities).toEqual(["audio"]);
    expect(byName["unknown.gguf"].capabilities).toEqual(["audio"]);
  });
});

describe("chat template read failure logging", () => {
  let logDir;
  let eventsFile;

  const events = () =>
    fs
      .readFileSync(eventsFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

  beforeEach(() => {
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-template-log-"));
    eventsFile = logger.init({ getPath: () => logDir, getName: () => "Draggy", getVersion: () => "0" }).eventsFile;
  });

  afterEach(async () => {
    await logger.closeStreams();
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  it("logs the offset and the field being read when the template file cannot be opened", async () => {
    expect(readChatTemplate(path.join(logDir, "missing.gguf"))).toBeNull();

    let line;
    for (let i = 0; i < 100 && !line; i++) {
      await logger.flush();
      line = events().find((e) => e.msg === "chat template read failed");
      if (!line) await new Promise((resolve) => setTimeout(resolve, 30));
    }
    expect(line).toMatchObject({ level: "DEBUG", scope: "engine.gguf", data: { offset: 0, field: "open", code: "ENOENT" } });
    expect(JSON.stringify(line)).not.toContain(logDir);
  });
});
