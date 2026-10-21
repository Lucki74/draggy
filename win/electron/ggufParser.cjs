const fs = require("node:fs");
const { log } = require("./logger.cjs");

/** GGUF file format magic bytes: 'G', 'G', 'U', 'F' (0x46554747). */
const GGUF_MAGIC = 0x46554747;

/** Header chunk size: 64 KB is plenty for metadata without buffering weights. */
const HEADER_CHUNK_BYTES = 64 * 1024;

const GGUF_TYPE = {
  UINT8: 0,
  INT8: 1,
  UINT16: 2,
  INT16: 3,
  UINT32: 4,
  INT32: 5,
  FLOAT32: 6,
  BOOL: 7,
  STRING: 8,
  ARRAY: 9,
  UINT64: 10,
  INT64: 11,
  FLOAT64: 12,
};

const KNOWN_TYPES = new Set(Object.values(GGUF_TYPE));

/** Why a header walk stopped, with the byte offset and the field being read. A window that ends in the
 * middle of a large tokenizer list is normal; an unknown value type means the file is damaged. */
function noteStop(windowBytes, offset, field, type) {
  if (type !== undefined && !KNOWN_TYPES.has(type)) log.warn("engine.gguf", "unknown value type", { offset, field, type });
  else log.debug("engine.gguf", "header walk stopped", { offset, field, window: windowBytes });
}

function readString(buf, offset) {
  if (offset + 8 > buf.length) return null;
  const len = Number(buf.readBigUInt64LE(offset));
  const start = offset + 8;
  const end = start + len;
  if (end > buf.length) return null;
  return { value: buf.toString("utf8", start, end), nextOffset: end };
}

function skipValue(buf, offset, type) {
  switch (type) {
    case GGUF_TYPE.UINT8:
    case GGUF_TYPE.INT8:
    case GGUF_TYPE.BOOL:
      return offset + 1 <= buf.length ? offset + 1 : null;
    case GGUF_TYPE.UINT16:
    case GGUF_TYPE.INT16:
      return offset + 2 <= buf.length ? offset + 2 : null;
    case GGUF_TYPE.UINT32:
    case GGUF_TYPE.INT32:
    case GGUF_TYPE.FLOAT32:
      return offset + 4 <= buf.length ? offset + 4 : null;
    case GGUF_TYPE.UINT64:
    case GGUF_TYPE.INT64:
    case GGUF_TYPE.FLOAT64:
      return offset + 8 <= buf.length ? offset + 8 : null;
    case GGUF_TYPE.STRING: {
      const str = readString(buf, offset);
      return str ? str.nextOffset : null;
    }
    case GGUF_TYPE.ARRAY: {
      if (offset + 12 > buf.length) return null;
      const elemType = buf.readUInt32LE(offset);
      const count = Number(buf.readBigUInt64LE(offset + 4));
      let cur = offset + 12;
      for (let i = 0; i < count; i++) {
        const next = skipValue(buf, cur, elemType);
        if (next === null) return null;
        cur = next;
      }
      return cur;
    }
    default:
      return null;
  }
}

function readScalar(buf, offset, type) {
  if (offset >= buf.length) return null;
  switch (type) {
    case GGUF_TYPE.UINT8:
      return { value: buf.readUInt8(offset), nextOffset: offset + 1 };
    case GGUF_TYPE.INT8:
      return { value: buf.readInt8(offset), nextOffset: offset + 1 };
    case GGUF_TYPE.UINT16:
      return offset + 2 <= buf.length ? { value: buf.readUInt16LE(offset), nextOffset: offset + 2 } : null;
    case GGUF_TYPE.INT16:
      return offset + 2 <= buf.length ? { value: buf.readInt16LE(offset), nextOffset: offset + 2 } : null;
    case GGUF_TYPE.UINT32:
      return offset + 4 <= buf.length ? { value: buf.readUInt32LE(offset), nextOffset: offset + 4 } : null;
    case GGUF_TYPE.INT32:
      return offset + 4 <= buf.length ? { value: buf.readInt32LE(offset), nextOffset: offset + 4 } : null;
    case GGUF_TYPE.UINT64:
      return offset + 8 <= buf.length ? { value: Number(buf.readBigUInt64LE(offset)), nextOffset: offset + 8 } : null;
    case GGUF_TYPE.INT64:
      return offset + 8 <= buf.length ? { value: Number(buf.readBigInt64LE(offset)), nextOffset: offset + 8 } : null;
    case GGUF_TYPE.FLOAT32:
      return offset + 4 <= buf.length ? { value: buf.readFloatLE(offset), nextOffset: offset + 4 } : null;
    case GGUF_TYPE.FLOAT64:
      return offset + 8 <= buf.length ? { value: buf.readDoubleLE(offset), nextOffset: offset + 8 } : null;
    case GGUF_TYPE.BOOL:
      return { value: Boolean(buf.readUInt8(offset)), nextOffset: offset + 1 };
    case GGUF_TYPE.STRING:
      return readString(buf, offset);
    default: {
      const next = skipValue(buf, offset, type);
      return next !== null ? { value: null, nextOffset: next } : null;
    }
  }
}

