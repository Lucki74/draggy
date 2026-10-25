const fs = require("fs");
const path = require("path");
const { IS_WINDOWS } = require("./platform.cjs");
const { log } = require("./logger.cjs");

/** Shells run_command accepts. src/terminal/shells.ts repeats this list, and shells.test.js keeps them equal. */
const SHELL_IDS = ["pwsh", "powershell", "cmd", "bash", "sh"];

/** Folders where Git for Windows installs, in the order they are tried. */
const GIT_EXE_FOLDERS = ["cmd", "bin"];

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
      } catch (error) {
        log.swallow("proc.shell", error, "missing or unreadable: the next directory may have it");
      }
    }
  }
  return null;
}

/** The Git for Windows folders a standard installer writes to. */
function standardGitRoots(env = process.env) {
  return [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs")]
    .filter(Boolean)
    .map((root) => path.join(root, "Git"));
}

/** The Git for Windows folder that holds git.exe: a standard install first, then the one PATH
 * points at (...\Git\cmd\git.exe gives ...\Git). Null when Git is not installed. */
function findGitRoot(env = process.env, exists = fs.existsSync) {
  const installed = standardGitRoots(env).find((root) =>
    GIT_EXE_FOLDERS.some((folder) => exists(path.join(root, folder, "git.exe"))),
  );
  if (installed) return installed;

  const dirs = String(env.PATH || env.Path || "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    if (!exists(path.join(dir, "git.exe"))) continue;
    const root = path.dirname(dir);
    if (GIT_EXE_FOLDERS.includes(path.basename(dir).toLowerCase()) && path.basename(root).toLowerCase() === "git") return root;
  }
  return null;
}

/** The git.exe inside the Git for Windows folder, or null. Used when git is not on PATH. */
function findGitExe(env = process.env, exists = fs.existsSync) {
  const root = findGitRoot(env, exists);
  if (!root) return null;
  const folder = GIT_EXE_FOLDERS.find((name) => exists(path.join(root, name, "git.exe")));
  return path.join(root, folder, "git.exe");
}

/** Bash and sh on Windows come from Git for Windows. The bash in System32 is WSL's, which runs in
 * another file system and would not find the project. */
function findWindowsPosixShell(name, env = process.env, exists = fs.existsSync) {
  const roots = [...new Set([findGitRoot(env, exists), ...standardGitRoots(env)].filter(Boolean))];

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

  let shell = SHELL_IDS.includes(requested) ? requested : "default";
  let notice;

  if (shell === "default") {
    if (windows) {
      // The Default shell setting first, then bash when Git for Windows has it, then PowerShell.
      const preferred = SHELL_IDS.includes(options.defaultShell) ? options.defaultShell : null;
      if (preferred && (preferred === "cmd" || find(preferred))) {
        shell = preferred;
      } else {
        if (preferred) notice = `${preferred} is not installed, so commands run in ${find("bash") ? "bash" : "PowerShell"} instead. Change the default shell in Settings.`;
        shell = find("bash") ? "bash" : find("pwsh") ? "pwsh" : "powershell";
      }
    } else {
      // The user's own shell, as a login shell, so PATH matches their terminal.
      const own = env.SHELL && (options.exists || fs.existsSync)(env.SHELL) ? env.SHELL : find("bash") || "/bin/sh";
      return { shell: path.basename(own), file: own, args: ["-lc", command] };
    }
  }

  if (shell === "pwsh" || shell === "powershell") {
    const file = find(shell);
    if (!file) return { error: `${shell} is not installed on this computer.` };

    // Output as UTF-8, or Windows PowerShell hands back the console's code page. Bypass lets npm's
    // .ps1 shims run under the default Restricted policy, for this process only. "-Command" does not
    // pass a native program's exit code on, so the last status is read back and returned.
    const utf8 = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ";
    const status = "\nif ($?) { exit 0 } elseif ($LASTEXITCODE) { exit $LASTEXITCODE } else { exit 1 }";
    const base = ["-NoLogo", "-NoProfile", "-NonInteractive"];
    const args = windows ? [...base, "-ExecutionPolicy", "Bypass", "-Command", utf8 + command + status] : [...base, "-Command", utf8 + command];
    return { shell, file, args, ...(notice ? { notice } : {}) };
  }

  if (shell === "cmd") {
    if (!windows) return { error: "cmd is only available on Windows." };
    return { shell, file: env.ComSpec || env.COMSPEC || "cmd.exe", args: ["/d", "/s", "/c", `"${command}"`], verbatim: true, ...(notice ? { notice } : {}) };
  }

  const file = find(shell);
  if (!file) return { error: `${shell} is not installed on this computer.` };
  // No profile files, so the user's prompt and aliases cannot change what a command does, and no
  // path rewriting, so "/c" and "--flag=/x" reach programs as written.
  if (!windows) return { shell, file, args: ["-c", command] };
  return {
    shell,
    file,
    args: shell === "bash" ? ["--noprofile", "--norc", "-c", command] : ["-c", command],
    env: { MSYS_NO_PATHCONV: "1" },
    ...(notice ? { notice } : {}),
  };
}

/** The shells a terminal can open on this computer. PowerShell and pwsh are one entry: pwsh when it
 * is installed, Windows PowerShell otherwise. */
function availableShells(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const windows = platform === "win32";
  const find = options.find || ((name) => (windows && (name === "bash" || name === "sh") ? findWindowsPosixShell(name, env) : findOnPath(name, env)));

  const found = [];
  const powershell = find("pwsh") ? "pwsh" : windows || find("powershell") ? "powershell" : null;
  if (powershell) found.push(powershell);
  if (windows) found.push("cmd");
  if (find("bash")) found.push("bash");
  if (find("sh")) found.push("sh");
  return found;
}

module.exports = {
  SHELL_IDS,
  availableShells,
  findOnPath,
  findGitRoot,
  findGitExe,
  findWindowsPosixShell,
  shellInvocation,
};
