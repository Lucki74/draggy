const path = require("path");
const fs = require("fs");
const { execFile, execFileSync, spawn } = require("child_process");
const { trackChild, trackExec } = require("./spawnLog.cjs");
const { log } = require("./logger.cjs");

const IS_WINDOWS = process.platform === "win32";

/** Every child process, console window hidden and never through a shell. A GUI app starting a console
 * program otherwise flashes a new window; one call site means it cannot be forgotten. */
function spawnHidden(file, args, options = {}) {
  return trackChild(spawn(file, args, { ...options, shell: false, windowsHide: true }), file, args, options);
}

/** The same guarantees for the one-shot calls. */
function execFileHidden(file, args, options, callback) {
  return execFile(file, args, { ...options, shell: false, windowsHide: true }, typeof callback === "function" ? trackExec(file, args, options, callback) : callback);
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

const DISPLAY_CLASS = "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}";

/** The biggest REG_QWORD in `reg query` output, in bytes; 0 when there is none. */
function largestQword(out) {
  let best = 0;
  for (const [, hex] of String(out || "").matchAll(/REG_QWORD\s+0x([0-9a-f]+)/gi)) {
    best = Math.max(best, Number.parseInt(hex, 16));
  }
  return best;
}

/** NVIDIA devices as `index, total MiB` rows from nvidia-smi, biggest card first. */
function parseNvidiaDevices(out) {
  return String(out || "")
    .trim()
    .split("\n")
    .map((line) => line.split(",").map((part) => part.trim()))
    .map(([index, mib]) => ({ index: parseInt(index, 10), totalMiB: parseInt(mib, 10) }))
    .filter((device) => device.index >= 0 && device.totalMiB > 0)
    .sort((a, b) => b.totalMiB - a.totalMiB || a.index - b.index);
}

/** Every NVIDIA card, so an inference engine can be pinned to the dedicated one on a hybrid laptop
 * instead of whichever device a backend happens to enumerate first. Empty without an NVIDIA driver. */
async function nvidiaDevices() {
  const out = await runCommand("nvidia-smi", ["--query-gpu=index,memory.total", "--format=csv,noheader,nounits"], 4000);
  return parseNvidiaDevices(out);
}

async function detectVideoMemoryGB() {
  const [best] = await nvidiaDevices();
  if (best) return best.totalMiB / 1024;

  if (IS_WINDOWS) {
    // reg.exe, not PowerShell: antivirus heuristics block a hidden PowerShell started by an app.
    const reg = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "reg.exe");
    const out = await runCommand(reg, ["query", DISPLAY_CLASS, "/s", "/v", "HardwareInformation.qwMemorySize"], 8000);
    return largestQword(out) / 1024 ** 3;
  }

  return 0;
}

/** Free VRAM right now, for the image engine's check before each job. Null where it cannot be measured. */
async function detectFreeVideoMemoryGB() {
  const nvidia = await runCommand("nvidia-smi", ["--query-gpu=memory.free", "--format=csv,noheader,nounits"], 4000);
  if (nvidia) {
    const mib = parseInt(nvidia.trim().split("\n")[0], 10);
    if (!isNaN(mib) && mib >= 0) return mib / 1024;
  }

  return null;
}

/** The first NVIDIA GPU's compute capability and driver version, from nvidia-smi (installed with the
 * driver). Null when there is no NVIDIA driver or it cannot be asked. */
let nvidiaInfoPromise = null;
function parseNvidiaInfo(out) {
  const [cap, driver] = String(out || "").trim().split("\n")[0].split(",").map((part) => part.trim());
  const computeCapability = parseFloat(cap);
  const driverMajor = parseInt(driver, 10);
  if (!(computeCapability > 0) || !(driverMajor > 0)) return null;
  return { computeCapability, driverVersion: driver, driverMajor };
}
function nvidiaInfo() {
  if (!nvidiaInfoPromise) {
    nvidiaInfoPromise = runCommand(
      "nvidia-smi",
      ["--query-gpu=compute_cap,driver_version", "--format=csv,noheader"],
      5000,
    ).then(parseNvidiaInfo);
  }
  return nvidiaInfoPromise;
}

function defaultShellEnv() {
  return process.env;
}

/** Where npm keeps the JavaScript behind the `npx` shim, given the shim's folder: `npx.cmd` ships
 * with the real program in `node_modules` beside it. */
function npmCliFrom(dir, tool) {
  return [path.join(dir, "node_modules", "npm", "bin", `${tool}-cli.js`)];
}

/** Runs npx's JavaScript directly: Node refuses to spawn a .cmd since CVE-2024-27980, and a shell
 * would put user paths on a command line. Null when npm is missing. */
