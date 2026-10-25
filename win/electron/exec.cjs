const { StringDecoder } = require("string_decoder");
const { spawnHidden, killTree } = require("./platform.cjs");

/** The one place Draggy starts a child process for its own work. Output is decoded per stream, so a
 * character split across two reads survives, and every run has a timeout, abort or caller-held stop. */

const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;

/** The environment every child gets: nothing waits on a prompt, pagers and colour are off, and the
 * packaged app's Node switch never leaks into a tool the user runs. */
function buildEnv(extra = {}, base = process.env) {
  const env = {
    ...base,
    GIT_TERMINAL_PROMPT: "0",
    GH_PROMPT_DISABLED: "1",
    GIT_PAGER: "cat",
    PAGER: "cat",
    NO_COLOR: "1",
    TERM: "dumb",
    ...extra,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/** Starts a child with streamed output. `onExit` runs once: with the code and signal, or with an
 * `error` when the program could not start, in which case `code` is null. */
function spawnStream({ file, args = [], cwd, env, verbatim = false }, { onStdout, onStderr, onExit }) {
  let child = null;
  try {
    child = spawnHidden(file, args, {
      cwd,
      env: env ?? buildEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsVerbatimArguments: Boolean(verbatim),
    });
  } catch (error) {
    // Deferred so the caller has its handle before any exit callback runs.
    process.nextTick(onExit, { code: null, signal: null, error });
    return { pid: undefined, child, kill: () => killTree(child) };
  }

  const decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
  let done = false;

  const emit = (name, handler, text) => {
    if (done || !text || !handler) return;
    handler(text);
  };

  child.stdout.on("data", (chunk) => emit("stdout", onStdout, decoders.stdout.write(chunk)));
  child.stderr.on("data", (chunk) => emit("stderr", onStderr, decoders.stderr.write(chunk)));

  const settle = (exit) => {
    if (done) return;
    emit("stdout", onStdout, decoders.stdout.end());
    emit("stderr", onStderr, decoders.stderr.end());
    done = true;
    onExit(exit);
  };

  child.on("error", (error) => settle({ code: null, signal: null, error }));
  child.on("close", (code, signal) => settle({ code, signal: signal || null }));

  return { pid: child.pid, child, kill: () => killTree(child) };
}

/** Runs a program to completion. `maxBuffer` caps the characters kept per stream; past it the rest is
 * drained and discarded, and `truncated` says so. A missing program resolves with `missing: true`. */
function runOnce({
  file,
  args = [],
  cwd,
  env,
  timeoutMs = 0,
  maxBuffer = DEFAULT_MAX_BUFFER,
  signal,
  verbatim = false,
} = {}) {
  const empty = { code: null, stdout: "", stderr: "", missing: false, timedOut: false, truncated: false, aborted: false };
  if (signal?.aborted) return Promise.resolve({ ...empty, aborted: true });

  return new Promise((resolve) => {
    const text = { stdout: "", stderr: "" };
    let truncated = false;
    let timedOut = false;
    let aborted = false;
    let finished = false;
    let timer = null;
    let handle = null;

    const keep = (name, piece) => {
      const room = Math.max(0, maxBuffer - text[name].length);
      if (piece.length > room) truncated = true;
      text[name] += piece.slice(0, room);
    };

    const onAbort = () => {
      aborted = true;
      handle?.kill();
    };

    const settle = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ ...empty, ...result, stdout: text.stdout, stderr: text.stderr, timedOut, truncated, aborted });
    };

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        handle?.kill();
      }, timeoutMs);
    }

    handle = spawnStream(
      { file, args, cwd, env, verbatim },
      {
        onStdout: (piece) => keep("stdout", piece),
        onStderr: (piece) => keep("stderr", piece),
        onExit: ({ code, error }) => {
          if (error?.code === "ENOENT") {
            settle({ missing: true });
            return;
          }
          if (error) {
            settle({ stderr: text.stderr || error.message });
            return;
          }
          settle({ code });
        },
      },
    );

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

module.exports = { buildEnv, runOnce, spawnStream, DEFAULT_MAX_BUFFER };
