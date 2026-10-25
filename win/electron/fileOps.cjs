const fs = require("fs");
const path = require("path");
const fsGuard = require("./fsGuard.cjs");
const { log } = require("./logger.cjs");

/** The file tools, with roots, checkpoints and trash handed in, so the code that could lose
 * someone's work is testable without Electron. */

/** Generated, vendored or someone else's. A search walks past all of these. */
const SKIPPED_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "dist-electron",
  "build",
  "out",
  ".next",
  ".nuxt",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".cache",
  "coverage",
]);

const MAX_LIST_ENTRIES = 500;
const MAX_SEARCH_FILES = 4000;
const MAX_SEARCH_HITS = 50;
const MAX_SEARCHED_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** Audio and video the file pane plays. The CSP lets media load from data: URLs. */
const MEDIA_MIME_TYPES = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
};

const IMAGE_MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".jfif": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".cur": "image/x-icon",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".apng": "image/apng",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
};

function failed(error) {
  return { success: false, error };
}

function describeEntry(dirPath, entry) {
  const full = path.join(dirPath, entry.name);

  let size = 0;
  let modified = 0;

  try {
    const stats = fs.statSync(full);
    size = stats.size;
    modified = stats.mtimeMs;
  } catch (error) {
    log.swallow("files", error, "a file that vanished between the listing and the stat is still worth naming; the model finds out when it tries to open it");
  }

  return {
    name: entry.name,
    path: full,
    isDirectory: entry.isDirectory(),
    size,
    modified,
  };
}

/** deps: roots a workspace may reach, checkpoint rows in storage, the checkpoint byte store, and a
 * recoverable trash. */
