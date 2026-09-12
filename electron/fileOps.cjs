const fs = require("fs");
const path = require("path");
const fsGuard = require("./fsGuard.cjs");

/**
 * What the file tools actually do, with everything they depend on handed in:
 * where the folders are, where the old versions go, and how a file gets thrown
 * away. Kept out of main.cjs so the part that can lose someone's work can be
 * tested without an Electron window.
 */

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
  } catch {
    // A file that vanished between the listing and the stat is still worth
    // naming; the model finds out when it tries to open it.
  }

  return {
    name: entry.name,
    path: full,
    isDirectory: entry.isDirectory(),
    size,
    modified,
  };
}

/**
 * @param deps.roots      which folders a workspace may reach
 * @param deps.storage    the checkpoint rows
 * @param deps.checkpoints the store the old bytes go in
 * @param deps.trash      how a file is thrown away, recoverably
 */
function create({ roots, storage, checkpoints, trash }) {
  const resolve = (workspaceId, requested, options) =>
    fsGuard.resolveWithin(roots(workspaceId), requested, options);

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

    const text = String(contents ?? "");
    const before = checkpoints.snapshot(resolved.path);

    fs.mkdirSync(path.dirname(resolved.path), { recursive: true });
    fs.writeFileSync(resolved.path, text, "utf8");

    const { id } = storage.addCheckpoint({
      workspaceId,
      chatId,
      path: resolved.path,
      action: "write",
      beforeHash: before,
      afterHash: checkpoints.keep(text),
    });

    return {
      success: true,
      path: resolved.path,
      checkpointId: id,
      created: before === null,
    };
  }

  function edit(workspaceId, requested, find, replace, expected, chatId) {
    const resolved = resolve(workspaceId, requested, { mustExist: true });
    if (!resolved.ok) return failed(resolved.error);

    const current = fsGuard.readText(resolved.path);
    if (!current.ok) return failed(current.error);

    const needle = String(find ?? "");
    if (!needle) return failed("Nothing was given to replace.");

    const parts = current.text.split(needle);
    const occurrences = parts.length - 1;

    if (occurrences === 0) {
      return failed(
        "That text is not in the file. Read it again and copy the lines exactly, whitespace included.",
      );
    }

    const wanted = Number(expected) || 1;
    if (occurrences !== wanted) {
      return failed(
        `That text appears ${occurrences} times, not ${wanted}. Include more of the surrounding lines so it matches once, or say how many to replace.`,
      );
    }

    const next = parts.join(String(replace ?? ""));
    const beforeHash = checkpoints.keep(current.text);

    fs.writeFileSync(resolved.path, next, "utf8");

    const { id } = storage.addCheckpoint({
      workspaceId,
      chatId,
      path: resolved.path,
      action: "write",
      beforeHash,
      afterHash: checkpoints.keep(next),
    });

    return {
      success: true,
      path: resolved.path,
      checkpointId: id,
      replaced: occurrences,
      before: current.text,
      after: next,
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

    const { id } = storage.addCheckpoint({
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

    const { id } = storage.addCheckpoint({
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

  /**
   * Undoing one change. The path goes back through the guard on the way: the
   * row may be old, and the folder it names may not be in scope any more.
   */
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
      storage.dropCheckpoint(entry.id);

      return { success: true, path: back.path };
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

    storage.dropCheckpoint(entry.id);

    return { success: true, path: resolved.path };
  }

  return { list, read, write, edit, move, remove, search, revert };
}

module.exports = { create, SKIPPED_DIRS, MAX_LIST_ENTRIES, MAX_SEARCH_HITS };
