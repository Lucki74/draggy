const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const http = require("node:http");
const urlPolicy = require("./urlPolicy.cjs");
const ggufParser = require("./ggufParser.cjs");
const { log } = require("./logger.cjs");

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
  log.debug("modelStorage", `Scanning GGUF directory: ${modelsDir}`);
  if (!fs.existsSync(modelsDir)) return [];

  const files = fs.readdirSync(modelsDir);
  const models = [];

  for (const file of files) {
    if (!file.toLowerCase().endsWith(".gguf")) continue;
    const fullPath = path.join(modelsDir, file);
    try {
      const stat = fs.statSync(fullPath);
      const header = ggufParser.parseGgufHeader(fullPath);
      models.push({
        name: file,
        filename: file,
        size: stat.size,
        path: fullPath,
        architecture: header?.architecture || "unknown",
        contextLength: header?.contextLength || null,
        blockCount: header?.blockCount || null,
        fileType: header?.fileType || null,
        capabilities: capabilitiesOf(fullPath, stat),
      });
      log.debug("modelStorage", `Found model ${file}: arch=${header?.architecture || "unknown"} size=${stat.size}`);
    } catch {
      log.warn("modelStorage", `Skipped unreadable file: ${file}`);
    }
  }

  log.info("modelStorage", `Discovered ${models.length} GGUF models in ${modelsDir}`);
  return models;
}

/** Deletes a GGUF model file from disk. */
function deleteGgufModel(modelsDir, filename) {
  const safeName = path.basename(filename);
  const target = path.join(modelsDir, safeName);
  log.info("modelStorage", `Request to delete GGUF model: ${safeName}`);
  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
    log.info("modelStorage", `Successfully deleted ${safeName}`);
    return true;
  }
  log.warn("modelStorage", `Model not found for deletion: ${safeName}`);
  return false;
}

const activeDownloads = new Map();

function safeGgufName(filename) {
  const base = path.basename(filename);
  return base.endsWith(".gguf") ? base : `${base}.gguf`;
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
function downloadGgufModel({ url, modelsDir, filename, onProgress, maxRedirects = 5 }) {
  if (!urlPolicy.isFetchableUrl(url, { allowPrivate: false })) {
    log.warn("modelStorage", `Download refused by security policy: ${url}`);
    return Promise.reject(new Error("URL refused by outbound security policy"));
  }

  fs.mkdirSync(modelsDir, { recursive: true });
  const safeName = safeGgufName(filename);
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
      } catch {
        // Ignored
      }
    }
  };

  log.info("modelStorage", `Initiating download: ${url} -> ${destPath}`);

  const promise = new Promise((resolve, reject) => {
    entry.reject = reject;
    let lastLoggedPercent = -1;
    let lastEmittedTime = 0;

    function fetchWithRedirects(currentUrl, redirectsLeft) {
      if (redirectsLeft < 0) {
        activeDownloads.delete(key);
        log.error("modelStorage", `Download failed: exceeded maximum redirects for ${url}`);
        return reject(new Error("Too many redirects"));
      }

      const parsed = new URL(currentUrl);
      const client = parsed.protocol === "https:" ? https : http;

      const req = client.get(currentUrl, (res) => {
        if (entry.cancelled) return res.destroy();
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, currentUrl).href;
          log.info("modelStorage", `Following redirect to ${next} (${redirectsLeft} remaining)`);
          if (!urlPolicy.isFetchableUrl(next, { allowPrivate: false })) {
            activeDownloads.delete(key);
            log.warn("modelStorage", `Redirect URL refused by security policy: ${next}`);
            return reject(new Error("Redirect URL refused by security policy"));
          }
          return fetchWithRedirects(next, redirectsLeft - 1);
        }

        if (res.statusCode !== 200) {
          activeDownloads.delete(key);
          log.error("modelStorage", `Server returned HTTP ${res.statusCode} for ${currentUrl}`);
          return reject(new Error(`Server returned HTTP ${res.statusCode}`));
        }

        const total = Number(res.headers["content-length"]) || 0;
        let completed = 0;
        let lastSampleTime = Date.now();
        let lastSampleBytes = 0;
        let smoothedSpeed = 0;
        const fileStream = fs.createWriteStream(tempPath);
        entry.fileStream = fileStream;
        // Destroying the request mid-body errors the response, which nothing else listens for.
        res.on("error", () => {});
        log.debug("modelStorage", `Connected: HTTP 200, length: ${total} bytes`);

        res.on("data", (chunk) => {
          completed += chunk.length;
          const percent = total > 0 ? Number(((completed / total) * 100).toFixed(1)) : 0;
          const now = Date.now();
          if (percent >= lastLoggedPercent + 10 || percent === 100) {
            lastLoggedPercent = Math.floor(percent);
            log.debug("modelStorage", `Download progress for ${safeName}: ${percent}% (${completed}/${total} bytes)`);
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

        res.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close(() => {
            if (entry.cancelled) return;
            activeDownloads.delete(key);
            try {
              if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
              fs.renameSync(tempPath, destPath);
              log.info("modelStorage", `Download completed: ${safeName} (${total} bytes) saved to ${destPath}`);
              emit({ phase: "done", completed: total, total, percent: 100, remainingSeconds: 0 });
              resolve({ success: true, path: destPath, filename: safeName });
            } catch (err) {
              log.error("modelStorage", `Failed to finalize download for ${safeName}: ${err.message}`, err);
              reject(err);
            }
          });
        });

        fileStream.on("error", (err) => {
          activeDownloads.delete(key);
          log.error("modelStorage", `File write error on ${tempPath}: ${err.message}`, err);
          try {
            fs.unlinkSync(tempPath);
          } catch {
            // Ignored
          }
          reject(err);
        });
      });

      entry.req = req;

      req.on("error", (err) => {
        activeDownloads.delete(key);
        if (entry.cancelled) return reject(abortError());
        log.error("modelStorage", `Network error downloading ${safeName}: ${err.message}`, err);
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // Ignored
        }
        reject(err);
      });
    }

    emit({ phase: "preparing", completed: 0, total: 0, percent: 0 });
    fetchWithRedirects(url, maxRedirects);
  });

  entry.promise = promise;
  activeDownloads.set(key, entry);
  return promise;
}

/** Stops an in-flight download and removes every file it left behind. */
async function cancelDownloadGgufModel(modelsDir, filename) {
  const safeName = safeGgufName(filename);
  const destPath = path.join(modelsDir, safeName);
  const tempPath = `${destPath}.download`;
  const key = `${modelsDir}:${safeName}`;
  const active = activeDownloads.get(key);
  log.info("modelStorage", `Cancel requested for ${safeName} (active=${Boolean(active)})`);

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
      if (err.code !== "ENOENT") log.warn("modelStorage", `Could not remove ${file}: ${err.message}`);
    }
  }
  return { success: true };
}

module.exports = {
  listGgufModels,
  deleteGgufModel,
  downloadGgufModel,
  cancelDownloadGgufModel,
};
