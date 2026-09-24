const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

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
  let failed = false;

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
          controller.close();
          return;
        }
        if (!file.write(value)) await new Promise((resolve) => file.once("drain", resolve));
        controller.enqueue(value);
      } catch (error) {
        discard();
        controller.error(error);
      }
    },
    cancel(reason) {
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

  if (fs.existsSync(target)) {
    const size = fs.statSync(target).size;
    const body = fs.createReadStream(target);
    return new Response(require("node:stream").Readable.toWeb(body), {
      headers: modelFileHeaders(relative, size),
    });
  }

  const upstream = await fetchImpl(`${origin}/${relative}`);
  if (!upstream.ok || !upstream.body) {
    return new Response(upstream.statusText, { status: upstream.status || 502 });
  }

  const size = Number(upstream.headers.get("content-length"));
  return new Response(teeToFile(upstream, target), {
    headers: modelFileHeaders(relative, Number.isFinite(size) && size > 0 ? size : NaN),
  });
}

module.exports = { serveModelFile, cachedPath, modelFileHeaders };
