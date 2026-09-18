const fs = require("node:fs");

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
function parseGgufBuffer(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf.readUInt32LE(0) !== GGUF_MAGIC) return null;

  const version = buf.readUInt32LE(4);
  if (version < 2 || version > 3) return null;

  const kvCount = Number(buf.readBigUInt64LE(16));
  let offset = 24;

  const meta = {};

  for (let i = 0; i < kvCount && offset < buf.length; i++) {
    const keyParsed = readString(buf, offset);
    if (!keyParsed || keyParsed.nextOffset + 4 > buf.length) break;

    const key = keyParsed.value;
    const valType = buf.readUInt32LE(keyParsed.nextOffset);
    const valOffset = keyParsed.nextOffset + 4;

    const valParsed = readScalar(buf, valOffset, valType);
    if (!valParsed) break;

    meta[key] = valParsed.value;
    offset = valParsed.nextOffset;
  }

  const arch = typeof meta["general.architecture"] === "string" ? meta["general.architecture"] : "unknown";
  const contextLength = Number(meta[`${arch}.context_length`]) || null;
  const blockCount = Number(meta[`${arch}.block_count`]) || null;
  const embeddingLength = Number(meta[`${arch}.embedding_length`]) || null;
  const fileType = typeof meta["general.file_type"] === "number" ? meta["general.file_type"] : null;
  const name = typeof meta["general.name"] === "string" ? meta["general.name"] : null;

  return {
    architecture: arch,
    contextLength,
    blockCount,
    embeddingLength,
    fileType,
    name,
    version,
  };
}

/** Reads the initial bytes of a GGUF file from disk and parses its header metadata. */
function parseGgufHeader(filePath) {
  let fd = null;
  try {
    fd = fs.openSync(filePath, "r");
    const stat = fs.fstatSync(fd);
    if (stat.size < 24) return null;

    const readBytes = Math.min(stat.size, HEADER_CHUNK_BYTES);
    const buf = Buffer.alloc(readBytes);
    fs.readSync(fd, buf, 0, readBytes, 0);

    return parseGgufBuffer(buf);
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignored on cleanup.
      }
    }
  }
}

module.exports = {
  GGUF_MAGIC,
  parseGgufBuffer,
  parseGgufHeader,
};
