const path = require("path");
const os = require("os");
const fs = require("fs");
const { execFile, spawn } = require("child_process");

const IS_WINDOWS = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const IS_LINUX = process.platform === "linux";

/**
 * Every child process the app starts, with its console window suppressed.
 *
 * A packaged Draggy is a GUI binary with no console of its own, so a console
 * program started without this gets a brand new window that flashes at the user.
 * Going through here means the flag cannot be forgotten at one call site.
 */
function spawnHidden(file, args, options = {}) {
  return spawn(file, args, { ...options, windowsHide: true });
}

/** The same guarantee for the one-shot calls. */
function execFileHidden(file, args, options, callback) {
  return execFile(file, args, { ...options, windowsHide: true }, callback);
}

function runCommand(file, args, timeout) {
  return new Promise((resolve) => {
    execFileHidden(
      file,
      args,
      { encoding: "utf8", timeout },
      (err, stdout) => resolve(err ? null : stdout),
    );
  });
}

function ollamaInstallDirs() {
  if (IS_WINDOWS) {
    return [
      ...new Set(
        [
          process.env.LOCALAPPDATA &&
            path.join(process.env.LOCALAPPDATA, "Programs", "Ollama"),
          path.join(os.homedir(), "AppData", "Local", "Programs", "Ollama"),
          "C:\\Program Files\\Ollama",
        ].filter(Boolean),
      ),
    ];
  }

  if (IS_MAC) {
    return [
      "/Applications/Ollama.app/Contents/Resources",
      "/usr/local/bin",
      "/opt/homebrew/bin",
      path.join(os.homedir(), ".local", "bin"),
    ];
  }

  return [
    "/usr/local/bin",
    "/usr/bin",
    "/opt/ollama/bin",
    path.join(os.homedir(), ".local", "bin"),
  ];
}

function ollamaBinaryName() {
  return IS_WINDOWS ? "ollama.exe" : "ollama";
}

function ollamaLaunchCandidates() {
  return ollamaInstallDirs().map((dir) => ({
    file: path.join(dir, ollamaBinaryName()),
    args: ["serve"],
  }));
}

async function resolveOllamaLauncher() {
  for (const candidate of ollamaLaunchCandidates()) {
    if (fs.existsSync(candidate.file)) return candidate;
  }

  const onPath = await runCommand("ollama", ["--version"], 5000);
  return onPath ? { file: "ollama", args: ["serve"] } : null;
}

async function appleSiliconBudget() {
  const wired = await runCommand("sysctl", ["-n", "iogpu.wired_limit_mb"], 4000);
  const limitMb = wired ? parseInt(wired.trim(), 10) : 0;
  if (!isNaN(limitMb) && limitMb > 0) return limitMb / 1024;

  const totalBytes = os.totalmem();
  const totalGB = totalBytes / 1024 ** 3;

  return totalGB > 36 ? totalGB * 0.75 : totalGB * 0.67;
}

async function macVideoMemory() {
  if (os.arch() === "arm64") return appleSiliconBudget();

  const out = await runCommand(
    "system_profiler",
    ["-json", "SPDisplaysDataType"],
    8000,
  );
  if (!out) return 0;

  try {
    const parsed = JSON.parse(out);
    const displays = parsed?.SPDisplaysDataType || [];
    let best = 0;
    for (const entry of displays) {
      const raw = entry?.spdisplays_vram || entry?.spdisplays_vram_shared || "";
      const match = String(raw).match(/([\d.]+)\s*(GB|MB)/i);
      if (!match) continue;
      const value =
        match[2].toUpperCase() === "GB"
          ? Number(match[1])
          : Number(match[1]) / 1024;
      if (value > best) best = value;
    }
    return best;
  } catch {
    return 0;
  }
}

function linuxAmdVram() {
  try {
    const cards = fs
      .readdirSync("/sys/class/drm")
      .filter((name) => /^card\d+$/.test(name));

    let best = 0;
    for (const card of cards) {
      const file = `/sys/class/drm/${card}/device/mem_info_vram_total`;
      if (!fs.existsSync(file)) continue;
      const bytes = parseInt(fs.readFileSync(file, "utf8").trim(), 10);
      if (!isNaN(bytes)) best = Math.max(best, bytes / 1024 ** 3);
    }
    return best;
  } catch {
    return 0;
  }
}

async function detectVideoMemoryGB() {
  const nvidia = await runCommand(
    "nvidia-smi",
    ["--query-gpu=memory.total", "--format=csv,noheader,nounits"],
    4000,
  );
  if (nvidia) {
    const mib = parseInt(nvidia.trim().split("\n")[0], 10);
    if (!isNaN(mib) && mib > 0) return mib / 1024;
  }

  if (IS_WINDOWS) {
    const script =
      "$m=0;Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue|ForEach-Object{$v=(Get-ItemProperty $_.PSPath -Name 'HardwareInformation.qwMemorySize' -ErrorAction SilentlyContinue).'HardwareInformation.qwMemorySize';if($v -and $v -gt $m){$m=$v}};Write-Output $m";
    const out = await runCommand(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      8000,
    );
    if (out) {
      const bytes = parseInt(out.trim(), 10);
      if (!isNaN(bytes) && bytes > 0) return bytes / 1024 ** 3;
    }
    return 0;
  }

  if (IS_MAC) return macVideoMemory();

  if (IS_LINUX) {
    const amd = linuxAmdVram();
    if (amd > 0) return amd;

    const rocm = await runCommand("rocm-smi", ["--showmeminfo", "vram"], 4000);
    if (rocm) {
      const match = rocm.match(/Total\s*\(?B\)?[^\d]*(\d+)/i);
      if (match) return Number(match[1]) / 1024 ** 3;
    }
  }

  return 0;
}

