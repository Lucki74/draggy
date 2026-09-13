const fs = require("fs");
const path = require("path");

/** The only route to a user's file: resolved, symlinks followed, checked against the conversation's
 * folders. A page or document the model read may choose the path. */

/** Folders that are never opened, even when they sit inside a granted root. */
const DENIED_SEGMENTS = new Set([
  ".ssh",
  ".aws",
  ".gnupg",
  ".gpg",
  ".docker",
  ".kube",
  ".password-store",
  "keychains",
  "credentials.d",
]);

/** Files that are never opened, by the shape of the name. */
const DENIED_NAMES = [
  /^\.env($|\.)/i,
  /^id_(rsa|dsa|ecdsa|ed25519)/i,
  /\.(pem|pfx|p12|keystore)$/i,
  /^\.netrc$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^credentials$/i,
  /^\.git-credentials$/i,
];

/** How much of a file is worth handing to a model in one go. */
const MAX_READ_BYTES = 2 * 1024 * 1024;

/** Draggy's own storage: its database, its logs, its blobs. Never in scope. */
let protectedPaths = [];

function setProtectedPaths(paths) {
  protectedPaths = (paths || [])
    .filter(Boolean)
    .map((one) => path.resolve(String(one)));
}

function refuse(reason) {
  return { ok: false, error: reason };
}

/** The real path, with symlinks followed. Null when it is not there. */
function realpathOrNull(target) {
  try {
    return fs.realpathSync.native(target);
  } catch {
    return null;
  }
}

/** Is `target` the folder itself or something under it? Compared after both have been resolved, so
 * `..` and a symlink out of the tree are already gone. */
function isInside(folder, target) {
  const relative = path.relative(folder, target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/** A name that is never opened. Exported so folder walks refuse what `resolveWithin` refuses, or a
 * search would get around this module. */
function isDeniedName(name) {
  const part = String(name || "");

  return (
    DENIED_SEGMENTS.has(part.toLowerCase()) ||
    DENIED_NAMES.some((pattern) => pattern.test(part))
  );
}

function hasDeniedPart(target) {
  return target.split(/[\\/]+/).filter(Boolean).some(isDeniedName);
}

/** Whether a path found by walking a folder is one Draggy may open. */
function isReadable(target) {
  const resolved = path.resolve(target);

  if (protectedPaths.some((one) => isInside(one, resolved))) return false;
  return !hasDeniedPart(resolved);
}

/** The deepest folder above `target` that exists. Null if none of them does. */
function nearestExisting(target) {
  let current = target;

  for (;;) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    if (fs.existsSync(parent)) return parent;
    current = parent;
  }
}

/** Turns a requested path into one Draggy may touch, or a reason why not. Relative paths resolve
 * against the first root, the project. */
function resolveWithin(roots, requested, options = {}) {
  const { mustExist = false, createParents = false } = options;

  if (typeof requested !== "string" || !requested.trim()) {
    return refuse("No file was named.");
  }

  const folders = (roots || []).filter(Boolean).map((one) => String(one));
  if (folders.length === 0) {
    return refuse(
      "This conversation has no folder to work in. Open a project first.",
    );
  }

  const asked = requested.trim();

  // A path with a null byte is a path that means one thing to this check and
  // another to the system call underneath it.
  if (asked.includes("\0")) return refuse("That file name is not usable.");

  const absolute = path.resolve(
    path.isAbsolute(asked) ? asked : path.join(folders[0], asked),
  );

  const exists = fs.existsSync(absolute);
  if (mustExist && !exists) return refuse(`There is no ${path.basename(absolute)}.`);

  // A new file inherits its folder, so the folder is what must be real. `createParents` lets the
  // check reach up for folders a write will make.
  const parent = path.dirname(absolute);
  const anchor = exists
    ? absolute
    : fs.existsSync(parent)
      ? parent
      : createParents
        ? nearestExisting(absolute)
        : null;

  const realAnchor = anchor ? realpathOrNull(anchor) : null;

  if (!realAnchor) return refuse("That folder does not exist.");

  // Whatever of the path was still missing, rebuilt onto the real ancestor, so
  // a symlink anywhere along the way has already been followed.
  const resolved = exists
    ? realAnchor
    : path.join(realAnchor, path.relative(anchor, absolute));

  const inside = folders.some((folder) => {
    const realFolder = realpathOrNull(folder);
    return realFolder ? isInside(realFolder, resolved) : false;
  });

  if (!inside) {
    return refuse(
      "That path is outside the folder this conversation can reach.",
    );
  }

  if (protectedPaths.some((one) => isInside(one, resolved))) {
    return refuse("That is Draggy's own storage, which is not yours to edit.");
  }

  if (hasDeniedPart(resolved)) {
    return refuse(
      "That file holds credentials, so Draggy does not open it. Tell the user what you need and let them do it.",
    );
  }

  return { ok: true, path: resolved };
}

/** Text a model can work with, or a reason it cannot. */
function readText(file, limit = MAX_READ_BYTES) {
  const stats = fs.statSync(file);

  if (stats.isDirectory()) return refuse("That is a folder, not a file.");
  if (stats.size > limit) {
    return refuse(
      `That file is ${Math.round(stats.size / 1024)} KB, over the ${Math.round(
        limit / 1024,
      )} KB a single read allows. Ask for part of it instead.`,
    );
  }

  const buffer = fs.readFileSync(file);

  // A null byte in the first block is how every editor guesses the same thing.
  if (buffer.subarray(0, 8000).includes(0)) {
    return refuse("That file is not text.");
  }

  return { ok: true, text: buffer.toString("utf8"), bytes: stats.size };
}

module.exports = {
  DENIED_NAMES,
  DENIED_SEGMENTS,
  MAX_READ_BYTES,
  isDeniedName,
  isInside,
  isReadable,
  readText,
  resolveWithin,
  setProtectedPaths,
};