/** Parses header key-value pairs from a memory buffer without reading tensor data. */
function parseGgufBuffer(buf, withKind = false) {
  if (!buf || buf.length < 24) return null;
  if (buf.readUInt32LE(0) !== GGUF_MAGIC) {
    log.warn("engine.gguf", "not a gguf header", { offset: 0, field: "magic" });
    return null;
  }

  const version = buf.readUInt32LE(4);
  if (version < 2 || version > 3) {
    log.warn("engine.gguf", "unsupported gguf version", { offset: 4, field: "version", version });
    return null;
  }

  const kvCount = Number(buf.readBigUInt64LE(16));
  let offset = 24;

  const meta = {};
  // Element counts of arrays, read from their own header: the token list is megabytes long, but its
  // length (the vocabulary size) is known before the first entry.
  const counts = {};

  for (let i = 0; i < kvCount && offset < buf.length; i++) {
    const keyParsed = readString(buf, offset);
    if (!keyParsed || keyParsed.nextOffset + 4 > buf.length) {
      noteStop(buf.length, offset, keyParsed ? "value type" : "key");
      break;
    }

    const key = keyParsed.value;
    const valType = buf.readUInt32LE(keyParsed.nextOffset);
    const valOffset = keyParsed.nextOffset + 4;
    if (valType === GGUF_TYPE.ARRAY && valOffset + 12 <= buf.length) {
      counts[key] = Number(buf.readBigUInt64LE(valOffset + 4));
    }

    const valParsed = readScalar(buf, valOffset, valType);
    if (!valParsed) {
      noteStop(buf.length, valOffset, `value:${key}`, valType);
      break;
    }

    meta[key] = valParsed.value;
    offset = valParsed.nextOffset;
  }

  const arch = typeof meta["general.architecture"] === "string" ? meta["general.architecture"] : "unknown";
  const contextLength = Number(meta[`${arch}.context_length`]) || null;
  const blockCount = Number(meta[`${arch}.block_count`]) || null;
  const embeddingLength = Number(meta[`${arch}.embedding_length`]) || null;
  const fileType = typeof meta["general.file_type"] === "number" ? meta["general.file_type"] : null;
  const name = typeof meta["general.name"] === "string" ? meta["general.name"] : null;
  // Mixture-of-experts models keep most weights in experts that llama.cpp can leave in system RAM.
  const expertCount = Number(meta[`${arch}.expert_count`]) || 0;
  const expertUsedCount = Number(meta[`${arch}.expert_used_count`]) || 0;
  // What the KV cache costs per token. Per-layer arrays (a few hybrid models) read as null here.
  const headCount = Number(meta[`${arch}.attention.head_count`]) || null;
  const headCountKv = Number(meta[`${arch}.attention.head_count_kv`]) || headCount;
  const keyLength = Number(meta[`${arch}.attention.key_length`]) || (headCount && embeddingLength ? embeddingLength / headCount : null);
  const valueLength = Number(meta[`${arch}.attention.value_length`]) || keyLength;
  // Multi-token prediction heads (GLM, DeepSeek, Qwen3-Next): the engine can draft from them itself.
  const mtp = Number(meta[`${arch}.nextn_predict_layers`]) > 0;
  // Which tokenizer the model speaks, so a draft model is only paired with one that shares it.
  const tokenizerModel = typeof meta["tokenizer.ggml.model"] === "string" ? meta["tokenizer.ggml.model"] : null;
  const tokenizerPre = typeof meta["tokenizer.ggml.pre"] === "string" ? meta["tokenizer.ggml.pre"] : null;
  // A pooling type is written only by models that turn text into one vector, never by chat models.
  const pooled = meta[arch + ".pooling_type"] !== undefined || /(^|-)bert|embedding/.test(arch);
  // Vision projectors and speech models share the format but cannot hold a conversation.
  const chat = !/^(clip|mmproj|sortformer|whisper|parakeet|wav2vec|conformer|fastconformer|bark|snac|dac|encodec|vits)/.test(arch);
  const vocabSize = counts["tokenizer.ggml.tokens"] || Number(meta[`${arch}.vocab_size`]) || null;

  return {
    architecture: arch,
    contextLength,
    blockCount,
    embeddingLength,
    fileType,
    name,
    expertCount,
    expertUsedCount,
    headCountKv,
    keyLength,
    valueLength,
    mtp,
    tokenizerModel,
    tokenizerPre,
    vocabSize,
    ...(withKind ? { chat, pooled } : {}),
    version,
  };
}

