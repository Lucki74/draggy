const path = require("node:path");

/** llama.cpp's own split naming: `model-00001-of-00004.gguf`. It loads shard 1 and opens the rest itself. */
const SHARD_NAME = /^(.+)-(\d{5})-of-(\d{5})\.gguf$/i;

/** Reads the position of a split-model file, or null for a model held in one file. */
function parseShard(filename) {
  const match = SHARD_NAME.exec(path.basename(String(filename)));
  if (!match) return null;
  return { stem: match[1], index: Number(match[2]), total: Number(match[3]), totalText: match[3] };
}

/** Every file a split model is made of, in order; just the one name for a single-file model. */
function shardNames(filename) {
  const shard = parseShard(filename);
  if (!shard) return [path.basename(String(filename))];
  return Array.from({ length: shard.total }, (_, position) => {
    return `${shard.stem}-${String(position + 1).padStart(5, "0")}-of-${shard.totalText}.gguf`;
  });
}

module.exports = { parseShard, shardNames };
