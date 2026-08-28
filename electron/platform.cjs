const path = require("path");
const os = require("os");
const fs = require("fs");
const { execFile } = require("child_process");

const IS_WINDOWS = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const IS_LINUX = process.platform === "linux";

function runCommand(file, args, timeout) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { encoding: "utf8", windowsHide: true, timeout },
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

function pythonCandidates() {
  return IS_WINDOWS ? ["python", "py"] : ["python3", "python"];
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
  OLLAMA_DOWNLOAD_PAGE,
};
