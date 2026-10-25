const path = require("node:path");
const { buildEnv, runOnce } = require("./exec.cjs");
const { findGitExe, findOnPath } = require("./shells.cjs");
const { log } = require("./logger.cjs");

/** Git for the app. Reading never takes locks. Writing is limited to stage, unstage, commit and
 * switching branch, and never fetches or pushes. Repo config can run programs (fsmonitor, filters,
 * diff tools, hooks), so every call disables them. */

/** How long one git call may take before it is treated as hung. */
const GIT_TIMEOUT_MS = 10_000;

/** How much diff a caller gets. Beyond this it is truncated and says so. */
const MAX_DIFF_CHARS = 60_000;

/** How many files one diff names. Past this the command line gets long on Windows. */
const MAX_DIFF_FILES = 300;

/** How many untracked files a diff reads, and how many commits a log lists. */
const MAX_UNTRACKED_DIFFS = 20;
const MAX_LOG_ENTRIES = 200;
const MAX_COMMIT_MESSAGE_CHARS = 10_000;

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

/** The last few stderr lines, for a failure log. Git's own messages hold no file contents. */
function tailLines(text, count) {
  return String(text || "").split(/\r?\n/).filter(Boolean).slice(-count).join(" | ") || null;
}

/** git on PATH, or the copy Git for Windows installed when PATH has none. Looked up once. */
let gitProgram = null;
function gitBinary() {
  if (!gitProgram) gitProgram = findOnPath("git") ? "git" : findGitExe() || "git";
  return gitProgram;
}

