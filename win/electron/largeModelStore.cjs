"use strict";

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const crypto = require("node:crypto");
const binaryManager = require("./binaryManager.cjs");
const { log } = require("./logger.cjs");

const PARTIAL_MARKER = ".draggy-partial";
const MIRRORS_FILE = "large-model-mirrors.json";
const SPACE_MARGIN = 1.1;
const DEFAULT_CONCURRENCY = 4;

/** A Hugging Face `tree?recursive=true` answer as the files to fetch: path, size, and the LFS hash when there is one. */
function parseManifest(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry) => entry?.type === "file" && typeof entry.path === "string" && !entry.path.split("/").includes(".."))
    .map((entry) => ({
      path: entry.path,
      size: Number(entry.lfs?.size ?? entry.size) || 0,
      sha256: /^[0-9a-f]{64}$/i.test(entry.lfs?.oid || "") ? entry.lfs.oid.toLowerCase() : null,
    }));
}

const REPO_ID = /^\w[\w.-]*\/\w[\w.-]*$/;

/** Every file of a repository from the Hugging Face tree API, following its Link-header pages. */
async function fetchManifest(repo, { fetchImpl = fetch, maxPages = 50 } = {}) {
  if (!REPO_ID.test(repo)) throw new Error("Invalid repository id");
  let url = `https://huggingface.co/api/models/${repo}/tree/main?recursive=true`;
  const entries = [];
  for (let page = 0; url && page < maxPages; page += 1) {
    const res = await fetchImpl(url, { headers: { "User-Agent": "Draggy" } });
    if (!res.ok) throw new Error(`Hugging Face returned HTTP ${res.status}`);
    entries.push(...(await res.json()));
    const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") || "");
    url = next ? next[1] : null;
  }
  return parseManifest(entries);
}

function totalBytes(files) {
  return files.reduce((sum, file) => sum + file.size, 0);
}

/**
 * Where the model may go: never a USB or unknown drive, and only where size plus 10% is free. Picks
 * the faster drive, falling back to the one with the most room.
 */
function chooseVolume(files, drives) {
  const need = Math.round(totalBytes(files) * SPACE_MARGIN);
  const internal = drives.filter((drive) => drive.role !== "refuse" && drive.bus !== "usb");
  if (!internal.length) return { ok: false, reason: "usb-drive" };
  const fits = internal.filter((drive) => drive.freeBytes >= need);
  if (!fits.length) return { ok: false, reason: "no-space", needBytes: Math.ceil(need) };
  fits.sort((a, b) => (b.benchmark?.expertMBps || 0) - (a.benchmark?.expertMBps || 0) || b.freeBytes - a.freeBytes);
  return { ok: true, volume: fits[0].volume, needBytes: Math.ceil(need) };
}

/** Bytes of these files already in `dir`, whole or partial, never more than each file's size. */
function onDiskBytes(dir, files) {
  let have = 0;
  for (const file of files) {
    const target = path.join(dir, ...file.path.split("/"));
    for (const candidate of [target, `${target}.partial`]) {
      try {
        const size = fs.statSync(candidate).size;
        if (!file.size || size <= file.size) {
          have += size;
          break;
        }
      } catch (error) {
        log.swallow("engine", error, "not there");
      }
    }
  }
  return have;
}

/**
 * Where a download goes. A copy already started stays on its drive and needs room for only what is
 * missing; otherwise the best drive for the whole of it, as chooseVolume picks.
 */
function planTarget(repo, files, drives) {
  const usable = drives.filter((drive) => drive.role !== "refuse" && drive.bus !== "usb");
  const existing = locate(repo, usable.map((drive) => drive.volume));
  if (existing) {
    const drive = usable.find((candidate) => defaultDir(candidate.volume, repo) === existing.dir);
    const need = Math.round(Math.max(0, totalBytes(files) - onDiskBytes(existing.dir, files)) * SPACE_MARGIN);
    if (drive && drive.freeBytes >= need) return { ok: true, volume: drive.volume, needBytes: need, resume: true };
  }
  return chooseVolume(files, drives);
}

