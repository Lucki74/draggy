const path = require("node:path");
const { execFileHidden } = require("./platform.cjs");

/**
 * Git, read-only. Draggy asks the system's own git what state a project is in
 * and shows it; it never commits, stages, checks out or fetches, because those
 * are decisions about the user's history and stay the user's to make.
 *
 * A repository is somebody else's configuration as much as it is files, and
 * some of that configuration can run programs: an fsmonitor hook on status, a
 * clean filter on diff, an external diff tool, a textconv driver. A cloned repo
 * with any of those would otherwise run them the moment Draggy looked at it,
 * and the model can ask it to look. Every call here turns them off, leaves
 * submodules alone, and takes no optional locks, so a status in the background
 * never gets in the way of the user's own git in a terminal.
 */

/** How long one git call may take before it is treated as hung. */
const GIT_TIMEOUT_MS = 10_000;

/** How much diff a caller gets. Beyond this it is truncated and says so. */
const MAX_DIFF_CHARS = 60_000;

/** How many files one diff names. Past this the command line gets long on Windows. */
const MAX_DIFF_FILES = 300;

/** How many changed files a status lists. */
const MAX_STATUS_FILES = 500;

/** Flags that go before every subcommand. */
const SAFE_FLAGS = [
  "--no-pager",
  // Paths are paths: ":(top)" and friends would otherwise reach outside the
  // folder the call was scoped to.
  "--literal-pathspecs",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.quotepath=false",
  "-c",
  "color.ui=false",
];

function defaultRun(args, cwd) {
  return new Promise((resolve) => {
    execFileHidden(
      "git",
      args,
      {
        cwd,
        encoding: "utf8",
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_OPTIONAL_LOCKS: "0",
        },
      },
      (error, stdout, stderr) => {
        if (error && error.code === "ENOENT") {
          resolve({ code: -1, stdout: "", stderr: "", missing: true });
          return;
        }

        resolve({
          code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
        });
      },
    );
  });
}

/** What kind of change a status letter pair describes, in plain words. */
function kindOf(type, xy) {
  if (type === "?") return "untracked";
  if (type === "u") return "conflicted";
  if (type === "2") return "renamed";

  const [index, worktree] = String(xy || "..");
  if (index === "A" || worktree === "A") return "added";
  if (index === "D" || worktree === "D") return "deleted";
  return "modified";
}

/**
 * Reads `git status --porcelain=v2 --branch -z`. Entries are separated by NUL
 * rather than newlines and paths are never quoted, so a file called "a b\nc"
 * parses the same as any other.
 */
function parseStatus(output, prefix = "") {
  const tokens = String(output || "").split("\0");
  const result = {
    branch: null,
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    files: [],
    truncated: false,
  };

  const strip = (file) =>
    prefix && file.startsWith(prefix) ? file.slice(prefix.length) : file;

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token) continue;

    if (token.startsWith("# ")) {
      const [, key, ...rest] = token.split(" ");
      const value = rest.join(" ");

      if (key === "branch.head") {
        result.detached = value === "(detached)";
        result.branch = result.detached ? null : value;
      } else if (key === "branch.upstream") {
        result.upstream = value;
      } else if (key === "branch.ab") {
        const match = /^\+(\d+) -(\d+)$/.exec(value);
        if (match) {
          result.ahead = Number(match[1]);
          result.behind = Number(match[2]);
        }
      }
      continue;
    }

    const type = token[0];
    let entry = null;

    if (type === "1") {
      const fields = token.split(" ");
      entry = { xy: fields[1], path: fields.slice(8).join(" ") };
    } else if (type === "2") {
      const fields = token.split(" ");
      // The path it came from is the next NUL-separated field.
      entry = { xy: fields[1], path: fields.slice(9).join(" "), from: tokens[index + 1] };
      index += 1;
    } else if (type === "u") {
      const fields = token.split(" ");
      entry = { xy: fields[1], path: fields.slice(10).join(" ") };
    } else if (type === "?") {
      entry = { xy: "??", path: token.slice(2) };
    }

    if (!entry || !entry.path) continue;

    if (result.files.length >= MAX_STATUS_FILES) {
      result.truncated = true;
      continue;
    }

    const [x, y] = entry.xy;

    result.files.push({
      path: strip(entry.path),
      ...(entry.from ? { from: strip(entry.from) } : {}),
      kind: kindOf(type, entry.xy),
      staged: type !== "?" && x !== ".",
      unstaged: type === "?" || y !== ".",
    });
  }

  return result;
}

/** How many files of each kind changed, for a status strip. */
function countChanges(files) {
  const counts = { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 };
  for (const file of files) counts[file.kind] = (counts[file.kind] || 0) + 1;
  return counts;
}