function hasUnifiedMemory() {
  return IS_MAC && os.arch() === "arm64";
}

const OLLAMA_DOWNLOAD_PAGE = "https://ollama.com/download";

function ollamaInstaller() {
  if (IS_WINDOWS) {
    return {
      mode: "run",
      url: "https://ollama.com/download/OllamaSetup.exe",
      filename: "OllamaSetup.exe",
      args: ["/silent"],
    };
  }

  if (IS_MAC) {
    return {
      mode: "dmg",
      url: "https://ollama.com/download/Ollama.dmg",
      filename: "Ollama.dmg",
      args: [],
    };
  }

  return { mode: "manual", url: OLLAMA_DOWNLOAD_PAGE, filename: "", args: [] };
}

async function installFromDmg(dmgPath) {
  const mountPoint = path.join(os.tmpdir(), "draggy-ollama-mount");

  await runCommand(
    "hdiutil",
    ["attach", dmgPath, "-nobrowse", "-quiet", "-mountpoint", mountPoint],
    120000,
  );

  try {
    const source = path.join(mountPoint, "Ollama.app");
    if (!fs.existsSync(source)) throw new Error("Ollama.app not found in image");

    await runCommand("cp", ["-R", source, "/Applications/"], 180000);
    return fs.existsSync("/Applications/Ollama.app");
  } finally {
    await runCommand("hdiutil", ["detach", mountPoint, "-quiet"], 60000);
  }
}

function defaultShellEnv() {
  if (IS_WINDOWS) return process.env;

  const extraPaths = ["/usr/local/bin", "/opt/homebrew/bin"];
  const current = (process.env.PATH || "").split(path.delimiter);
  const merged = [...new Set([...current, ...extraPaths])].filter(Boolean);

  return { ...process.env, PATH: merged.join(path.delimiter) };
}

/**
 * Where npm keeps the JavaScript behind the `npx` shim, given the shim's folder.
 * Windows ships `npx.cmd`; the real program is this file next to it.
 */
function npmCliFrom(dir, tool) {
  return path.join(dir, "node_modules", "npm", "bin", `${tool}-cli.js`);
}

/**
 * How to run npx without going through its shell script.
 *
 * Node has refused to spawn a `.cmd` since the CVE-2024-27980 fix, so
 * `spawn("npx.cmd")` fails outright with EINVAL on Windows. Running the shim
 * through a shell would work and would put user-supplied paths and connection
 * strings on a command line, so instead the JavaScript behind the shim is run
 * directly by the binary already running this code.
 *
 * Returns null when npm cannot be found, which means MCP servers cannot start
 * and the caller should say so plainly.
 */
function resolveNpmTool(tool) {
  const candidates = [path.dirname(process.execPath)];

  const separator = IS_WINDOWS ? ";" : ":";
  const names = IS_WINDOWS ? ["npx.cmd", "npx.exe", "npx"] : ["npx"];

  for (const dir of String(process.env.PATH || "").split(separator)) {
    if (!dir) continue;
    for (const name of names) {
      try {
        if (fs.existsSync(path.join(dir, name))) candidates.push(dir);
      } catch {
        /* an unreadable PATH entry is not worth failing over */
      }
    }
  }

  for (const dir of candidates) {
    const cli = npmCliFrom(dir, tool);
    try {
      if (fs.existsSync(cli)) {
        // ELECTRON_RUN_AS_NODE makes the packaged binary behave as plain Node,
        // which is how `runner.cjs` runs JavaScript too.
        return { file: process.execPath, prefixArgs: [cli], asNode: true };
      }
    } catch {
      /* keep looking */
    }
  }

  return null;
}

/** How to run npx without its shell shim. Null when npm cannot be found. */
function resolveNpx() {
  return resolveNpmTool("npx");
}

/** The same for npm, which is what installs a server before it is run. */
function resolveNpm() {
  return resolveNpmTool("npm");
}

function pythonCandidates() {
  return IS_WINDOWS ? ["python", "py"] : ["python3", "python"];
}

/**
 * Kills a child and everything it started. Signalling the child alone leaves
 * whatever it spawned running, with nobody left to notice.
 */
function killTree(child) {
  if (!child || child.pid === undefined) return;
  if (child.exitCode !== null || child.signalCode !== null) return;

  if (IS_WINDOWS) {
    execFileHidden("taskkill", ["/pid", String(child.pid), "/T", "/F"], {}, () => {});
    return;
  }

  try {
    // Negative pid means the group, which is why the child was detached.
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* the process is already gone */
    }
  }
}

module.exports = {
  IS_WINDOWS,
  IS_MAC,
  IS_LINUX,
  runCommand,
  ollamaInstallDirs,
  ollamaLaunchCandidates,
  resolveOllamaLauncher,
  detectVideoMemoryGB,
  hasUnifiedMemory,
  ollamaInstaller,
  installFromDmg,
  defaultShellEnv,
  pythonCandidates,
  resolveNpx,
  resolveNpm,
  spawnHidden,
  execFileHidden,
  killTree,
};
