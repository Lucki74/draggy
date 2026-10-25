/** What every child process leaves in the log: the binary, its arguments, the pid, then the exit
 * code or signal, how long it ran and the last lines it wrote to stderr. `platform.spawnHidden` and
 * `platform.execFileHidden` call these, so every engine, git call and MCP server is covered. */

const fs = require("fs");
const path = require("path");
const { log } = require("./logger.cjs");
const { scrubSecrets } = require("./logScrub.cjs");

const STDERR_LINES = 20;
const MAX_LINE_CHARS = 300;
const MAX_ARG_CHARS = 200;
const SECRET_FLAG = /(?:key|token|secret|password|passwd|auth)/i;

/** A long path keeps its last two segments; the full one is in the exit and error lines. */
function shortenArg(arg) {
  const text = String(arg);
  if (/[\\/]/.test(text) && text.length > 60 && !/\s/.test(text.slice(0, 3))) {
    const parts = text.split(/[\\/]+/).filter(Boolean);
    return `…/${parts.slice(-2).join("/")}`;
  }
  return text.length > MAX_ARG_CHARS ? `${text.slice(0, MAX_ARG_CHARS)}…` : text;
}

/** The argument list as it goes in the log: shortened, scrubbed, and the value after a secret-looking flag dropped. */
function describeArgs(args) {
  if (!Array.isArray(args)) return [];
  const out = [];
  let hideNext = false;
  for (const arg of args) {
    const text = String(arg);
    if (hideNext) {
      out.push("[secret:arg]");
      hideNext = false;
    } else if (/^--?[\w-]+$/.test(text) && SECRET_FLAG.test(text)) {
      out.push(text);
      hideNext = true;
    } else if (/^--?[\w-]+=/.test(text) && SECRET_FLAG.test(text.split("=")[0])) {
      out.push(`${text.split("=")[0]}=[secret:arg]`);
    } else {
      out.push(scrubSecrets(shortenArg(text)));
    }
  }
  return out;
}

/** The file on PATH a bare name would resolve to, or null. Only used once something failed. */
function resolveBinary(file, env = process.env) {
  try {
    if (path.isAbsolute(file) || /[\\/]/.test(file)) return path.resolve(file);
    const extensions = process.platform === "win32" ? (env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
    for (const dir of (env.PATH || env.Path || "").split(path.delimiter)) {
      if (!dir) continue;
      for (const extension of ["", ...extensions]) {
        const candidate = path.join(dir, file + extension);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  } catch {
    // silent-ok: an unreadable PATH entry is not worth a line
  }
  return null;
}

function tailLines(text, count = STDERR_LINES) {
  return String(text)
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(-count)
    .map((line) => scrubSecrets(line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line));
}

function safeExists(file) {
  try {
    return Boolean(file) && fs.existsSync(file);
  } catch {
    return false;
  }
}

/** Facts about a spawn that failed to start: where the name resolved and whether that file is there. */
function spawnFailure(file, error, options = {}) {
  const resolved = resolveBinary(file, options.env);
  const exists = safeExists(resolved);
  return { code: error?.code, bin: path.basename(String(file)), resolved: resolved || String(file), exists, cwd: options.cwd };
}

const live = new Map();
const liveChildren = () => [...live].map(([pid, bin]) => ({ pid, bin }));

/** Starts the log trail for a spawned child. Never throws and never changes the child. */
function trackChild(child, file, args, options = {}) {
  try {
    const bin = path.basename(String(file));
    const scope = "proc.spawn";
    const started = performance.now();
    const ring = [];
    let partial = "";
    const onStderr = (chunk) => {
      partial += chunk.toString("utf8");
      const lines = partial.split(/\r?\n/);
      partial = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        ring.push(line);
        if (ring.length > STDERR_LINES) ring.shift();
      }
      if (partial.length > 4000) partial = partial.slice(-4000);
    };
    child.stderr?.on("data", onStderr);

    if (child.pid) live.set(child.pid, bin);
    log.info(scope, "spawned", { bin, args: describeArgs(args), cwd: options.cwd, pid: child.pid });

    child.once("error", (error) => {
      log.fail(scope, `${bin} failed to start`, error, spawnFailure(file, error, options));
    });
    child.once("close", (code, signal) => {
      live.delete(child.pid);
      if (partial.trim()) ring.push(partial);
      const durMs = Math.round(performance.now() - started);
      const data = { bin, pid: child.pid, code, signal, durMs };
      if (code === 0) {
        log.info(scope, `${bin} exited`, data);
      } else {
        log.warn(scope, `${bin} exited`, { ...data, stderr: tailLines(ring.join("\n")), resolved: resolveBinary(file, options.env) });
      }
    });
  } catch (error) {
    log.swallow("proc.spawn", error, "could not track child");
  }
  return child;
}

/** Wraps an execFile callback so the call is logged whichever way it ends. */
function trackExec(file, args, options, callback) {
  const bin = path.basename(String(file));
  const started = performance.now();
  return (error, stdout, stderr) => {
    try {
      const durMs = Math.round(performance.now() - started);
      const data = { bin, args: describeArgs(args), cwd: options?.cwd, durMs };
      if (!error) {
        log.debug("proc.exec", `${bin} done`, data);
      } else if (error.code === "ENOENT" || error.code === "EACCES" || error.code === "EPERM") {
        log.fail("proc.exec", `${bin} failed to start`, error, { ...data, ...spawnFailure(file, error, options) });
      } else {
        log.warn("proc.exec", `${bin} failed`, {
          ...data,
          code: error.code,
          signal: error.signal,
          killed: error.killed,
          stderr: tailLines(stderr || ""),
        });
      }
    } catch (failure) {
      log.swallow("proc.exec", failure, "could not log exec result");
    }
    return callback?.(error, stdout, stderr);
  };
}

module.exports = { liveChildren, trackChild, trackExec, describeArgs, resolveBinary, spawnFailure, shortenArg, tailLines };
