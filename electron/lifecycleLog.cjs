/** What the process and the machine did around the app: crashes, hangs, sleep, startup and quit
 * timing, a snapshot of the computer and a memory sample. Everything takes its Electron parts as
 * arguments so a test can drive it with plain event emitters. */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { log, noteStat } = require("./logger.cjs");

const MEMORY_SAMPLE_MS = 5 * 60 * 1000;
const HEAP_GROWTH_WARN_BYTES = 300 * 1024 * 1024;
const HOUR_MS = 60 * 60 * 1000;
const DUMP_AGE_LIMIT_MS = 14 * 24 * 60 * 60 * 1000;

/** The host of a URL and nothing else. A full URL can carry a query with a token or a search. */
function hostOf(url) {
  try {
    return new URL(String(url)).host || "unknown";
  } catch {
    return "unknown";
  }
}

/** Native crashes leave a dump in `userData/Crashpad`; nothing is uploaded. Returns whether it started. */
function startCrashReporter(crashReporter, app) {
  try {
    crashReporter.start({ uploadToServer: false, submitURL: "", compress: true });
    log.info("lifecycle", "crash reporter on", { dumps: app.getPath("crashDumps"), upload: false });
    return true;
  } catch (error) {
    log.fail("lifecycle", "crash reporter did not start", error);
    return false;
  }
}

/** Every .dmp under the crash folder, newest first. */
function findDumps(app, { fsModule = fs } = {}) {
  const found = [];
  try {
    const walk = (dir, depth) => {
      if (depth > 3) return;
      for (const entry of fsModule.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, depth + 1);
        else if (entry.name.endsWith(".dmp")) found.push({ file: full, mtime: fsModule.statSync(full).mtimeMs });
      }
    };
    walk(app.getPath("crashDumps"), 0);
  } catch (error) {
    log.swallow("lifecycle", error, "no crash dump folder to read");
  }
  return found.sort((a, b) => b.mtime - a.mtime);
}

/** Dumps written since the previous session began, newest first. Called once at boot. */
function reportPreviousDumps(app, previousSession, { fsModule = fs, now = Date.now() } = {}) {
  const since = previousSession ? Date.parse(previousSession) : now - DUMP_AGE_LIMIT_MS;
  const fresh = findDumps(app, { fsModule }).filter((dump) => dump.mtime >= since).slice(0, 5);
  for (const dump of fresh) {
    log.warn("lifecycle", "native crash dump from an earlier run", { file: dump.file, at: new Date(dump.mtime).toISOString() });
  }
  return fresh.map((dump) => dump.file);
}

/** Process-wide events: other processes dying, renderers dying, windows hanging, pages failing. */
function watchApp(app) {
  app.on("child-process-gone", (_event, details) => {
    log.error("lifecycle", `${details.type} process gone: ${details.reason}`, {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      serviceName: details.serviceName,
      name: details.name,
    });
  });

  app.on("render-process-gone", (_event, webContents, details) => {
    log.error("lifecycle", `renderer gone: ${details.reason}`, {
      reason: details.reason,
      exitCode: details.exitCode,
      host: hostOf(safeUrl(webContents)),
    });
  });

  app.on("browser-window-created", (_event, win) => watchWindow(win));

  app.on("web-contents-created", (_event, contents) => {
    contents.on("did-fail-load", (_e, code, description, url, isMainFrame) => {
      // -3 is a navigation the page cancelled itself, not a failure.
      if (code === -3) return;
      log.warn("lifecycle", "page failed to load", { code, description, host: hostOf(url), mainFrame: isMainFrame });
    });
    contents.on("certificate-error", (_e, url, error) => {
      log.warn("lifecycle", "certificate error", { error, host: hostOf(url) });
    });
  });
}

function safeUrl(contents) {
  try {
    return contents.getURL();
  } catch {
    return "";
  }
}

/** Logs how long a window stayed unresponsive. */
function watchWindow(win, now = () => Date.now()) {
  let hungAt = null;
  win.on("unresponsive", () => {
    hungAt = now();
    log.warn("lifecycle", "window stopped responding", { title: safeTitle(win) });
  });
  win.on("responsive", () => {
    const hungMs = hungAt === null ? undefined : now() - hungAt;
    hungAt = null;
    log.info("lifecycle", "window responding again", { hungMs, title: safeTitle(win) });
  });
}

function safeTitle(win) {
  try {
    return win.getTitle();
  } catch {
    return "";
  }
}

/** Sleep and power changes. Engines and HTTP streams often die across a sleep. */
function watchPower(powerMonitor, now = () => Date.now()) {
  let suspendedAt = null;
  const note = (event) => () => log.info("power", event);
  powerMonitor.on("suspend", () => {
    suspendedAt = now();
    log.info("power", "suspend");
  });
  powerMonitor.on("resume", () => {
    const sleptMs = suspendedAt === null ? undefined : now() - suspendedAt;
    suspendedAt = null;
    log.info("power", "resume", { sleptMs });
  });
  for (const event of ["lock-screen", "unlock-screen", "on-battery", "on-ac"]) powerMonitor.on(event, note(event));
}