function resolveNpmTool(tool) {
  const candidates = [path.dirname(process.execPath)];

  const separator = IS_WINDOWS ? ";" : ":";
  const names = IS_WINDOWS ? ["npx.cmd", "npx.exe", "npx"] : ["npx"];

  for (const dir of String(process.env.PATH || "").split(separator)) {
    if (!dir) continue;
    for (const name of names) {
      try {
        if (fs.existsSync(path.join(dir, name))) candidates.push(dir);
      } catch (error) {
        log.swallow("proc", error, "an unreadable PATH entry is not worth failing over");
      }
    }
  }

  for (const dir of candidates) {
    for (const cli of npmCliFrom(dir, tool)) {
      try {
        if (fs.existsSync(cli)) {
          // ELECTRON_RUN_AS_NODE makes the packaged binary behave as plain Node,
          // which is how `runner.cjs` runs JavaScript too.
          return { file: process.execPath, prefixArgs: [cli], asNode: true };
        }
      } catch (error) {
        log.swallow("proc", error, "keep looking");
      }
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

/** Kills a child and everything it started. Signalling the child alone leaves whatever it spawned
 * running, with nobody left to notice. */
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
    } catch (error) {
      log.swallow("proc", error, "the process is already gone");
    }
  }
}

/** The synchronous version, for quitting. A background taskkill died with Draggy before walking the
 * tree, leaving llama-server processes running. */
function killTreeSync(child) {
  if (!IS_WINDOWS) return killTree(child);
  if (!child || child.pid === undefined) return;
  if (child.exitCode !== null || child.signalCode !== null) return;

  try {
    execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      timeout: 10000,
      windowsHide: true,
    });
  } catch (error) {
    log.swallow("proc", error, "the process is already gone");
  }
}

/** Adapters that draw without a GPU: naming one of them would describe the machine wrongly. */
const SOFTWARE_RENDERER = /basic render|swiftshader|llvmpipe|softpipe|microsoft basic/i;

/** The graphics card's name from Electron's GPU report, for telling the user what Draggy sized a
 * model to. The active device first, then the renderer string; null when neither names one. */
function gpuNameFrom(info) {
  const tidy = (name) => String(name).replace(/\((TM|R)\)/gi, "").replace(/\s+/g, " ").trim();
  const devices = (Array.isArray(info?.gpuDevice) ? info.gpuDevice : []).filter(
    (device) => device?.deviceString && !SOFTWARE_RENDERER.test(device.deviceString),
  );
  const device = devices.find((one) => one.active) ?? devices[0];
  if (device) return tidy(device.deviceString);

  const renderer = String(info?.auxAttributes?.glRenderer || "");
  if (!renderer || SOFTWARE_RENDERER.test(renderer)) return null;
  const angle = renderer.match(/^ANGLE \([^,]+, (.+?)(?: \(0x[0-9a-f]+\))?(?: Direct3D| OpenGL| Vulkan|,)/i);
  return tidy(angle ? angle[1] : renderer);
}

/** node-pty is optional: it is loaded on first use, so a machine without its prebuilt binaries (the
 * Linux CI image, an unsupported platform) still runs everything else. Null when it cannot load. */
let ptyModule;
function loadPty() {
  if (ptyModule !== undefined) return ptyModule;
  try {
    ptyModule = require("node-pty");
  } catch (error) {
    log.warn("proc.pty", "node-pty is unavailable", { error: error?.message });
    ptyModule = null;
  }
  return ptyModule;
}

/** An interactive shell on a pseudo-terminal (ConPTY on Windows). The one place a PTY starts, like
 * spawnHidden for pipes. Throws when node-pty cannot load. */
function spawnPty(file, args, options = {}) {
  const pty = loadPty();
  if (!pty) throw new Error("The terminal is not available on this computer.");
  return pty.spawn(file, args, { name: "xterm-256color", cols: 80, rows: 24, ...options, useConpty: true });
}

/** Kills a PTY shell and everything it started. On Windows node-pty kills every process on the
 * console itself, and killing the tree first leaves it nothing to attach to ("AttachConsole failed"). */
function killPty(terminal, sync = false) {
  if (!terminal) return;
  const child = { pid: terminal.pid, exitCode: null, signalCode: null };
  try {
    if (!IS_WINDOWS) (sync ? killTreeSync : killTree)(child);
    terminal.kill();
  } catch (error) {
    log.swallow("proc.pty", error, "the shell is already gone");
  }
}

module.exports = {
  spawnPty,
  killPty,
  ptyAvailable: () => loadPty() !== null,
  gpuNameFrom,
  IS_WINDOWS,
  runCommand,
  detectVideoMemoryGB,
  detectFreeVideoMemoryGB,
  largestQword,
  nvidiaInfo,
  nvidiaDevices,
  parseNvidiaDevices,
  parseNvidiaInfo,
  defaultShellEnv,
  pythonCandidates,
  resolveNpx,
  resolveNpm,
  spawnHidden,
  execFileHidden,
  killTree,
  killTreeSync,
};
