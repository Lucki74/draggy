const fs = require("fs");
const path = require("path");
const { IS_WINDOWS, defaultShellEnv, killTree, killTreeSync, spawnHidden } = require("./platform.cjs");
const { log } = require("./logger.cjs");

/** Commands the model runs in a project: a real shell in the project folder, with no terminal to
 * wait on, stoppable, and output cut to a size a model can read. */

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_CHARS = 30_000;
const HEAD_CHARS = 8_000;
const MAX_COMMAND_CHARS = 8_000;

const SHELLS = ["pwsh", "powershell", "cmd", "bash", "sh"];

/** An executable on PATH, or null. On Windows the extensions come from PATHEXT. */
function findOnPath(name, env = process.env) {
  const dirs = String(env.PATH || env.Path || "").split(path.delimiter).filter(Boolean);
  const extensions =
    IS_WINDOWS && !path.extname(name)
      ? String(env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean)
      : [""];

  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = path.join(dir, `${name}${extension.toLowerCase()}`);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // Missing or unreadable: the next directory may have it.
      }
    }
  }
  return null;
}

/** Bash and sh on Windows come from Git for Windows. The bash in System32 is WSL's, which runs in
 * another file system and would not find the project. */
function findWindowsPosixShell(name, env = process.env, exists = fs.existsSync) {
  const roots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs")]
    .filter(Boolean)
    .map((root) => path.join(root, "Git"));

  for (const root of roots) {
    for (const candidate of [path.join(root, "bin", `${name}.exe`), path.join(root, "usr", "bin", `${name}.exe`)]) {
      if (exists(candidate)) return candidate;
    }
  }

  const onPath = findOnPath(name, env);
  return onPath && !/[\\/]system32[\\/]/i.test(onPath) ? onPath : null;
}

/** The program and arguments that run a command in the shell asked for. Lookups are passed in, so
 * the choice can be tested on any platform. */
function shellInvocation(command, requested, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const windows = platform === "win32";
  const find = options.find || ((name) => (windows && (name === "bash" || name === "sh") ? findWindowsPosixShell(name, env) : findOnPath(name, env)));

  let shell = SHELLS.includes(requested) ? requested : "default";

  if (shell === "default") {
    if (windows) {
      shell = find("pwsh") ? "pwsh" : "powershell";
    } else {
      // The user's own shell, as a login shell, so PATH matches their terminal.
      const own = env.SHELL && (options.exists || fs.existsSync)(env.SHELL) ? env.SHELL : find("bash") || "/bin/sh";
      return { shell: path.basename(own), file: own, args: ["-lc", command] };
    }
  }

  if (shell === "pwsh" || shell === "powershell") {
    const file = find(shell);
    if (!file) return { error: `${shell} is not installed on this computer.` };

    // Output as UTF-8, or Windows PowerShell hands back the console's code page.
    const utf8 = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ";
    return { shell, file, args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", utf8 + command] };
  }

  if (shell === "cmd") {
    if (!windows) return { error: "cmd is only available on Windows." };
    return { shell, file: env.ComSpec || env.COMSPEC || "cmd.exe", args: ["/d", "/s", "/c", `"${command}"`], verbatim: true };
  }

  const file = find(shell);
  if (!file) return { error: `${shell} is not installed on this computer.` };
  return { shell, file, args: ["-c", command] };
}

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

function run({ id, cwd, command, shell, timeoutMs }) {
  const text = String(command || "");
  if (!text.trim()) return Promise.resolve({ success: false, error: "No command was given." });
  if (text.length > MAX_COMMAND_CHARS) {
    return Promise.resolve({ success: false, error: "That command is too long to run." });
  }
  if (!cwd || !fs.existsSync(cwd)) {
    return Promise.resolve({ success: false, error: "The project folder is not available." });
  }

  const invocation = shellInvocation(text, shell);
  if (invocation.error) return Promise.resolve({ success: false, error: invocation.error });

  const limit = timeoutFor(timeoutMs);
  const started = Date.now();

  // Nothing may stop to ask: there is no terminal, so a prompt would hang until the timeout.
  const env = {
    ...defaultShellEnv(),
    GIT_TERMINAL_PROMPT: "0",
    GH_PROMPT_DISABLED: "1",
    GIT_PAGER: "cat",
    PAGER: "cat",
    NO_COLOR: "1",
    TERM: "dumb",
  };
  delete env.ELECTRON_RUN_AS_NODE;

  return new Promise((resolve) => {
    let child;
    try {
      log.info("command", `Spawning: ${command.slice(0, 80)} in ${cwd} (${invocation.shell})`);
      log.debug("command", `Invocation: ${invocation.file} ${invocation.args.join(" ")}`);
      child = spawnHidden(invocation.file, invocation.args, {
        cwd,
        env,
        detached: !IS_WINDOWS,
        stdio: ["ignore", "pipe", "pipe"],
        windowsVerbatimArguments: Boolean(invocation.verbatim),
      });
    } catch (error) {
      log.error("command", `Spawn failed: ${error.message}`, error);
      resolve({ success: false, error: error.message, shell: invocation.shell });
      return;
    }

    const key = id ? String(id) : null;
    if (key) live.set(key, child);

    let output = "";
    let timedOut = false;

    const collect = (chunk) => {
      output += chunk.toString("utf8");
      // Kept bounded while it runs: the start, and a generous end.
      if (output.length > MAX_OUTPUT_CHARS * 3) {
        output = output.slice(0, HEAD_CHARS) + output.slice(-(MAX_OUTPUT_CHARS * 2));
      }
    };

    child.stdout.on("data", (chunk) => {
      collect(chunk);
      log.debug("command:out", chunk.toString("utf8").trim());
    });
    child.stderr.on("data", (chunk) => {
      collect(chunk);
      log.debug("command:err", chunk.toString("utf8").trim());
    });

    const timer = setTimeout(() => {
      timedOut = true;
      log.warn("command", `Command timed out after ${limit}ms`);
      killTree(child);
    }, limit);

    const finish = (result) => {
      clearTimeout(timer);
      if (key && live.get(key) === child) live.delete(key);
      const durationMs = Date.now() - started;
      log.info("command", `Finished in ${durationMs}ms (exitCode: ${result.exitCode ?? "none"})`);
      resolve({ ...result, shell: invocation.shell, durationMs });
    };

    child.on("error", (error) => {
      log.error("command", `Process error: ${error.message}`, error);
      finish({ success: false, error: error.message });
    });

    child.on("close", (code, signal) => {
      const clipped = clip(output);
      finish({
        success: !timedOut && !child.cancelled && code === 0,
        exitCode: code,
        signal: signal || null,
        timedOut,
        cancelled: Boolean(child.cancelled),
        output: clipped.text,
        truncated: clipped.truncated,
      });
    });
  });
}

/** Stops one command and everything it started. False when it had already finished. */
function cancel(id) {
  const child = live.get(String(id));
  if (!child) return false;

  log.info("command", `Cancelling command: ${id}`);
  child.cancelled = true;
  live.delete(String(id));
  killTree(child);
  return true;
}

/** Kills every command still going, synchronously, for a quit. */
function stopAll() {
  log.info("command", `Stopping all ${live.size} running commands`);
  for (const [id, child] of [...live]) {
    live.delete(id);
    child.cancelled = true;
    killTreeSync(child);
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
  SHELLS,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MAX_OUTPUT_CHARS,
};
