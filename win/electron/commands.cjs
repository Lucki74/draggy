const fs = require("fs");
const path = require("path");
const { killTreeSync } = require("./platform.cjs");
const { buildEnv, spawnStream } = require("./exec.cjs");
const { SHELL_IDS, findOnPath, shellInvocation } = require("./shells.cjs");
const { log } = require("./logger.cjs");

/** Commands the model runs in a project: a real shell in the project folder, with no terminal to
 * wait on, stoppable, and output cut to a size a model can read. */

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_CHARS = 30_000;
const HEAD_CHARS = 8_000;
const MAX_COMMAND_CHARS = 8_000;

/** The start and the end of a long output, which is where errors and summaries are. */
function clip(text) {
  if (text.length <= MAX_OUTPUT_CHARS) return { text, truncated: false };

  const tail = MAX_OUTPUT_CHARS - HEAD_CHARS;
  const cut = text.length - HEAD_CHARS - tail;
  return {
    text: `${text.slice(0, HEAD_CHARS)}\n\n[... ${cut} characters cut ...]\n\n${text.slice(-tail)}`,
    truncated: true,
  };
}

function timeoutFor(value) {
  const asked = Number(value);
  if (!Number.isFinite(asked) || asked <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(asked, 1000), MAX_TIMEOUT_MS);
}

/** Commands in flight by id, so the renderer can stop one and a quit can stop them all. */
const live = new Map();

function run({ id, cwd, command, shell, defaultShell, timeoutMs }) {
  const text = String(command || "");
  if (!text.trim()) return Promise.resolve({ success: false, error: "No command was given." });
  if (text.length > MAX_COMMAND_CHARS) {
    return Promise.resolve({ success: false, error: "That command is too long to run." });
  }
  if (!cwd || !fs.existsSync(cwd)) {
    return Promise.resolve({ success: false, error: "The project folder is not available." });
  }

  const invocation = shellInvocation(text, shell, { defaultShell });
  if (invocation.error) return Promise.resolve({ success: false, error: invocation.error });

  // A second run under the same id would overwrite the first one's entry and orphan it.
  const key = id ? String(id) : null;
  if (key && live.has(key)) {
    return Promise.resolve({ success: false, error: "A command with that id is already running." });
  }

  const limit = timeoutFor(timeoutMs);
  const started = Date.now();
  const entry = { handle: null, cancelled: false };
  if (key) live.set(key, entry);

  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    let settled = false;

    const collect = (chunk) => {
      output += chunk;
      // Kept bounded while it runs: the start, and a generous end.
      if (output.length > MAX_OUTPUT_CHARS * 3) {
        output = output.slice(0, HEAD_CHARS) + output.slice(-(MAX_OUTPUT_CHARS * 2));
      }
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (key && live.get(key) === entry) live.delete(key);
      const durationMs = Date.now() - started;
      log.info("proc.command", "command finished", { durationMs, exitCode: result.exitCode ?? null, timedOut, cancelled: entry.cancelled });
      resolve({ ...result, shell: invocation.shell, durationMs, ...(invocation.notice ? { notice: invocation.notice } : {}) });
    };

    // Set before the spawn, so a spawn that fails at once still clears it.
    const timer = setTimeout(() => {
      timedOut = true;
      log.warn("proc.command", "command timed out", { limitMs: limit });
      entry.handle?.kill();
    }, limit);

    // Nothing may stop to ask: there is no terminal, so a prompt would hang until the timeout.
    log.info("proc.command", "command spawning", { shell: invocation.shell, chars: text.length, timeoutMs: limit });
    log.debug("proc.command", "invocation", { file: path.basename(invocation.file), args: invocation.args.length });

    entry.handle = spawnStream(
      { file: invocation.file, args: invocation.args, cwd, env: buildEnv(invocation.env), verbatim: invocation.verbatim },
      {
        onStdout: collect,
        onStderr: collect,
        onExit: ({ code, signal, error }) => {
          if (error) {
            log.warn("proc.command", "process error", { code: error.code ?? null, name: error.name ?? null });
            finish({ success: false, error: error.message });
            return;
          }

          const clipped = clip(output);
          finish({
            success: !timedOut && !entry.cancelled && code === 0,
            exitCode: code,
            signal: signal || null,
            timedOut,
            cancelled: entry.cancelled,
            output: clipped.text,
            truncated: clipped.truncated,
          });
        },
      },
    );
  });
}

/** Stops one command and everything it started. False when it had already finished. */
function cancel(id) {
  const entry = live.get(String(id));
  if (!entry) return false;

  log.info("proc.command", "command cancelled", { id: String(id) });
  entry.cancelled = true;
  live.delete(String(id));
  entry.handle?.kill();
  return true;
}

/** Kills every command still going, synchronously, for a quit. */
function stopAll() {
  log.info("proc.command", "stopping commands", { running: live.size });
  for (const [id, entry] of [...live]) {
    live.delete(id);
    entry.cancelled = true;
    if (entry.handle) killTreeSync(entry.handle.child);
  }
}

module.exports = {
  run,
  cancel,
  stopAll,
  shellInvocation,
  findOnPath,
  clip,
  timeoutFor,
  SHELLS: SHELL_IDS,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MAX_OUTPUT_CHARS,
};