function freeBytesOf(dir) {
  try {
    const stats = fs.statfsSync(dir);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch (error) {
    log.swallow("engine", error, "free space is informational only");
    return null;
  }
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/** GET with an optional Range, following https redirects under the app's outbound policy. */
function fetchRange(url, { start = 0, headers = {} } = {}, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    if (!url.startsWith("https:") || !binaryManager.validateDownloadUrl(url)) return reject(new Error("URL refused by outbound security policy"));
    const request = { "User-Agent": "Draggy", ...headers };
    if (start > 0) request.Range = `bytes=${start}-`;
    https
      .get(url, { headers: request }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error("Too many redirects"));
          return resolve(fetchRange(new URL(res.headers.location, url).href, { start, headers }, redirectsLeft - 1));
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume();
          return reject(Object.assign(new Error(`Server returned HTTP ${res.statusCode}`), { status: res.statusCode }));
        }
        resolve({ status: res.statusCode, stream: res });
      })
      .on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Downloads one file to `<file>.partial`, resuming from what is already there, then verifies it and
 * renames it into place. A hash mismatch throws away only this file, and it is fetched once more.
 */
async function downloadFile({ url, target, file, fetcher, signal, onBytes, throttle, retries = 1 }) {
  const partial = `${target}.partial`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  for (let attempt = 0; ; attempt += 1) {
    let have = fs.existsSync(partial) ? fs.statSync(partial).size : 0;
    if (file.size && have > file.size) {
      fs.rmSync(partial, { force: true });
      have = 0;
    }
    if (!file.size || have < file.size) {
      const { status, stream } = await fetcher(url, { start: have });
      // A server that ignores Range sends everything again; start the file over.
      if (have > 0 && status === 200) {
        log.warn("engine.models", "range ignored, file restarted", { file: file.path, from: have });
        fs.rmSync(partial, { force: true });
        onBytes(-have);
        have = 0;
      } else if (have > 0) {
        log.info("engine.models", "file resumed", { file: file.path, from: have, bytes: file.size });
      }
      const out = fs.createWriteStream(partial, { flags: have > 0 ? "a" : "w" });
      try {
        for await (const chunk of stream) {
          if (signal?.aborted) throw Object.assign(new Error("cancelled"), { code: "ABORT" });
          if (!out.write(chunk)) await new Promise((resolve) => out.once("drain", resolve));
          onBytes(chunk.length);
          if (throttle) await throttle(chunk.length);
        }
      } finally {
        await new Promise((resolve) => out.end(resolve));
      }
    }
    if (file.size && fs.statSync(partial).size !== file.size) throw new Error(`${file.path}: incomplete download`);
    if (file.sha256) {
      if ((await sha256File(partial)) !== file.sha256) {
        log.warn("engine.models", "checksum mismatch", { file: file.path, attempt: attempt + 1, bytes: file.size });
        fs.rmSync(partial, { force: true });
        onBytes(-file.size);
        if (attempt >= retries) throw new Error(`Checksum mismatch for ${file.path}`);
        continue;
      }
      log.info("engine.models", "checksum matched", { file: file.path, bytes: file.size });
    }
    fs.renameSync(partial, target);
    return;
  }
}

/** A bytes-per-second ceiling shared by every stream; 0 means unlimited. */
function createThrottle(bytesPerSecond, now = Date.now, wait = sleep) {
  if (!bytesPerSecond) return null;
  let windowStart = now();
  let used = 0;
  return async (bytes) => {
    used += bytes;
    const elapsed = now() - windowStart;
    const allowed = (bytesPerSecond * elapsed) / 1000;
    if (used > allowed) await wait(((used - allowed) / bytesPerSecond) * 1000);
    if (elapsed > 5000) {
      windowStart = now();
      used = 0;
    }
  };
}

/**
 * Downloads every file of a repository into `destDir`. Files already complete are skipped, partial
 * ones resume, and a marker file stays until the last file is in place so a half-finished folder is
 * never mistaken for a model.
 */
