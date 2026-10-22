const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const http = require("node:http");
const urlPolicy = require("./urlPolicy.cjs");
const ggufParser = require("./ggufParser.cjs");
const { parseShard, shardNames } = require("./shards.cjs");
const mmproj = require("./mmproj.cjs");
const draftModel = require("./draftModel.cjs");
const { log } = require("./logger.cjs");

/** Log fields carry the host and repo only: query strings and full local paths stay out of the log. */
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "invalid";
  }
}

function repoOf(url) {
  try {
    return /^\/([^/]+\/[^/]+)\/resolve\//.exec(new URL(url).pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

function freeBytesOf(dir) {
  try {
    const stats = fs.statfsSync(dir);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch (error) {
    log.swallow("files", error, "free space is informational only");
    return null;
  }
}

/** Scans directory for GGUF files and reads metadata headers. */
/** Capabilities by file, so the chat template is read once per model rather than on every listing. */
const capabilityCache = new Map();

function capabilitiesOf(fullPath, stat) {
  const key = `${fullPath}|${stat.size}|${stat.mtimeMs}`;
  let capabilities = capabilityCache.get(key);
  if (!capabilities) {
    capabilities = ggufParser.capabilitiesFromTemplate(ggufParser.readChatTemplate(fullPath));
    capabilityCache.set(key, capabilities);
  }
  return capabilities;
}

function listGgufModels(modelsDir) {
  log.debug("engine.models", "scan started", { dir: path.basename(modelsDir) });
  if (!fs.existsSync(modelsDir)) return [];

  const files = fs.readdirSync(modelsDir);
  const present = new Set(files);
  const models = [];

  for (const file of files) {
    if (!file.toLowerCase().endsWith(".gguf") || mmproj.isCompanionFile(file) || draftModel.isCompanionDraft(file)) continue;
    const shard = parseShard(file);
    // The later parts are read through the first, so they are one model, not several.
    if (shard && shard.index > 1 && present.has(shardNames(file)[0])) continue;
    const fullPath = path.join(modelsDir, file);
    try {
      const stat = fs.statSync(fullPath);
      const header = ggufParser.parseGgufHeader(fullPath, true);
      const size = shard
        ? shardNames(file).reduce((sum, name) => sum + (present.has(name) ? fs.statSync(path.join(modelsDir, name)).size : 0), 0)
        : stat.size;
      models.push({
        name: file,
        filename: file,
        size,
        path: fullPath,
        architecture: header?.architecture || "unknown",
        contextLength: header?.contextLength || null,
        blockCount: header?.blockCount || null,
        fileType: header?.fileType || null,
        // Embedding and speech models cannot chat; for the rest a projector beside the model adds vision.
        capabilities: header?.pooled
          ? ["embedding"]
          : header && !header.chat
            ? ["audio"]
            : mmproj.findCompanion(modelsDir, file)
              ? [...capabilitiesOf(fullPath, stat), "vision"]
              : capabilitiesOf(fullPath, stat),
      });
      log.debug("engine.models", "model found", { file, arch: header?.architecture || "unknown", bytes: stat.size });
    } catch (error) {
      log.warn("engine.models", "model file unreadable", { file, code: error?.code ?? null });
    }
  }

  log.info("engine.models", "models listed", { count: models.length, dir: path.basename(modelsDir) });
  return models;
}

/** Deletes a GGUF model from disk, every part of it when it is split. */
function deleteGgufModel(modelsDir, filename) {
  const safeName = path.basename(filename);
  const target = path.join(modelsDir, safeName);
  log.info("engine.models", "model delete requested", { file: safeName });
  if (fs.existsSync(target)) {
    for (const name of shardNames(safeName)) fs.rmSync(path.join(modelsDir, name), { force: true });
    fs.rmSync(path.join(modelsDir, mmproj.companionName(safeName)), { force: true });
    fs.rmSync(path.join(modelsDir, draftModel.draftCompanionName(safeName)), { force: true });
    log.info("engine.models", "model deleted", { file: safeName });
    return true;
  }
  log.warn("engine.models", "model delete target missing", { file: safeName });
  return false;
}

const activeDownloads = new Map();

/** Image models may be safetensors or ckpt, so their downloads keep the name they have. */
// A connection that goes quiet never errors on its own; one stalled at 55 MB here sat for twenty minutes.
const STALL_MS = 60_000;
// A partial older than this is left from another upload of the file, so it is not continued.
const PARTIAL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function safeGgufName(filename, keepExtension = false) {
  const base = path.basename(filename);
  return keepExtension || base.endsWith(".gguf") ? base : `${base}.gguf`;
}

function abortError() {
  const err = new Error("Download cancelled");
  err.name = "AbortError";
  return err;
}

/** Destroys a stream and resolves once its handle is released, since Windows cannot unlink an open file. */
function closeStream(stream) {
  if (!stream || stream.closed) return Promise.resolve();
  return new Promise((resolve) => {
    stream.once("close", resolve);
    stream.destroy();
  });
}

/** Streams download of GGUF model from validated URL with progress tracking. */
function downloadGgufModel({ url, modelsDir, filename, onProgress, cid, maxRedirects = 5, keepExtension = false, stallMs = STALL_MS, retries = 3, retryDelayMs = 1500 }) {
  if (!urlPolicy.isFetchableUrl(url, { allowPrivate: false })) {
    log.warn("engine.models", "download refused by url policy", { host: hostOf(url) });
    return Promise.reject(new Error("URL refused by outbound security policy"));
  }

  fs.mkdirSync(modelsDir, { recursive: true });
  const safeName = safeGgufName(filename, keepExtension);
  const destPath = path.join(modelsDir, safeName);
  const tempPath = `${destPath}.download`;
  const key = `${modelsDir}:${safeName}`;

  if (activeDownloads.has(key)) {
    const active = activeDownloads.get(key);
    if (onProgress) active.listeners.add(onProgress);
    return active.promise;
  }

  const listeners = new Set();
  if (onProgress) listeners.add(onProgress);
  const entry = { promise: null, listeners, req: null, fileStream: null, tempPath, destPath, reject: null, cancelled: false };

  const emit = (payload) => {
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch (error) {
        log.swallow("files", error, "a listener that throws must not stop the others");
      }
    }
  };

  log.info("engine.models", "download started", {
    cid,
    repo: repoOf(url),
    file: safeName,
    host: hostOf(url),
    drive: path.parse(destPath).root.replace(/[\\/]+$/, "") || null,
    freeBytes: freeBytesOf(modelsDir),
  });

  const promise = new Promise((resolve, reject) => {
    entry.reject = reject;
    let lastLoggedPercent = -1;
    let lastEmittedTime = 0;
    let retriesLeft = retries;
    let resumeFrom = 0;

    // A partial from an earlier try is continued, unless it is old enough to belong to another upload.
    try {
      const stat = fs.statSync(tempPath);
      if (stat.size > 0 && Date.now() - stat.mtimeMs < PARTIAL_MAX_AGE_MS) resumeFrom = stat.size;
      else if (stat.size > 0) fs.unlinkSync(tempPath);
    } catch (error) {
      log.swallow("files", error, "no partial download yet");
    }
    const startedAt = Date.now();
    const startBytes = resumeFrom;

    const fail = (err) => {
      activeDownloads.delete(key);
      reject(err);
    };

    /** A dropped or stalled connection: the bytes on disk are kept and the transfer carries on from them. */
    const transient = async (req, err) => {
      if (entry.req !== req || entry.cancelled) return;
      entry.req = null;
      await closeStream(entry.fileStream);
      if (entry.cancelled) return;
      if (retriesLeft > 0) {
        retriesLeft -= 1;
        try {
          resumeFrom = fs.statSync(tempPath).size;
        } catch {
          resumeFrom = 0;
        }
        log.warn("engine.models", "download interrupted, resuming", { file: safeName, resumeFrom, retriesLeft, reason: err.code || err.message });
        await new Promise((r) => setTimeout(r, retryDelayMs));
        if (entry.cancelled) return;
        return fetchWithRedirects(url, maxRedirects);
      }
      log.fail("engine.models", "download network error", err, { file: safeName, resumeFrom });
      fail(err);
    };

    function fetchWithRedirects(currentUrl, redirectsLeft) {
      if (redirectsLeft < 0) {
        log.fail("engine.models", "download failed: too many redirects", null, { file: safeName, host: hostOf(url) });
        return fail(new Error("Too many redirects"));
      }

      const parsed = new URL(currentUrl);
      const client = parsed.protocol === "https:" ? https : http;
      const headers = resumeFrom > 0 ? { Range: `bytes=${resumeFrom}-` } : {};

      const req = client.get(currentUrl, { headers }, (res) => {
        if (entry.cancelled) return res.destroy();
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // The redirect is done with: left open, its stall timer fired mid-download and deleted the file.
          res.resume();
          req.setTimeout(0);
          const next = new URL(res.headers.location, currentUrl).href;
          log.info("engine.models", "download redirected", { host: hostOf(next), redirectsLeft });
          if (!urlPolicy.isFetchableUrl(next, { allowPrivate: false })) {
            log.warn("engine.models", "redirect refused by url policy", { host: hostOf(next) });
            return fail(new Error("Redirect URL refused by security policy"));
          }
          return fetchWithRedirects(next, redirectsLeft - 1);
        }

        // The partial is not one this server can continue: start the file over.
        if (res.statusCode === 416 && resumeFrom > 0) {
          res.resume();
          req.setTimeout(0);
          fs.rmSync(tempPath, { force: true });
          resumeFrom = 0;
          return fetchWithRedirects(url, maxRedirects);
        }

        if (res.statusCode !== 200 && res.statusCode !== 206) {
          log.fail("engine.models", "download refused by server", null, { file: safeName, status: res.statusCode, host: hostOf(currentUrl) });
          return fail(new Error(`Server returned HTTP ${res.statusCode}`));
        }

        // A server that ignores Range answers 200 with the whole file; what was kept no longer counts.
        const resumed = res.statusCode === 206 && resumeFrom > 0;
        const offset = resumed ? resumeFrom : 0;
        const range = /bytes\s+\d+-\d+\/(\d+)/i.exec(String(res.headers["content-range"] || ""));
        const length = Number(res.headers["content-length"]) || 0;
        const total = resumed ? Number(range?.[1]) || (length ? offset + length : 0) : length;
        let completed = offset;
        let lastSampleTime = Date.now();
        let lastSampleBytes = completed;
        let smoothedSpeed = 0;
        const fileStream = fs.createWriteStream(tempPath, { flags: resumed ? "a" : "w" });
        entry.fileStream = fileStream;
        // Destroying the request mid-body errors the response, which nothing else listens for.
        res.on("error", () => {});
        log.info("engine.models", "download connected", { file: safeName, status: res.statusCode, bytes: total, resumed, from: offset });

        res.on("data", (chunk) => {
          completed += chunk.length;
          const percent = total > 0 ? Number(((completed / total) * 100).toFixed(1)) : 0;
          const now = Date.now();
          if (percent >= lastLoggedPercent + 10 || percent === 100) {
            lastLoggedPercent = Math.floor(percent);
            log.debug("engine.models", "download progress", { file: safeName, percent, completed, total });
          }
          if (now - lastSampleTime >= 500) {
            const sampleSpeed = ((completed - lastSampleBytes) * 1000) / (now - lastSampleTime);
            // The first sample seeds the average, so the estimate never starts from zero.
            smoothedSpeed = smoothedSpeed > 0 ? 0.7 * smoothedSpeed + 0.3 * sampleSpeed : sampleSpeed;
            lastSampleTime = now;
            lastSampleBytes = completed;
          }
          if (now - lastEmittedTime >= 100 || percent === 100) {
            lastEmittedTime = now;
            let remainingSeconds = null;
            if (total > 0 && completed >= total) remainingSeconds = 0;
            else if (total > completed && smoothedSpeed > 0) {
              remainingSeconds = Math.max(0, Math.round((total - completed) / smoothedSpeed));
            }
            emit({ phase: "downloading", completed, total, percent, remainingSeconds });
          }
        });

        // A connection cut short ends the response without 'end', so the file stream would wait forever.
        res.on("close", () => {
          if (!res.complete) transient(req, new Error("The connection closed before the download finished"));
        });

        res.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close(() => {
            if (entry.cancelled || entry.req !== req) return;
            if (total > 0 && completed !== total) {
              // Short of the length the server promised: keep it to continue. Past it, it is not this file.
              if (completed < total) return transient(req, new Error(`Received ${completed} of ${total} bytes`));
              fs.rmSync(tempPath, { force: true });
              return fail(new Error("The file is larger than the server said"));
            }
            activeDownloads.delete(key);
            try {
              if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
              fs.renameSync(tempPath, destPath);
              // The single-file path has no published hash to compare against, so there is nothing to verify.
              log.info("engine.models", "no published checksum", { file: safeName });
              const durMs = Date.now() - startedAt;
              log.info("engine.models", "download finished", {
                cid,
                file: safeName,
                bytes: completed,
                resumedFrom: startBytes,
                durMs,
                avgBytesPerSec: Math.round(((completed - startBytes) * 1000) / Math.max(durMs, 1)),
              });
              emit({ phase: "done", completed, total: total || completed, percent: 100, remainingSeconds: 0 });
              resolve({ success: true, path: destPath, filename: safeName });
            } catch (err) {
              log.fail("engine.models", "download finalize failed", err, { file: safeName });
              reject(err);
            }
          });
        });

        fileStream.on("error", (err) => {
          activeDownloads.delete(key);
          // A chunk still in flight writes into the stream a cancel just destroyed; that is the cancel, not a failure.
          if (entry.cancelled) return reject(abortError());
          // The same for a stall or drop: transient() closed this stream and owns the outcome from there.
          if (entry.req !== req) return;
          log.fail("engine.models", "download write failed", err, { file: safeName });
          reject(err);
        });
      });

      entry.req = req;
      req.setTimeout(stallMs, () => req.destroy(new Error(`The download stalled: no data for ${Math.round(stallMs / 1000)} seconds`)));

      req.on("error", (err) => {
        if (entry.req !== req) return;
        if (entry.cancelled) {
          activeDownloads.delete(key);
          return reject(abortError());
        }
        transient(req, err);
      });
    }

    emit({ phase: "preparing", completed: 0, total: 0, percent: 0 });
    fetchWithRedirects(url, maxRedirects);
  });

  entry.promise = promise;
  activeDownloads.set(key, entry);
  return promise;
}

