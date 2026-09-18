const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const http = require("node:http");
const urlPolicy = require("./urlPolicy.cjs");
const ggufParser = require("./ggufParser.cjs");

/** Scans directory for GGUF files and reads metadata headers. */
function listGgufModels(modelsDir) {
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
      });
    } catch {
      // Skipped if unreadable.
    }
  }

  return models;
}

/** Deletes a GGUF model file from disk. */
function deleteGgufModel(modelsDir, filename) {
  const safeName = path.basename(filename);
  const target = path.join(modelsDir, safeName);
  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
    return true;
  }
  return false;
}

/** Streams download of GGUF model from validated URL with progress tracking. */
function downloadGgufModel({ url, modelsDir, filename, onProgress, maxRedirects = 5 }) {
  if (!urlPolicy.isFetchableUrl(url, { allowPrivate: false })) {
    return Promise.reject(new Error("URL refused by outbound security policy"));
  }

  fs.mkdirSync(modelsDir, { recursive: true });
  const safeName = path.basename(filename).endsWith(".gguf") ? path.basename(filename) : `${path.basename(filename)}.gguf`;
  const destPath = path.join(modelsDir, safeName);
  const tempPath = `${destPath}.download`;

  return new Promise((resolve, reject) => {
    function fetchWithRedirects(currentUrl, redirectsLeft) {
      if (redirectsLeft < 0) {
        return reject(new Error("Too many redirects"));
      }

      const parsed = new URL(currentUrl);
      const client = parsed.protocol === "https:" ? https : http;

      const req = client.get(currentUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, currentUrl).href;
          if (!urlPolicy.isFetchableUrl(next, { allowPrivate: false })) {
            return reject(new Error("Redirect URL refused by security policy"));
          }
          return fetchWithRedirects(next, redirectsLeft - 1);
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`Server returned HTTP ${res.statusCode}`));
        }

        const total = Number(res.headers["content-length"]) || 0;
        let completed = 0;
        const fileStream = fs.createWriteStream(tempPath);

        res.on("data", (chunk) => {
          completed += chunk.length;
          const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
          if (onProgress) {
            onProgress({ phase: "downloading", completed, total, percent });
          }
        });

        res.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close(() => {
            try {
              if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
              fs.renameSync(tempPath, destPath);
              if (onProgress) {
                onProgress({ phase: "done", completed: total, total, percent: 100 });
              }
              resolve({ success: true, path: destPath, filename: safeName });
            } catch (err) {
              reject(err);
            }
          });
        });

        fileStream.on("error", (err) => {
          try {
            fs.unlinkSync(tempPath);
          } catch {
            // Ignored
          }
          reject(err);
        });
      });

      req.on("error", (err) => {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // Ignored
        }
        reject(err);
      });
    }

    if (onProgress) {
      onProgress({ phase: "preparing", completed: 0, total: 0, percent: 0 });
    }

    fetchWithRedirects(url, maxRedirects);
  });
}

module.exports = {
  listGgufModels,
  deleteGgufModel,
  downloadGgufModel,
};