function createGit({ run = defaultRun } = {}) {
  let availability = null;

  /** Whether there is a git to ask. Asked once; the answer does not change while Draggy runs. */
  function available() {
    if (!availability) {
      availability = run(["--version"], process.cwd()).then(
        (result) => !result.missing && result.code === 0,
      );
    }
    return availability;
  }

  const git = (root, args) => run([...SAFE_FLAGS, ...args], root);

  /**
   * Flags that switch off every filter driver the repository defines. A
   * driver's clean command runs on diff and on status, so each one found is
   * given empty commands, which git reads as no filter at all. Null when a
   * driver's name cannot be overridden safely, in which case nothing runs.
   */
  async function disarmFilters(root) {
    const listed = await git(root, [
      "config",
      "--name-only",
      "--get-regexp",
      "^filter\\..*\\.(clean|smudge|process)$",
    ]);

    // Exit 1 is git's way of saying there are none.
    if (listed.code !== 0) return [];

    const names = new Set();
    for (const line of listed.stdout.split(/\r?\n/)) {
      const match = /^filter\.(.+)\.(clean|smudge|process)$/.exec(line.trim());
      if (match) names.add(match[1]);
    }

    const flags = [];
    for (const name of names) {
      // "-c key=value" splits at the first "=", so a name holding one would
      // override some other key and leave the real driver armed.
      if (name.includes("=")) return null;
      flags.push(
        "-c",
        `filter.${name}.clean=`,
        "-c",
        `filter.${name}.smudge=`,
        "-c",
        `filter.${name}.process=`,
      );
    }

    return flags;
  }

  const REFUSED_CONFIG =
    "This repository's configuration could run programs, so Draggy will not read it.";

  /**
   * Where the project folder sits inside its repository, as git writes paths.
   * Empty when the folder is the top of the repository.
   */
  async function prefixOf(root) {
    const result = await git(root, ["rev-parse", "--show-prefix"]);
    if (result.code !== 0) return null;
    return result.stdout.trim();
  }

  async function status(root) {
    if (!(await available())) return { success: true, available: false, isRepo: false };

    const prefix = await prefixOf(root);
    if (prefix === null) return { success: true, available: true, isRepo: false };

    const disarmed = await disarmFilters(root);
    if (disarmed === null) {
      return { success: false, available: true, isRepo: true, error: REFUSED_CONFIG };
    }

    const result = await git(root, [
      ...disarmed,
      "status",
      "--porcelain=v2",
      "--branch",
      "-z",
      "--untracked-files=normal",
      "--ignore-submodules=all",
      "--",
      ".",
    ]);

    if (result.code !== 0) {
      return { success: false, available: true, isRepo: true, error: firstLine(result.stderr) };
    }

    const parsed = parseStatus(result.stdout, prefix);

    return {
      success: true,
      available: true,
      isRepo: true,
      ...parsed,
      counts: countChanges(parsed.files),
    };
  }

  /**
   * The diff of the working tree, or of what is staged, for the whole project
   * or one file in it. `relative` has already been checked to be inside the
   * project by the caller; here it is only ever a path after `--`.
   *
   * `allow` is the file guard. A diff prints file contents, so a tracked .env
   * would otherwise come out of a whole-project diff that no read_file could
   * have reached. The changed files are listed first and anything the guard
   * refuses is left out by name, never by contents.
   */
  async function diff(root, { relative = ".", staged = false, allow = () => true } = {}) {
    if (!(await available())) return { success: false, error: "Git is not installed." };

    const prefix = await prefixOf(root);
    if (prefix === null) return { success: false, error: "This folder is not a git repository." };

    const disarmed = await disarmFilters(root);
    if (disarmed === null) return { success: false, error: REFUSED_CONFIG };

    const common = [
      ...disarmed,
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--ignore-submodules=all",
      "--relative",
      ...(staged ? ["--cached"] : []),
    ];

    const listed = await git(root, [...common, "--name-only", "-z", "--", relative || "."]);
    if (listed.code !== 0) return { success: false, error: firstLine(listed.stderr) };

    const changed = listed.stdout.split("\0").filter(Boolean);
    const allowed = changed.filter((name) => allow(path.join(root, name)));
    const skipped = changed.length - allowed.length;

    if (allowed.length === 0) {
      return { success: true, diff: "", truncated: false, staged, files: 0, skipped };
    }

    const named = allowed.slice(0, MAX_DIFF_FILES);
    const result = await git(root, [...common, "--", ...named]);

    if (result.code !== 0) return { success: false, error: firstLine(result.stderr) };

    const text = result.stdout;
    const truncated = text.length > MAX_DIFF_CHARS || named.length < allowed.length;

    return {
      success: true,
      diff: text.length > MAX_DIFF_CHARS ? text.slice(0, MAX_DIFF_CHARS) : text,
      truncated,
      staged,
      files: named.length,
      skipped,
    };
  }

  return { available, status, diff };
}

function firstLine(text) {
  return String(text || "").trim().split(/\r?\n/)[0] || "Git did not say what went wrong.";
}

/**
 * A path the renderer named, as git should see it: relative to the project,
 * with forward slashes. Null when it is not inside the project at all.
 */
function toPathspec(root, absolute) {
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative ? relative.split(path.sep).join("/") : ".";
}

module.exports = {
  GIT_TIMEOUT_MS,
  MAX_DIFF_CHARS,
  MAX_DIFF_FILES,
  MAX_STATUS_FILES,
  SAFE_FLAGS,
  createGit,
  parseStatus,
  countChanges,
  toPathspec,
};