/** Reads the initial bytes of a GGUF file from disk and parses its header metadata. */
function parseGgufHeader(filePath, withKind = false) {
  let fd = null;
  let field = "open";
  let position = 0;
  try {
    fd = fs.openSync(filePath, "r");
    field = "stat";
    const stat = fs.fstatSync(fd);
    if (stat.size < 24) return null;

    const readBytes = Math.min(stat.size, HEADER_CHUNK_BYTES);
    const buf = Buffer.alloc(readBytes);
    field = "header bytes";
    fs.readSync(fd, buf, 0, readBytes, 0);
    position = readBytes;

    field = "header walk";
    return parseGgufBuffer(buf, withKind);
  } catch (error) {
    log.debug("engine.gguf", "header read failed", { offset: position, field, code: error?.code ?? null });
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (error) {
        log.swallow("engine", error, "ignored on cleanup");
      }
    }
  }
}

/** Bytes of a value that has a fixed size, by GGUF type. */
const FIXED_SIZE = new Map([
  [GGUF_TYPE.UINT8, 1],
  [GGUF_TYPE.INT8, 1],
  [GGUF_TYPE.BOOL, 1],
  [GGUF_TYPE.UINT16, 2],
  [GGUF_TYPE.INT16, 2],
  [GGUF_TYPE.UINT32, 4],
  [GGUF_TYPE.INT32, 4],
  [GGUF_TYPE.FLOAT32, 4],
  [GGUF_TYPE.UINT64, 8],
  [GGUF_TYPE.INT64, 8],
  [GGUF_TYPE.FLOAT64, 8],
]);

const WINDOW_BYTES = 1024 * 1024;
const CHAT_TEMPLATE_KEY = "tokenizer.chat_template";

/** Reads a file through a moving window, so a header much larger than one chunk can be walked
 * without holding it all: the tokenizer's word lists alone run to megabytes. */
class FileWindow {
  constructor(fd, size) {
    this.fd = fd;
    this.size = size;
    this.start = 0;
    this.buf = Buffer.alloc(0);
  }

  /** `length` bytes from `offset`, or null past the end of the file. */
  read(offset, length) {
    if (offset < 0 || length < 0 || offset + length > this.size) return null;
    if (length > WINDOW_BYTES) {
      const big = Buffer.alloc(length);
      fs.readSync(this.fd, big, 0, length, offset);
      return big;
    }
    if (offset < this.start || offset + length > this.start + this.buf.length) {
      const chunk = Math.min(WINDOW_BYTES, this.size - offset);
      this.buf = Buffer.alloc(chunk);
      fs.readSync(this.fd, this.buf, 0, chunk, offset);
      this.start = offset;
    }
    return this.buf.subarray(offset - this.start, offset - this.start + length);
  }

