const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { RESOURCE_HEADERS } = require("./isolation.cjs");
const { log } = require("./logger.cjs");

/**
 * The draggy://models/ protocol: Hugging Face files, kept on disk after the first download.
 *
 * A file not yet on disk is streamed to the page as it arrives while being written beside its final
 * name, so a download of hundreds of megabytes shows progress from its first byte instead of after
 * its last, and takes no more memory than one chunk. It only takes its real name once complete: a
 * cancelled or failed download never leaves a truncated file that later reads as cached.
 */

function modelFileHeaders(relative, size) {
  const extension = path.extname(relative).toLowerCase();
  return {
    ...RESOURCE_HEADERS,
    ...(Number.isFinite(size) && size >= 0 ? { "Content-Length": String(size) } : {}),
    "Content-Type":
      extension === ".json"
        ? "application/json"
        : extension === ".txt"
          ? "text/plain"
          : "application/octet-stream",
  };
}

/** The cached path for `relative` under `root`, or null when it would escape the cache folder. */
function cachedPath(root, relative) {
  const base = path.resolve(root);
  const target = path.resolve(path.join(base, relative));
  const inside = path.relative(base, target);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) return null;
  return target;
}

/** Streams `upstream`'s body to the caller while writing it to `target`. */
function teeToFile(upstream, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const partial = `${target}.${process.pid}-${crypto.randomBytes(4).toString("hex")}.part`;
  const file = fs.createWriteStream(partial);
  const reader = upstream.body.getReader();
  const name = path.basename(target);
  let bytes = 0;
  let failed = false;
  const total = Number(upstream.headers.get("content-length")) || 0;
  const startedAt = Date.now();
  let lastDecile = -1;

  const discard = () => {
    if (failed) return;
    failed = true;
    // Removed once the stream has closed: the file may still be being opened, and removing it first
    // would let the open recreate it.
    file.once("close", () => fs.rm(partial, { force: true }, () => {}));
    file.destroy();
  };

  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          await new Promise((resolve, reject) => file.end((err) => (err ? reject(err) : resolve())));
          if (!failed) fs.renameSync(partial, target);
          const durMs = Date.now() - startedAt;
          log.info("engine.models", "model cached", { file: name, bytes, durMs, avgBytesPerSec: Math.round((bytes * 1000) / Math.max(durMs, 1)) });
          controller.close();
          return;
        }
        bytes += value.byteLength;
        const decile = total > 0 ? Math.floor((bytes / total) * 10) : -1;
        if (decile > lastDecile) {
          lastDecile = decile;
          log.debug("engine.models", "model download progress", { file: name, percent: decile * 10, bytes, total });
        }
        if (!file.write(value)) await new Promise((resolve) => file.once("drain", resolve));
        controller.enqueue(value);
      } catch (error) {
        log.fail("engine.models", "model download failed", error, { file: name, bytes });
        discard();
        controller.error(error);
      }
    },
    cancel(reason) {
      log.info("engine.models", "model download cancelled", { file: name, bytes });
      discard();
      return reader.cancel(reason);
    },
  });
}

/** Answers one draggy://models/ request. */
async function serveModelFile(relative, { root, origin, fetchImpl = fetch }) {
  if (!relative) return new Response("Bad request", { status: 400 });
  const target = cachedPath(root, relative);
  if (!target) return new Response("Bad request", { status: 400 });

  const name = path.basename(relative);
  if (fs.existsSync(target)) {
    const size = fs.statSync(target).size;
    log.debug("engine.models", "served from cache", { file: name, size });
    const body = fs.createReadStream(target);
    return new Response(require("node:stream").Readable.toWeb(body), {
      headers: modelFileHeaders(relative, size),
    });
  }

  log.info("engine.models", "fetch started", { file: name });
  const upstream = await fetchImpl(`${origin}/${relative}`);
  log.info("engine.models", "fetch connected",{ file: name, status: upstream.status, bytes: Number(upstream.headers?.get?.("content-length")) || null });
  if (!upstream.ok || !upstream.body) {
    log.fail("engine.models", "fetch refused", null, { file: name, status: upstream.status });
    return new Response(upstream.statusText, { status: upstream.status || 502 });
  }

  const size = Number(upstream.headers.get("content-length"));
  return new Response(teeToFile(upstream, target), {
    headers: modelFileHeaders(relative, Number.isFinite(size) && size > 0 ? size : NaN),
  });
}

module.exports = { serveModelFile, cachedPath, modelFileHeaders };
