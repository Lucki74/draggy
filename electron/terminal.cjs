const path = require("path");
const fs = require("fs");
const { IS_WINDOWS, killTree, spawnHidden } = require("./platform.cjs");

/** Interactive terminal sessions run hidden in the project folder. Every child process
 * goes through spawnHidden so no console window flashes at the user. */

const sessions = new Map();

function findExecutable(name, env = process.env) {
  const dirs = String(env.PATH || env.Path || "").split(path.delimiter).filter(Boolean);
  const extensions = IS_WINDOWS && !path.extname(name)
    ? String(env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean)
    : [""];

  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, `${name}${ext.toLowerCase()}`);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // Missing or unreadable, check next candidate.
      }
    }
  }
  return null;
}

function resolveShell() {
  if (IS_WINDOWS) {
    const pwsh = findExecutable("pwsh");
    if (pwsh) return { file: pwsh, args: ["-NoLogo", "-NoExit"] };
    const powershell = findExecutable("powershell") || "powershell.exe";
    return { file: powershell, args: ["-NoLogo", "-NoExit"] };
  }
  const bash = findExecutable("bash") || "/bin/sh";
  return { file: bash, args: ["-l"] };
}

function spawnTerminal(id, cwd, onData, onExit) {
  killTerminal(id);

  const shell = resolveShell();
  const targetCwd = cwd && fs.existsSync(cwd) ? cwd : process.cwd();

  const child = spawnHidden(shell.file, shell.args, {
    cwd: targetCwd,
    env: { ...process.env, TERM: "xterm-256color" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  sessions.set(id, { child, id });

  child.stdout?.on("data", (chunk) => {
    onData(id, chunk.toString("utf8"));
  });

  child.stderr?.on("data", (chunk) => {
    onData(id, chunk.toString("utf8"));
  });

  child.on("close", (code) => {
    sessions.delete(id);
    onExit(id, code ?? 0);
  });

  child.on("error", (error) => {
    onData(id, `\r\nError: ${error.message}\r\n`);
    sessions.delete(id);
    onExit(id, 1);
  });

  return { success: true, id, shell: path.basename(shell.file) };
}

function writeTerminal(id, data) {
  const session = sessions.get(id);
  if (!session?.child?.stdin?.writable) return false;
  session.child.stdin.write(String(data));
  return true;
}

function killTerminal(id) {
  const session = sessions.get(id);
  if (!session) return false;
  sessions.delete(id);
  if (session.child.pid) {
    killTree(session.child.pid).catch(() => {});
  }
  return true;
}

function killAll() {
  for (const [id] of sessions) {
    killTerminal(id);
  }
}

module.exports = {
  spawnTerminal,
  writeTerminal,
  killTerminal,
  killAll,
  resolveShell,
};