/** Timed marks for one run of a sequence, printed as a single line when it ends. */
function createTimeline(name, { now = () => performance.now(), startedAt = 0, scope = "lifecycle" } = {}) {
  const marks = [];
  let done = false;
  return {
    mark(label) {
      if (done || marks.some((entry) => entry.label === label)) return;
      marks.push({ label, at: Math.round(now() - startedAt) });
    },
    has: (label) => marks.some((entry) => entry.label === label),
    finish(extra = {}) {
      if (done) return null;
      done = true;
      const total = marks.length ? marks[marks.length - 1].at : Math.round(now() - startedAt);
      let previous = 0;
      const steps = marks.map((entry) => {
        const step = `${entry.label} ${entry.at - previous}`;
        previous = entry.at;
        return step;
      });
      const line = `${name} ${total} ms (${steps.join(", ")})`;
      log.info(scope, line, { durMs: total, marks: Object.fromEntries(marks.map((entry) => [entry.label, entry.at])), ...extra });
      return line;
    },
    marks: () => marks.slice(),
  };
}

/** One INFO line per boot describing the computer. Every probe is optional and failures are skipped. */
async function logMachineSnapshot({ app, screen, platform, modelsDir, statfs = fs.promises.statfs }) {
  const data = {
    cpu: undefined,
    cores: undefined,
    ramTotalGB: round(os.totalmem() / 1024 ** 3),
    ramFreeGB: round(os.freemem() / 1024 ** 3),
    os: `${process.platform} ${os.release()}`,
    arch: os.arch(),
    locale: safe(() => app.getLocale()),
  };
  try {
    const cpus = os.cpus();
    data.cpu = cpus[0]?.model?.trim();
    data.cores = cpus.length;
  } catch {
    // no CPU list on this platform
  }
  data.displays = safe(() => screen.getAllDisplays().map((d) => ({ w: d.size.width, h: d.size.height, scale: d.scaleFactor })));
  data.vramGB = await safeAsync(() => platform.detectVideoMemoryGB());
  data.gpu = await safeAsync(async () => {
    const info = await Promise.race([app.getGPUInfo("basic"), new Promise((resolve) => setTimeout(resolve, 3000, null))]);
    const device = info?.gpuDevice?.find((d) => d.active) ?? info?.gpuDevice?.[0];
    return device ? { vendorId: device.vendorId, deviceId: device.deviceId, driver: device.driverVersion } : undefined;
  });
  if (modelsDir) {
    data.modelsDiskFreeGB = await safeAsync(async () => {
      const stats = await statfs(modelsDir);
      return round((stats.bavail * stats.bsize) / 1024 ** 3);
    });
  }
  log.info("lifecycle", "machine", data);
  return data;
}

const round = (value) => Math.round(value * 10) / 10;
function safe(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
async function safeAsync(fn) {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

/** Memory every five minutes at DEBUG, and a WARN when the main heap grows by 300 MB within an hour. */
function startMemorySampler({ app, getChildren = () => [], sampleChild, intervalMs = MEMORY_SAMPLE_MS, now = () => Date.now(), usage = () => process.memoryUsage() }) {
  const history = [];
  const sample = async () => {
    try {
      const memory = usage();
      const at = now();
      history.push({ at, heap: memory.heapUsed });
      while (history.length && at - history[0].at > HOUR_MS) history.shift();
      const growth = memory.heapUsed - Math.min(...history.map((entry) => entry.heap));
      const processes = safe(() => app.getAppMetrics().map((m) => ({ type: m.type, workingSetMB: Math.round((m.memory?.workingSetSize ?? 0) / 1024) })));
      const children = [];
      for (const child of getChildren()) {
        const rssMB = sampleChild ? await safeAsync(() => sampleChild(child.pid)) : undefined;
        children.push({ bin: child.bin, pid: child.pid, rssMB });
      }
      noteStat("peakMB", Math.round((memory.rss + 0) / 1048576));
      log.debug("lifecycle", "memory", {
        rssMB: Math.round(memory.rss / 1048576),
        heapMB: Math.round(memory.heapUsed / 1048576),
        externalMB: Math.round(memory.external / 1048576),
        processes,
        children,
      });
      if (growth > HEAP_GROWTH_WARN_BYTES) {
        log.warn("lifecycle", "main heap grew a lot within an hour", { growthMB: Math.round(growth / 1048576), heapMB: Math.round(memory.heapUsed / 1048576) });
      }
    } catch (error) {
      log.swallow("lifecycle", error, "memory sample failed");
    }
  };
  const timer = setInterval(sample, intervalMs);
  timer.unref?.();
  return { sample, stop: () => clearInterval(timer) };
}

/** Resident memory of one process in MB, read with the platform's own tool. */
async function childRssMB(run, pid) {
  if (process.platform === "win32") {
    const out = await run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], 4000);
    const cell = out && out.trim().split(",").pop();
    const kb = cell ? parseInt(cell.replace(/[^0-9]/g, ""), 10) : NaN;
    return Number.isFinite(kb) ? Math.round(kb / 1024) : undefined;
  }
  const out = await run("ps", ["-o", "rss=", "-p", String(pid)], 4000);
  const kb = out ? parseInt(out.trim(), 10) : NaN;
  return Number.isFinite(kb) ? Math.round(kb / 1024) : undefined;
}

module.exports = {
  childRssMB,
  hostOf,
  startCrashReporter,
  reportPreviousDumps,
  findDumps,
  watchApp,
  watchWindow,
  watchPower,
  createTimeline,
  logMachineSnapshot,
  startMemorySampler,
};
