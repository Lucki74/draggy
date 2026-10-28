const fs = require("fs");
const path = require("path");
const { killTreeSync } = require("./platform.cjs");
const { buildEnv, spawnStream } = require("./exec.cjs");
const { SHELL_IDS, findOnPath, shellInvocation } = require("./shells.cjs");
const { log } = require("./logger.cjs");
const crypto = require("crypto");
const taskText = require("./taskText.cjs");

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

/** Where each chat's commands left off: the folder and the environment changes. Kept per shell for the
 * environment, because Git Bash and PowerShell write the same variable (PATH) in different forms. */
const shellState = new Map();

/** `/d/work` or `D:/work` from Git Bash is `D:\work` to everything else. Other paths are left alone. */
function fromShellPath(value, platform = process.platform) {
  const text = String(value || "");
  if (platform !== "win32") return text;
  if (/^[a-zA-Z]:\//.test(text)) return text.replace(/\//g, "\\");
  const drive =/^\/(?:mnt\/)?([a-zA-Z])(?:\/(.*))?$/.exec(text);
  if (!drive) return text;
  return `${drive[1].toUpperCase()}:\\${(drive[2] || "").replace(/\//g, "\\")}`;
}

function insideRoot(root, folder) {
  const relative = path.relative(path.resolve(root), path.resolve(folder));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** The folder the next command starts in: where the last one ended, if that is still inside the project. */
function startFolder(root, stateKey) {
  const saved = stateKey ? shellState.get(stateKey) : null;
  if (saved?.cwd && insideRoot(root, saved.cwd) && fs.existsSync(saved.cwd)) return saved.cwd;
  return root;
}

function resetState(stateKey) {
  return shellState.delete(String(stateKey));
}

/** `onOutput` gets each piece of output as it arrives, for a pane that shows a command running.
 * `tasks` (the task manager) lets a command be handed over to run in the background; `autoDetach`
 * does that at the time limit instead of stopping the command. `stateKey` names the chat whose folder
 * and environment carry over from one command to the next. */
function run({ id, cwd, command, shell, defaultShell, timeoutMs, onOutput, chatId, stateKey, tasks, autoDetach }) {
  const text = String(command || "");
  if (!text.trim()) return Promise.resolve({ success: false, error: "No command was given." });
  if (text.length > MAX_COMMAND_CHARS) {
    return Promise.resolve({ success: false, error: "That command is too long to run." });
  }
  if (!cwd || !fs.existsSync(cwd)) {
    return Promise.resolve({ success: false, error: "The project folder is not available." });
  }

  const plain = shellInvocation(text, shell, { defaultShell });
  if (plain.error) return Promise.resolve({ success: false, error: plain.error });

  // The shell reports its final folder and environment after the command, under a marker that only
  // this run knows, so the command's own output cannot pass for the report.
  const marker = stateKey && taskText.supportsState(plain.shell) ? `DG${crypto.randomBytes(6).toString("hex")}` : null;
  const invocation = marker
    ? shellInvocation(text + taskText.stateEpilogue(plain.shell, marker), shell, { defaultShell })
    : plain;
  if (invocation.error) return Promise.resolve({ success: false, error: invocation.error });

  // A second run under the same id would overwrite the first one's entry and orphan it.
  const key = id ? String(id) : null;
  if (key && live.has(key)) {
    return Promise.resolve({ success: false, error: "A command with that id is already running." });
  }

  const limit = timeoutFor(timeoutMs);
  const started = Date.now();
  const entry = { handle: null, cancelled: false, detach: null };
  if (key) live.set(key, entry);

  const saved = marker ? shellState.get(stateKey) : null;
  const envDiff = saved?.env?.[invocation.shell] || null;
  const pristine = buildEnv(invocation.env);
  const childEnv = envDiff ? taskText.applyEnvDiff(pristine, envDiff) : pristine;
  const folder = marker ? startFolder(cwd, stateKey) : cwd;

  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    let settled = false;
    let sink = null;
    let filter = null;

    const collect = (chunk) => {
      if (sink) {
        const shown = filter ? filter.push(chunk) : String(chunk);
        if (shown) sink.push(shown);
        return;
      }
      output += chunk;
      onOutput?.(String(chunk));
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

    // Hands the running process to the task manager. The output so far goes with it, and the run resolves
    // at once so the model can carry on.
    entry.detach = () => {
      if (settled || sink || !tasks) return { success: false, error: "This command cannot be moved to the background." };
      filter = marker ? taskText.createStateFilter(marker) : null;
      const shown = filter ? filter.push(output) + filter.end() : output;
      filter = marker ? taskText.createStateFilter(marker) : null;
      const adopted = tasks.adopt({
        chatId: chatId || stateKey || "default",
        command: text,
        shell: invocation.shell,
        cwd: folder,
        output: shown,
        kill: () => entry.handle?.kill(),
      });
      if (adopted.error) return { success: false, error: adopted.error };
      sink = { push: adopted.push, exit: adopted.exit };
      log.info("proc.command", "command moved to the background", { taskId: adopted.task.id });
      finish({
        success: true,
        detached: true,
        taskId: adopted.task.id,
        output: taskText.cleanOutput(shown),
        truncated: false,
      });
      return { success: true, taskId: adopted.task.id };
    };

    // Set before the spawn, so a spawn that fails at once still clears it.
    const timer = setTimeout(() => {
      if (autoDetach && tasks && entry.detach().success) return;
      timedOut = true;
      log.warn("proc.command", "command timed out", { limitMs: limit });
      entry.handle?.kill();
    }, limit);

    // Nothing may stop to ask: there is no terminal, so a prompt would hang until the timeout.
    log.info("proc.command", "command spawning", { shell: invocation.shell, chars: text.length, timeoutMs: limit });
    log.debug("proc.command", "invocation", { file: path.basename(invocation.file), args: invocation.args.length });

    entry.handle = spawnStream(
      { file: invocation.file, args: invocation.args, cwd: folder, env: childEnv, verbatim: invocation.verbatim },
      {
        onStdout: collect,
        onStderr: collect,
        onExit: ({ code, signal, error }) => {
          if (sink) {
            const rest = filter ? filter.end() : "";
            if (rest) sink.push(rest);
            sink.exit({ code, signal: signal || null, error: error ? error.message : null });
            return;
          }
          if (error) {
            log.warn("proc.command", "process error", { code: error.code ?? null, name: error.name ?? null });
            finish({ success: false, error: error.message });
            return;
          }

          let shown = output;
          if (marker) {
            const parsed = taskText.parseState(output, marker);
            shown = parsed.output;
            if (parsed.state) {
              const next = fromShellPath(parsed.state.cwd);
              const diff = taskText.envDiff(pristine, parsed.state.env);
              shellState.set(stateKey, {
                cwd: insideRoot(cwd, next) && fs.existsSync(next) ? next : saved?.cwd || null,
                env: { ...(saved?.env || {}), [invocation.shell]: diff },
                note: insideRoot(cwd, next) ? null : next,
              });
            }
          }
          const clipped = clip(shown);
          finish({
            success: !timedOut && !entry.cancelled && code === 0,
            exitCode: code,
            signal: signal || null,
            timedOut,
            cancelled: entry.cancelled,
            output: clipped.text,
            truncated: clipped.truncated,
            ...(marker && shellState.get(stateKey)?.note ? { outside: shellState.get(stateKey).note } : {}),
          });
        },
      },
    );
  });
}

/** Moves a running command to the background. False when it has already finished or cannot move. */
function detach(id) {
  const entry = live.get(String(id));
  if (!entry?.detach) return { success: false, error: "That command is not running." };
  return entry.detach();
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
  detach,
  resetState,
  fromShellPath,
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