  u32(offset) {
    const bytes = this.read(offset, 4);
    return bytes ? bytes.readUInt32LE(0) : null;
  }

  u64(offset) {
    const bytes = this.read(offset, 8);
    return bytes ? Number(bytes.readBigUInt64LE(0)) : null;
  }
}

/** The offset just past a value, walked without reading array contents into memory. */
function skipValueInFile(win, offset, type) {
  const fixed = FIXED_SIZE.get(type);
  if (fixed !== undefined) return offset + fixed;

  if (type === GGUF_TYPE.STRING) {
    const length = win.u64(offset);
    return length === null ? null : offset + 8 + length;
  }

  if (type === GGUF_TYPE.ARRAY) {
    const elementType = win.u32(offset);
    const count = win.u64(offset + 4);
    if (elementType === null || count === null) return null;

    let cursor = offset + 12;
    const elementSize = FIXED_SIZE.get(elementType);
    if (elementSize !== undefined) return cursor + count * elementSize;

    for (let index = 0; index < count; index += 1) {
      cursor = skipValueInFile(win, cursor, elementType);
      if (cursor === null) return null;
    }
    return cursor;
  }

  return null;
}

/** The model's chat template, or null when it has none or the file cannot be read. It sits after the
 * tokenizer's word lists, far past the part `parseGgufHeader` reads, so the file is walked entry by
 * entry, skipping what is not wanted. */
function readChatTemplate(filePath) {
  let fd = null;
  let field = "open";
  let offset = 0;
  try {
    fd = fs.openSync(filePath, "r");
    field = "stat";
    const win = new FileWindow(fd, fs.fstatSync(fd).size);

    field = "magic";
    if (win.u32(0) !== GGUF_MAGIC) return null;
    field = "version";
    const version = win.u32(4);
    if (version < 2 || version > 3) return null;

    field = "entry count";
    const entries = win.u64(16);
    offset = 24;

    for (let index = 0; index < entries; index += 1) {
      field = "key length";
      const keyLength = win.u64(offset);
      if (keyLength === null || keyLength > 4096) {
        log.debug("engine.gguf", "chat template walk stopped", { offset, field: "key length", keyLength });
        return null;
      }
      field = "key";
      const key = win.read(offset + 8, keyLength);
      const type = win.u32(offset + 8 + keyLength);
      if (key === null || type === null) {
        log.debug("engine.gguf", "chat template walk stopped", { offset, field: "key", keyLength });
        return null;
      }

      const valueOffset = offset + 8 + keyLength + 4;
      const name = key.toString("utf8");
      if (name === CHAT_TEMPLATE_KEY && type === GGUF_TYPE.STRING) {
        field = "template length";
        const length = win.u64(valueOffset);
        field = "template text";
        const text = length === null ? null : win.read(valueOffset + 8, length);
        return text ? text.toString("utf8") : null;
      }

      field = `value:${name}`;
      offset = skipValueInFile(win, valueOffset, type);
      if (offset === null) {
        noteStop(win.size, valueOffset, field, type);
        return null;
      }
    }
    return null;
  } catch (error) {
    log.debug("engine.gguf", "chat template read failed", { offset, field, code: error?.code ?? null });
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (error) {
        log.swallow("engine", error, "ignored on cleanup");
      }
    }
  }
}

/** What a model can do, from its chat template. A template that never mentions tools cannot format a
 * call to one, so its model has none; a model whose template could not be read is given the benefit
 * of the doubt. A template that opens a thinking block, or takes an option to switch one on, marks a
 * model that can think. */
function capabilitiesFromTemplate(template) {
  const known = typeof template === "string";
  const capabilities = [];
  if (!known || /tool/i.test(template)) capabilities.push("tools");
  capabilities.push("completion");
  if (known && /<think>|enable_thinking|reasoning_effort/.test(template)) capabilities.push("thinking");
  return capabilities;
}

module.exports = {
  GGUF_MAGIC,
  capabilitiesFromTemplate,
  parseGgufBuffer,
  parseGgufHeader,
  readChatTemplate,
};