function defaultRun(args, cwd) {
  return runOnce({
    file: gitBinary(),
    args,
    cwd,
    env: buildEnv({ GIT_OPTIONAL_LOCKS: "0" }),
    timeoutMs: GIT_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  }).then((result) => {
    if (result.missing) return { code: -1, stdout: "", stderr: "", missing: true };

    // Output cut short is a failure, as it was when execFile reported maxBuffer.
    const code = result.truncated ? 1 : (result.code ?? 1);
    return { code, stdout: result.stdout, stderr: result.stderr };
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

/** Reads `git status --porcelain=v2 --branch -z`. Entries are separated by NUL rather than newlines
 * and paths are never quoted, so a file called "a b\nc" parses the same as any other. */
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
      availability = run(["--version"], process.cwd()).then((result) => {
        const ok = !result.missing && result.code === 0;
        log.info("files.git", "availability checked", { available: ok });
        return ok;
      });
    }
    return availability;
  }

  const git = (root, args) => run([...SAFE_FLAGS, ...args], root);

  /** Blanks every filter driver the repo defines, since clean runs on status and diff. Null when a
   * name cannot be overridden safely, so nothing runs. */
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
      if (name.includes("=")) {
        log.warn("files.git", "filter name refused", { filters: names.size });
        return null;
      }
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

  /** Where the project folder sits inside its repository, as git writes paths. Empty when the
   * folder is the top of the repository. */
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

    const timer = log.time("files.git", "status");
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
      log.fail("files.git", "status failed", null, { subcommand: "status", code: result.code, stderrTail: tailLines(result.stderr, 3) });
      return { success: false, available: true, isRepo: true, error: firstLine(result.stderr) };
    }

    const parsed = parseStatus(result.stdout, prefix);
    timer.end({ files: parsed.files.length, truncated: parsed.truncated });

    return {
      success: true,
      available: true,
      isRepo: true,
      ...parsed,
      counts: countChanges(parsed.files),
    };
  }

  /** Working tree or staged diff, for the project or one path already checked by the caller.
   * `allow` drops guarded files by name so a tracked .env never prints. */
  async function diff(root, { relative = ".", staged = false, untracked = false, allow = () => true } = {}) {
    if (!(await available())) return { success: false, error: "Git is not installed." };

    const prefix = await prefixOf(root);
    if (prefix === null) return { success: false, error: "This folder is not a git repository." };

    const disarmed = await disarmFilters(root);
    if (disarmed === null) return { success: false, error: REFUSED_CONFIG };

    const timer = log.time("files.git", "diff", { staged });
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
    if (listed.code !== 0) {
      log.fail("files.git", "diff list failed", null, { subcommand: "diff", code: listed.code, stderrTail: tailLines(listed.stderr, 3) });
      return { success: false, error: firstLine(listed.stderr) };
    }

    const changed = listed.stdout.split("\0").filter(Boolean);
    const allowed = changed.filter((name) => allow(path.join(root, name)));
    const skipped = changed.length - allowed.length;

    const added = !staged && untracked ? await untrackedDiff(root, relative, allow) : { text: "", files: 0, more: false };

    if (allowed.length === 0) {
      timer.end({ files: added.files, skipped });
      const text = clipDiff(added.text);
      return { success: true, diff: text, truncated: added.more || text.length < added.text.length, staged, files: added.files, skipped };
    }

    const named = allowed.slice(0, MAX_DIFF_FILES);
    const result = await git(root, [...common, "--", ...named]);

    if (result.code !== 0) {
      log.fail("files.git", "diff failed", null, { subcommand: "diff", code: result.code, files: named.length, stderrTail: tailLines(result.stderr, 3) });
      return { success: false, error: firstLine(result.stderr) };
    }

    const whole = result.stdout + (result.stdout && added.text && !result.stdout.endsWith("\n") ? "\n" : "") + added.text;
    const text = clipDiff(whole);
    const truncated = text.length < whole.length || named.length < allowed.length || added.more;
    timer.end({ files: named.length + added.files, skipped, chars: whole.length, truncated });

    return {
      success: true,
      diff: text,
      truncated,
      staged,
      files: named.length + added.files,
      skipped,
    };
  }

  /** Cuts a diff at the last whole line, so a truncated diff never ends in half a hunk line. */
  const clipDiff = (text) => {
    if (text.length <= MAX_DIFF_CHARS) return text;
    const cut = text.slice(0, MAX_DIFF_CHARS);
    const end = cut.lastIndexOf("\n");
    return end > 0 ? cut.slice(0, end + 1) : cut;
  };

  /** New files as additions. `git diff` does not list files git does not know yet. */
  async function untrackedDiff(root, relative, allow) {
    const listed = await git(root, ["ls-files", "--others", "--exclude-standard", "-z", "--", relative || "."]);
    if (listed.code !== 0) return { text: "", files: 0, more: false };

    const names = listed.stdout.split("\0").filter(Boolean).filter((name) => allow(path.join(root, name)));
    let text = "";
    let files = 0;
    for (const name of names.slice(0, MAX_UNTRACKED_DIFFS)) {
      // Exit 1 is how --no-index says the two sides differ.
      const result = await git(root, ["diff", "--no-index", "--no-color", "--no-ext-diff", "--no-textconv", "--", "/dev/null", name]);
      if (result.code > 1 || !result.stdout) continue;
      text += result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`;
      files += 1;
    }
    return { text, files, more: names.length > MAX_UNTRACKED_DIFFS };
  }

  /** The latest commits on the current branch. */
  async function history(root, { limit = 50 } = {}) {
    if (!(await available())) return { success: false, error: "Git is not installed." };
    const count = Math.min(Math.max(Math.trunc(Number(limit)) || 50, 1), MAX_LOG_ENTRIES);
    const result = await git(root, ["log", `-n${count}`, "--no-show-signature", "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e"]);
    if (result.code !== 0) {
      // A repository with no commits yet has no log, which is not an error.
      if (/does not have any commits/i.test(result.stderr)) return { success: true, commits: [] };
      return { success: false, error: firstLine(result.stderr) };
    }
    const commits = result.stdout
      .split("\x1e")
      .map((record) => record.replace(/^\r?\n/, ""))
      .filter(Boolean)
      .map((record) => {
        const [hash, short, author, date, subject] = record.split("\x1f");
        return { hash, short, author, date, subject };
      });
    return { success: true, commits };
  }

  /** Local branches, the current one marked. */
  async function branches(root) {
    if (!(await available())) return { success: false, error: "Git is not installed." };
    const result = await git(root, ["for-each-ref", "--format=%(HEAD)%1f%(refname:short)%1f%(upstream:short)", "refs/heads"]);
    if (result.code !== 0) return { success: false, error: firstLine(result.stderr) };
    const list = result.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [head, name, upstream] = line.split("\x1f");
        return { name, current: head === "*", ...(upstream ? { upstream } : {}) };
      });
    return { success: true, branches: list };
  }

  const pathList = (paths) => (Array.isArray(paths) ? paths.map(String).filter(Boolean) : []);

  /** Moves files into the next commit. Paths were checked by the caller. */
  async function stage(root, paths) {
    const named = pathList(paths);
    if (!(await available())) return { success: false, error: "Git is not installed." };
    if (named.length === 0) return { success: false, error: "No files were named." };
    const result = await git(root, ["add", "--", ...named]);
    return result.code === 0 ? { success: true, files: named.length } : { success: false, error: firstLine(result.stderr) };
  }

  /** Takes files back out of the next commit, leaving the working tree as it is. */
  async function unstage(root, paths) {
    const named = pathList(paths);
    if (!(await available())) return { success: false, error: "Git is not installed." };
    if (named.length === 0) return { success: false, error: "No files were named." };
    // A repository with no commits has no HEAD to restore from; rm --cached does the same job.
    const hasHead = (await git(root, ["rev-parse", "--verify", "-q", "HEAD"])).code === 0;
    const result = await git(root, hasHead ? ["restore", "--staged", "--", ...named] : ["rm", "--cached", "-r", "-q", "--", ...named]);
    return result.code === 0 ? { success: true, files: named.length } : { success: false, error: firstLine(result.stderr) };
  }

  /** Commits what is staged. Hooks stay off: they are programs the repository chose, and the person
   * asked for a commit, not for whatever a hook does. */
  async function commit(root, message) {
    const text = String(message ?? "").trim();
    if (!text) return { success: false, error: "A commit needs a message." };
    if (text.length > MAX_COMMIT_MESSAGE_CHARS) return { success: false, error: "The commit message is too long." };
    if (!(await available())) return { success: false, error: "Git is not installed." };

    const result = await git(root, ["-c", "core.hooksPath=/dev/null", "commit", "--no-verify", "--no-gpg-sign", "-m", text]);
    if (result.code !== 0) {
      log.fail("files.git", "commit failed", null, { subcommand: "commit", code: result.code, stderrTail: tailLines(result.stderr, 3) });
      return { success: false, error: firstLine(result.stderr || result.stdout) };
    }
    const head = await git(root, ["rev-parse", "--short", "HEAD"]);
    return { success: true, hash: head.code === 0 ? head.stdout.trim() : null };
  }

  /** Switches to an existing local branch. Git itself refuses when uncommitted changes would be lost. */
  async function checkout(root, branch) {
    const name = String(branch ?? "").trim();
    if (!name || name.startsWith("-")) return { success: false, error: "That is not a branch name." };
    if (!(await available())) return { success: false, error: "Git is not installed." };

    const valid = await git(root, ["check-ref-format", "--branch", name]);
    if (valid.code !== 0) return { success: false, error: "That is not a branch name." };

    const result = await git(root, ["switch", "--no-guess", name]);
    return result.code === 0 ? { success: true, branch: name } : { success: false, error: firstLine(result.stderr) };
  }

  return { available, status, diff, log: history, branches, stage, unstage, commit, checkout };
}

function firstLine(text) {
  return String(text || "").trim().split(/\r?\n/)[0] || "Git did not say what went wrong.";
}

/** A path the renderer named, as git should see it: relative to the project, with forward slashes.
 * Null when it is not inside the project at all. */
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