/** A download whose cancel comes back as a result: rejecting an IPC call prints an error for what the user asked for. */
async function downloadGgufModelForIpc(options) {
  try {
    return await downloadGgufModel(options);
  } catch (error) {
    if (error?.name === "AbortError") return { success: false, cancelled: true };
    throw error;
  }
}

/** Stops an in-flight download and removes every file it left behind. */
async function cancelDownloadGgufModel(modelsDir, filename, keepExtension = false) {
  const safeName = safeGgufName(filename, keepExtension);
  const destPath = path.join(modelsDir, safeName);
  const tempPath = `${destPath}.download`;
  const key = `${modelsDir}:${safeName}`;
  const active = activeDownloads.get(key);
  log.info("engine.models", "download cancel requested", { file: safeName, active: Boolean(active) });

  if (active) {
    active.cancelled = true;
    activeDownloads.delete(key);
    active.req?.destroy();
    await closeStream(active.fileStream);
    active.reject?.(abortError());
  }

  // An installed model is only removed when a download was replacing it, never on a stray cancel.
  for (const file of active ? [tempPath, destPath] : [tempPath]) {
    try {
      fs.unlinkSync(file);
    } catch (err) {
      if (err.code !== "ENOENT") log.warn("engine.models", "partial file not removed", { file: path.basename(file), code: err.code });
    }
  }
  return { success: true };
}

module.exports = {
  listGgufModels,
  deleteGgufModel,
  downloadGgufModel,
  downloadGgufModelForIpc,
  cancelDownloadGgufModel,
};