async function downloadRepo({ repo, files, destDir, resolveUrl, fetcher = fetchRange, concurrency = DEFAULT_CONCURRENCY, bandwidthBps = 0, onProgress = () => {}, signal, now = Date.now }) {
  fs.mkdirSync(destDir, { recursive: true });
  const marker = path.join(destDir, PARTIAL_MARKER);
  fs.writeFileSync(marker, JSON.stringify({ repo, startedAt: now() }));

  const total = totalBytes(files);
  // `done` is everything on disk; `moved` only what this run fetched, so a resumed download's speed
  // and time left are not inflated by the gigabytes it already had.
  let done = 0;
  let moved = 0;
  const started = now();
  const throttle = createThrottle(bandwidthBps);
  let lastDecile = -1;
  const report = (current) => {
    const seconds = Math.max(0.001, (now() - started) / 1000);
    const rate = Math.max(0, moved) / seconds;
    const decile = total > 0 ? Math.floor((done / total) * 10) : -1;
    if (decile > lastDecile) {
      lastDecile = decile;
      log.debug("engine.models", "repo download progress", { repo, percent: decile * 10, doneBytes: done, totalBytes: total, bytesPerSecond: Math.round(rate) });
    }
    onProgress({ repo, doneBytes: done, totalBytes: total, bytesPerSecond: Math.round(rate), etaSeconds: rate > 0 ? Math.round((total - done) / rate) : null, file: current });
  };

  const queue = [];
  for (const file of files) {
    const target = path.join(destDir, ...file.path.split("/"));
    if (file.size && fs.existsSync(target) && fs.statSync(target).size === file.size) {
      done += file.size;
      continue;
    }
    queue.push({ file, target });
  }
  log.info("engine.models", "repo download started", {
    repo,
    files: files.length,
    queued: queue.length,
    totalBytes: total,
    resumedBytes: done,
    drive: path.parse(destDir).root.replace(/[\\/]+$/, "") || null,
    freeBytes: freeBytesOf(destDir),
  });
  report(null);

  async function worker() {
    while (queue.length) {
      if (signal?.aborted) return;
      const { file, target } = queue.shift();
      let base = fs.existsSync(`${target}.partial`) ? fs.statSync(`${target}.partial`).size : 0;
      // A partial longer than the file is thrown away by downloadFile, so none of it counts.
      if (file.size && base > file.size) base = 0;
      done += base;
      await downloadFile({
        url: resolveUrl(file),
        target,
        file,
        fetcher,
        signal,
        throttle,
        onBytes: (bytes) => {
          done += bytes;
          moved += bytes;
          report(file.path);
        },
      });
    }
  }

  const results = await Promise.allSettled(Array.from({ length: Math.min(concurrency, queue.length || 1) }, worker));
  const failed = results.find((result) => result.status === "rejected");
  const durMs = now() - started;
  if (signal?.aborted) {
    log.info("engine.models", "repo download cancelled", { repo, doneBytes: done, durMs });
    return { ok: false, error: "cancelled", doneBytes: done };
  }
  if (failed) {
    const reason = failed.reason?.message || String(failed.reason);
    log.fail("engine.models", "repo download failed", null, { repo, reason, doneBytes: done, durMs });
    return { ok: false, error: reason, doneBytes: done };
  }
  fs.rmSync(marker, { force: true });
  log.info("engine.models", "repo download finished", { repo, doneBytes: done, movedBytes: moved, durMs, avgBytesPerSec: Math.round((moved * 1000) / Math.max(durMs, 1)) });
  return { ok: true, doneBytes: done, destDir };
}

/** Where a repository goes on a volume. */
function defaultDir(volume, repo) {
  return path.join(volume, "Draggy", "models", repo.replace("/", "--"));
}

/** The copy of `repo` on one of `volumes`: its folder and whether the download finished. */
function locate(repo, volumes) {
  for (const volume of volumes) {
    const dir = defaultDir(volume, repo);
    if (fs.existsSync(dir)) return { dir, complete: isComplete(dir) };
  }
  return null;
}

/** A folder with the marker is a download that has not finished. */
function isComplete(dir) {
  return fs.existsSync(dir) && !fs.existsSync(path.join(dir, PARTIAL_MARKER));
}

/** Mirror copies per model, kept in the user data folder: colibri reads them from COLI_MODEL_MIRROR. */
function createMirrorStore(userDataDir) {
  const file = path.join(userDataDir, MIRRORS_FILE);
  const read = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };
  return {
    get: (modelId) => (Array.isArray(read()[modelId]) ? read()[modelId] : []),
    set(modelId, paths) {
      const all = read();
      const clean = [...new Set((paths || []).filter((p) => typeof p === "string" && p))];
      if (clean.length) all[modelId] = clean;
      else delete all[modelId];
      fs.mkdirSync(userDataDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(all, null, 2));
      return clean;
    },
  };
}

/** The download address of one file of a Hugging Face repository. */
function hfUrl(repo, file) {
  return `https://huggingface.co/${repo}/resolve/main/${file.path.split("/").map(encodeURIComponent).join("/")}?download=true`;
}

module.exports = { fetchManifest, parseManifest, totalBytes, chooseVolume, planTarget, onDiskBytes, downloadRepo, downloadFile, createThrottle, createMirrorStore, isComplete, defaultDir, locate, hfUrl, fetchRange, sha256File, PARTIAL_MARKER };