function create({ roots, storage, checkpoints, trash }) {
  const resolve = (workspaceId, requested, options) =>
    fsGuard.resolveWithin(roots(workspaceId), requested, options);

  /** A checkpoint row and its INFO line: a count and bytes, never the file names. */
  function recordCheckpoint(entry, bytes = 0) {
    const row = storage.addCheckpoint(entry);
    log.info("files", "checkpoint created", { files: 1, bytes });
    return row;
  }

  /** Undo: the row goes once its file is back as it was. */
  function restoreCheckpoint(entry) {
    storage.dropCheckpoint(entry.id);
    log.info("files", "checkpoint restored", { files: 1 });
  }

  function list(workspaceId, requested) {
    const resolved = resolve(workspaceId, requested || ".", { mustExist: true });
    if (!resolved.ok) return failed(resolved.error);

    if (!fs.statSync(resolved.path).isDirectory()) {
      return failed("That is a file, not a folder.");
    }

    const entries = fs
      .readdirSync(resolved.path, { withFileTypes: true })
      .map((entry) => describeEntry(resolved.path, entry))
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    return {
      success: true,
      path: resolved.path,
      entries: entries.slice(0, MAX_LIST_ENTRIES),
      truncated: entries.length > MAX_LIST_ENTRIES,
    };
  }

  function read(workspaceId, requested) {
    const resolved = resolve(workspaceId, requested, { mustExist: true });
    if (!resolved.ok) return failed(resolved.error);

    const ext = path.extname(resolved.path).toLowerCase();
    const isMedia = Boolean(MEDIA_MIME_TYPES[ext]);
    const mime = IMAGE_MIME_TYPES[ext] || MEDIA_MIME_TYPES[ext];

    if (mime) {
      const stats = fs.statSync(resolved.path);
      if (stats.isDirectory()) return failed("That is a folder, not a file.");
      if (stats.size > MAX_IMAGE_BYTES) {
        return failed(
          `That ${isMedia ? "file" : "image"} is ${Math.round(stats.size / (1024 * 1024))} MB, over the 20 MB limit.`,
        );
      }

      const buffer = fs.readFileSync(resolved.path);
      return {
        success: true,
        path: resolved.path,
        isImage: !isMedia,
        isMedia,
        mime,
        dataUrl: `data:${mime};base64,${buffer.toString("base64")}`,
        text: ext === ".svg" ? buffer.toString("utf8") : "",
        bytes: stats.size,
      };
    }

    const text = fsGuard.readText(resolved.path);
    if (!text.ok) return failed(text.error);

    return {
      success: true,
      path: resolved.path,
      text: text.text,
      bytes: text.bytes,
    };
  }

  function write(workspaceId, requested, contents, chatId) {
    const resolved = resolve(workspaceId, requested, { createParents: true });
    if (!resolved.ok) return failed(resolved.error);

    const raw = String(contents ?? "");
    const match = raw.match(/^data:([^;]+);base64,(.+)$/);
    const dataToWrite = match ? Buffer.from(match[2], "base64") : raw;
    const before = checkpoints.snapshot(resolved.path);
    // Old and new text, when both are text, so the step can show what changed.
    const oldText = before === null ? { ok: true, text: "" } : fsGuard.readText(resolved.path);
    const diff = !match && oldText.ok ? { before: oldText.text, after: raw } : {};

    fs.mkdirSync(path.dirname(resolved.path), { recursive: true });
    fs.writeFileSync(resolved.path, dataToWrite);

    const { id } = recordCheckpoint({
      workspaceId,
      chatId,
      path: resolved.path,
      action: "write",
      beforeHash: before,
      afterHash: checkpoints.keep(dataToWrite),
    }, Buffer.byteLength(dataToWrite));

    return {
      success: true,
      path: resolved.path,
      checkpointId: id,
      created: before === null,
      bytes: Buffer.byteLength(dataToWrite),
      ...diff,
    };
  }

  function edit(workspaceId, requested, find, replace, expected, chatId) {
    const resolved = resolve(workspaceId, requested, { mustExist: true });
    if (!resolved.ok) return failed(resolved.error);

    const current = fsGuard.readText(resolved.path);
    if (!current.ok) return failed(current.error);

    const needle = String(find ?? "");
    if (!needle) return failed("Nothing was given to replace.");

    const wanted = Number(expected) || 1;
    let parts = current.text.split(needle);
    let occurrences = parts.length - 1;
    let next;

    if (occurrences === wanted) {
      next = parts.join(String(replace ?? ""));
    } else if (occurrences === 0) {
      const hasCrlf = current.text.includes("\r\n");
      const normText = current.text.replace(/\r\n/g, "\n");
      const normNeedle = needle.replace(/\r\n/g, "\n");
      const normReplace = String(replace ?? "").replace(/\r\n/g, "\n");

      const normParts = normText.split(normNeedle);
      const normOccurrences = normParts.length - 1;

      if (normOccurrences === wanted) {
        const joined = normParts.join(normReplace);
        next = hasCrlf ? joined.replace(/\n/g, "\r\n") : joined;
        occurrences = normOccurrences;
      } else if (normOccurrences === 0) {
        const fileLines = normText.split("\n");
        const needleLines = normNeedle.split("\n");
        const trimmedNeedle = needleLines.map((l) => l.trimEnd());

        let matches = [];
        if (needleLines.length > 0 && fileLines.length >= needleLines.length) {
          for (let i = 0; i <= fileLines.length - needleLines.length; i++) {
            let lineMatch = true;
            for (let j = 0; j < needleLines.length; j++) {
              if (fileLines[i + j].trimEnd() !== trimmedNeedle[j]) {
                lineMatch = false;
                break;
              }
            }
            if (lineMatch) matches.push(i);
          }
        }

        if (matches.length === 0 && trimmedNeedle.some((l) => l.trim().length > 0)) {
          const fullyTrimmedNeedle = needleLines.map((l) => l.trim());
          if (needleLines.length > 0 && fileLines.length >= needleLines.length) {
            for (let i = 0; i <= fileLines.length - needleLines.length; i++) {
              let lineMatch = true;
              for (let j = 0; j < needleLines.length; j++) {
                if (fileLines[i + j].trim() !== fullyTrimmedNeedle[j]) {
                  lineMatch = false;
                  break;
                }
              }
              if (lineMatch) matches.push(i);
            }
          }
        }

        if (matches.length === wanted) {
          const replaceLines = normReplace.split("\n");
          for (let m = matches.length - 1; m >= 0; m--) {
            fileLines.splice(matches[m], needleLines.length, ...replaceLines);
          }
          const joined = fileLines.join("\n");
          next = hasCrlf ? joined.replace(/\n/g, "\r\n") : joined;
          occurrences = matches.length;
        } else if (matches.length > 0) {
          occurrences = matches.length;
        }
      } else {
        occurrences = normOccurrences;
      }
    }

    if (occurrences === 0) {
      return failed(
        "That text is not in the file. Read it again and copy the lines exactly, whitespace included.",
      );
    }

    if (occurrences !== wanted) {
      return failed(
        `That text appears ${occurrences} times, not ${wanted}. Include more of the surrounding lines so it matches once, or say how many to replace.`,
      );
    }

    const beforeHash = checkpoints.keep(current.text);

    fs.writeFileSync(resolved.path, next, "utf8");

    const { id } = recordCheckpoint({
      workspaceId,
      chatId,
      path: resolved.path,
      action: "write",
      beforeHash,
      afterHash: checkpoints.keep(next),
    }, Buffer.byteLength(next));

    return {
      success: true,
      path: resolved.path,
      checkpointId: id,
      replaced: occurrences,
      before: current.text,
      after: next,
      bytes: Buffer.byteLength(next),
    };
  }

  function move(workspaceId, from, to, chatId) {
    const source = resolve(workspaceId, from, { mustExist: true });
    if (!source.ok) return failed(source.error);

    const target = resolve(workspaceId, to, { createParents: true });
    if (!target.ok) return failed(target.error);

    if (fs.existsSync(target.path)) return failed("Something is already there.");

    fs.mkdirSync(path.dirname(target.path), { recursive: true });
    fs.renameSync(source.path, target.path);

    const { id } = recordCheckpoint({
      workspaceId,
      chatId,
      path: target.path,
      action: "move",
      detail: source.path,
    });

    return {
      success: true,
      path: target.path,
      from: source.path,
      checkpointId: id,
    };
  }

  async function remove(workspaceId, requested, chatId) {
    const resolved = resolve(workspaceId, requested, { mustExist: true });
    if (!resolved.ok) return failed(resolved.error);

    if (fs.statSync(resolved.path).isDirectory()) {
      return failed("Draggy does not delete folders. Name the files instead.");
    }

    const before = checkpoints.snapshot(resolved.path);

    // Into the recycle bin rather than gone, the same as the files Draggy
    // makes: a model that misread an instruction should not be final.
    await trash(resolved.path);

    const { id } = recordCheckpoint({
      workspaceId,
      chatId,
      path: resolved.path,
      action: "delete",
      beforeHash: before,
    });

    return { success: true, path: resolved.path, checkpointId: id };
  }

  function search(workspaceId, query) {
    const folders = roots(workspaceId);
    if (folders.length === 0) {
      return failed(
        "This conversation has no folder to search. Open a project first.",
      );
    }

    const namePart = String(query?.name || "").toLowerCase();
    const textPart = String(query?.text || "");

    if (!namePart && !textPart) {
      return failed("Give a file name or some text to look for.");
    }

    const limit = Math.min(Number(query?.limit) || MAX_SEARCH_HITS, MAX_SEARCH_HITS);
    const hits = [];
    let visited = 0;

    const walk = (dir) => {
      if (hits.length >= limit || visited >= MAX_SEARCH_FILES) return;

      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (hits.length >= limit || visited >= MAX_SEARCH_FILES) return;

        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!SKIPPED_DIRS.has(entry.name) && !fsGuard.isDeniedName(entry.name)) {
            walk(full);
          }
          continue;
        }

        if (!entry.isFile()) continue;

        // The same rule a named path gets: a search must not be a way to read
        // what resolveWithin would have refused.
        if (!fsGuard.isReadable(full)) continue;

        visited++;

        if (namePart && !entry.name.toLowerCase().includes(namePart)) continue;

        if (!textPart) {
          hits.push({ path: full, name: entry.name });
          continue;
        }

        const contents = fsGuard.readText(full, MAX_SEARCHED_BYTES);
        if (!contents.ok) continue;

        const lines = contents.text.split("\n");
        for (let i = 0; i < lines.length && hits.length < limit; i++) {
          if (!lines[i].includes(textPart)) continue;
          hits.push({
            path: full,
            name: entry.name,
            line: i + 1,
            text: lines[i].trim().slice(0, 300),
          });
        }
      }
    };

    for (const folder of folders) walk(folder);

    return { success: true, hits, truncated: visited >= MAX_SEARCH_FILES };
  }

  /** Undoing one change. The path goes back through the guard on the way: the row may be old, and
   * the folder it names may not be in scope any more. */
  async function revert(id) {
    const entry = storage.getCheckpoint(id);
    if (!entry) return failed("There is no such change to undo.");

    if (entry.action === "move") {
      const current = resolve(entry.workspaceId, entry.path, { mustExist: true });
      if (!current.ok) return failed(current.error);

      const back = resolve(entry.workspaceId, entry.detail, {
        createParents: true,
      });
      if (!back.ok) return failed(back.error);

      fs.mkdirSync(path.dirname(back.path), { recursive: true });
      fs.renameSync(current.path, back.path);
      restoreCheckpoint(entry);

      return {
        success: true,
        path: back.path,
        from: current.path,
        workspaceId: entry.workspaceId,
      };
    }

    const resolved = resolve(entry.workspaceId, entry.path, {
      createParents: true,
    });
    if (!resolved.ok) return failed(resolved.error);

    if (entry.beforeHash) {
      const previous = checkpoints.read(entry.beforeHash);
      if (previous === null) {
        return failed("The earlier version is no longer stored.");
      }

      fs.mkdirSync(path.dirname(resolved.path), { recursive: true });
      fs.writeFileSync(resolved.path, previous);
    } else if (fs.existsSync(resolved.path)) {
      // Nothing was there before, so undoing means taking it away again.
      await trash(resolved.path);
    }

    restoreCheckpoint(entry);

    return { success: true, path: resolved.path, workspaceId: entry.workspaceId };
  }

  /** The full path of an existing file or folder in the workspace, for handing to the system shell. */
  function locate(workspaceId, requested) {
    const resolved = resolve(workspaceId, requested, { mustExist: true });
    return resolved.ok ? { success: true, path: resolved.path } : failed(resolved.error);
  }

  /** The path relative to its workspace folder where one holds it, else just the basename. */
  function shownPath(workspaceId, full) {
    if (!full) return null;
    const folder = roots(workspaceId).find((root) => full === root || full.startsWith(root + path.sep));
    return folder ? path.relative(folder, full) || "." : path.basename(String(full));
  }

  /** The workspace-relative path of what was asked for, resolved the way the operation would resolve it,
   * so a refused or failed call still names the file. Only a path outside every folder falls back to its basename. */
  function relativeTo(workspaceId, requested) {
    if (!requested) return null;
    const resolved = resolve(workspaceId, requested, { createParents: true });
    return resolved.ok ? shownPath(workspaceId, resolved.path) : path.basename(String(requested));
  }

  /** One line per operation: what, where, how many bytes or hits, and the outcome. */
  function logOutcome(op, workspaceId, requested, result) {
    const data = { op, path: result?.path ? shownPath(workspaceId, result.path) : relativeTo(workspaceId, requested) };
    if (result?.bytes !== undefined) data.bytes = result.bytes;
    if (result?.hits) data.hits = result.hits.length;
    if (result?.success) log.info("files", "file op done", { ...data, outcome: "ok" });
    else log.warn("files", "file op refused", { ...data, outcome: "refused" });
    return result;
  }

  /** Wraps an operation so every call logs its outcome, and an exception logs before it propagates. */
  function observe(op, fn) {
    return (...args) => {
      const workspaceId = op === "revert" ? null : args[0];
      const requested = op === "search" || op === "revert" ? null : op === "list" ? args[1] || "." : args[1];
      const onError = (error) => {
        log.fail("files", "file op failed", error, { op, path: relativeTo(workspaceId, requested) });
        throw error;
      };
      let result;
      try {
        result = fn(...args);
      } catch (error) {
        return onError(error);
      }
      if (result && typeof result.then === "function") {
        return result.then((value) => logOutcome(op, workspaceId ?? value?.workspaceId, requested, value), onError);
      }
      return logOutcome(op, workspaceId, requested, result);
    };
  }

  const operations = { list, read, write, edit, move, remove, search, revert, locate };
  return Object.fromEntries(Object.entries(operations).map(([op, fn]) => [op, observe(op, fn)]));
}

module.exports = { create, SKIPPED_DIRS, MAX_LIST_ENTRIES, MAX_SEARCH_HITS };
