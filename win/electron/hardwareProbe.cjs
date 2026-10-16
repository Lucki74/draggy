const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const platform = require("./platform.cjs");
const { getCpuTopology } = require("./cpuTopology.cjs");
const { log } = require("./logger.cjs");

/**
 * What this computer can offer a model that is larger than its memory: RAM, VRAM, the drives with their
 * bus and free space, and how fast each drive really reads. Only the benchmark writes anything (a
 * temporary file), and it runs only when the user starts it.
 */
const CACHE_FILE = "disk-bench.json";
const CACHE_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const BLOCK = 16 * 1024 * 1024;
const SECTOR = 4096;
const REG_TIMEOUT_MS = 5000;

const REG = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "reg.exe");
const SAC_KEY = "HKLM\\SYSTEM\\CurrentControlSet\\Control\\CI\\Policy";
const MOUNTED_KEY = "HKLM\\SYSTEM\\MountedDevices";
const DISK_ENUM_KEY = "HKLM\\SYSTEM\\CurrentControlSet\\Services\\disk\\Enum";

/** Where a model may live: USB drives disconnect, SATA works but is slow. */
const BUS_ROLES = { nvme: "good", sata: "slow", usb: "refuse", unknown: "unknown" };

/**
 * Windows is asked through reg.exe and never PowerShell, which antivirus blocks when an app starts it
 * (spawning.test.js). The registry says which letters are local volumes, which of them sit on USB
 * storage, and what bus and model each disk has. It does not say which disk a letter is on, so a
 * volume is tied to its disk only when the computer has a single internal one.
 */
function parseMountedDevices(text) {
  const letters = new Map();
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = /^\s*\\DosDevices\\([A-Za-z]):\s+REG_BINARY\s+([0-9A-Fa-f]+)\s*$/.exec(line);
    if (!match) continue;
    const bytes = Buffer.from(match[2], "hex");
    // A device path is UTF-16 text starting with \??\ ; a fixed disk is a partition id.
    const devicePath = bytes.length > 8 && bytes[0] === 0x5f && bytes[1] === 0 ? bytes.toString("utf16le") : "";
    if (/cdrom|floppy/i.test(devicePath)) continue;
    letters.set(match[1].toUpperCase(), { usb: /usbstor/i.test(devicePath) });
  }
  return letters;
}

/** `reg query ...\disk\Enum`: "0  REG_SZ  SCSI\Disk&Ven_NVMe&Prod_SAMSUNG_MZVL21T0\4&..." per disk. */
function parseDiskEnum(text) {
  const disks = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+REG_SZ\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const instance = match[2];
    const usb = /^USBSTOR\\/i.test(instance);
    const bus = usb ? "usb" : /Ven_NVMe/i.test(instance) || /^NVME\\/i.test(instance) ? "nvme" : /^(SCSI|IDE)\\/i.test(instance) ? "sata" : "unknown";
    const name = (/Prod_([^&\\]+)/i.exec(instance)?.[1] || "").replace(/_/g, " ").trim();
    disks.push({ index: Number(match[1]), bus, name, instance });
  }
  return disks;
}

/** Joins the volume letters to what is known of the disks; `space` gives { sizeBytes, freeBytes } for a volume root. */
function buildDrives(letters, disks, space) {
  const internal = disks.filter((disk) => disk.bus !== "usb");
  const internalBuses = new Set(internal.map((disk) => disk.bus));
  const internalBus = internalBuses.size === 1 ? [...internalBuses][0] : "unknown";
  const single = internal.length === 1 ? internal[0] : null;
  return [...letters.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, info]) => {
      const volume = `${letter}:\\`;
      const bus = info.usb ? "usb" : internalBus;
      const disk = info.usb ? null : single;
      const { sizeBytes = 0, freeBytes = 0 } = space(volume) || {};
      return {
        volume,
        diskId: disk ? String(disk.index) : null,
        diskKey: disk ? `disk:${disk.instance}` : `volume:${letter}`,
        name: disk?.name || "",
        bus,
        role: BUS_ROLES[bus],
        sizeBytes,
        freeBytes,
      };
    });
}

/** Two volumes known to be on one physical disk share its bandwidth, so they are no help as a mirror of each other. */
function sameDisk(a, b) {
  return Boolean(a?.diskId && b?.diskId) && a.diskId === b.diskId;
}

/** REG_DWORD from `reg query`: 0 is off, 1 is on, 2 is evaluation mode. */
function parseSmartAppControl(text) {
  const match = /VerifiedAndReputablePolicyState\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(String(text || ""));
  if (!match) return "unknown";
  return ["off", "on", "evaluation"][parseInt(match[1], 16)] ?? "unknown";
}

function volumeSpace(volume) {
  try {
    const stat = fs.statfsSync(volume);
    return { sizeBytes: stat.blocks * stat.bsize, freeBytes: stat.bavail * stat.bsize };
  } catch (error) {
    log.warn("engine.probe", "volume space unreadable, drive skipped", { code: error?.code ?? null });
    return null;
  }
}

/** MB/s from bytes and elapsed milliseconds. */
function rate(bytes, ms) {
  return ms > 0 ? bytes / 1e6 / (ms / 1000) : 0;
}

function summarize({ seqBytes, seqMs, randBytes, randMs, smallReads, smallMs, unbuffered }) {
  return {
    seqMBps: Math.round(rate(seqBytes, seqMs)),
    expertMBps: Math.round(rate(randBytes, randMs)),
    rand4kMBps: Number(rate(smallReads * SECTOR, smallMs).toFixed(1)),
    rand4kIops: smallMs > 0 ? Math.round(smallReads / (smallMs / 1000)) : 0,
    unbuffered: Boolean(unbuffered),
  };
}

function isFresh(entry, now) {
  return Boolean(entry) && Number.isFinite(entry.at) && now - entry.at >= 0 && now - entry.at < CACHE_MAX_AGE_MS;
}

function readCache(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    // A missing cache is the first run, not a fault.
    if (error?.code !== "ENOENT") log.warn("engine.bench", "benchmark cache unreadable, starting empty", { code: error?.code ?? error?.name ?? null });
    return {};
  }
}

function writeCache(file, cache) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cache, null, 2));
  } catch (error) {
    log.swallow("engine", error, "a cache that cannot be written only means the test runs again");
  }
}

function execText(file, args, timeout) {
  return new Promise((resolve) => {
    platform.execFileHidden(file, args, { encoding: "utf8", timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) log.warn("engine.probe", "registry query failed, fallback used", { key: args[1], code: error.code ?? null });
      resolve(error ? null : stdout);
    });
  });
}

/** An aligned buffer: unbuffered reads on Windows need a sector-aligned address as well as offset. */
function alignedBuffer(size) {
  const raw = Buffer.allocUnsafeSlow(size + SECTOR);
  const skew = (SECTOR - (raw.byteOffset % SECTOR)) % SECTOR;
  return raw.subarray(skew, skew + size);
}

/**
 * Reads a temporary file the way the engines read experts: 16 MB blocks in order, 16 MB blocks at
 * random offsets four at a time, and 4 KB reads one at a time. Opens with the OS's no-cache flag when
 * it exists and says so in the result when it could not.
 */
async function measureFile(file, { sizeBytes, signal, onProgress, now = Date.now }) {
  const blocks = Math.floor(sizeBytes / BLOCK);
  const flagged = fs.constants.UV_FS_O_DIRECT || 0;
  let handle;
  let unbuffered;
  try {
    handle = await fs.promises.open(file, fs.constants.O_RDONLY | flagged);
    unbuffered = flagged !== 0;
    const probe = alignedBuffer(SECTOR);
    await handle.read(probe, 0, SECTOR, 0);
  } catch (error) {
    log.info("engine.bench", "unbuffered reads unavailable, using buffered", { code: error?.code ?? null });
    await handle?.close().catch(log.swallowed("engine", "closing a handle that may be gone"));
    handle = await fs.promises.open(file, "r");
    unbuffered = false;
  }
  try {
    const check = () => {
      if (signal?.aborted) throw Object.assign(new Error("cancelled"), { code: "ABORT" });
    };
    const buffers = Array.from({ length: 4 }, () => alignedBuffer(BLOCK));
    let started = now();
    for (let i = 0; i < blocks; i++) {
      check();
      await handle.read(buffers[0], 0, BLOCK, i * BLOCK);
      if (i % 8 === 0) onProgress?.({ phase: "sequential", done: i, total: blocks });
    }
    const seqMs = now() - started;
    const randomReads = Math.min(blocks, 64);
    started = now();
    for (let done = 0; done < randomReads; done += 4) {
      check();
      const batch = Math.min(4, randomReads - done);
      await Promise.all(
        Array.from({ length: batch }, (_, k) => handle.read(buffers[k], 0, BLOCK, Math.floor(Math.random() * blocks) * BLOCK)),
      );
      onProgress?.({ phase: "random", done, total: randomReads });
    }
    const randMs = now() - started;
    const smallReads = 2000;
    const small = alignedBuffer(SECTOR);
    const slots = Math.floor(sizeBytes / SECTOR);
    started = now();
    for (let i = 0; i < smallReads; i++) {
      if (i % 200 === 0) check();
      await handle.read(small, 0, SECTOR, Math.floor(Math.random() * slots) * SECTOR);
    }
    const smallMs = now() - started;
    return summarize({ seqBytes: blocks * BLOCK, seqMs, randBytes: randomReads * BLOCK, randMs, smallReads, smallMs, unbuffered });
  } finally {
    await handle.close().catch(log.swallowed("engine", "closing a handle that may be gone"));
  }
}

/** Writes the temporary file in blocks, so a cancel stops it and a full disk fails early. */
async function writeTemp(file, sizeBytes, signal) {
  const handle = await fs.promises.open(file, "w");
  try {
    const block = Buffer.alloc(BLOCK, 0x5a);
    for (let offset = 0; offset < sizeBytes; offset += BLOCK) {
      if (signal?.aborted) throw Object.assign(new Error("cancelled"), { code: "ABORT" });
      await handle.write(block, 0, Math.min(BLOCK, sizeBytes - offset), offset);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function createHardwareProbe({ userDataDir, getSpecs = async () => null, exec = execText, measure = measureFile, write = writeTemp, space = volumeSpace, now = Date.now, platformName = process.platform, topology = getCpuTopology }) {
  const cacheFile = path.join(userDataDir, CACHE_FILE);
  let running = null;

  async function drives() {
    if (platformName !== "win32") {
      const root = path.parse(os.homedir()).root;
      const free = space(os.homedir());
      return free ? [{ volume: root, diskId: null, diskKey: "root", name: "", bus: "unknown", role: "unknown", ...free }] : [];
    }
    const [mounted, enumerated] = await Promise.all([
      exec(REG, ["query", MOUNTED_KEY], REG_TIMEOUT_MS),
      exec(REG, ["query", DISK_ENUM_KEY], REG_TIMEOUT_MS),
    ]);
    return buildDrives(parseMountedDevices(mounted), parseDiskEnum(enumerated), space);
  }

  async function smartAppControl() {
    if (platformName !== "win32") return "unknown";
    return parseSmartAppControl(await exec(REG, ["query", SAC_KEY, "/v", "VerifiedAndReputablePolicyState"], REG_TIMEOUT_MS));
  }

  function benchmarks() {
    const cache = readCache(cacheFile);
    const fresh = {};
    for (const [key, entry] of Object.entries(cache)) if (isFresh(entry, now())) fresh[key] = entry;
    return fresh;
  }

  /** Everything the planner reads. The drives carry their cached benchmark when one is fresh. */
  async function probe() {
    const timer = log.time("engine.probe", "hardware probe", { platform: platformName });
    try {
      const [specs, list, sac] = await Promise.all([getSpecs(), drives(), smartAppControl()]);
      const cached = benchmarks();
      const cpu = topology();
      const report = {
      ram: { totalGB: Number((os.totalmem() / 1024 ** 3).toFixed(1)), availableGB: Number((os.freemem() / 1024 ** 3).toFixed(1)) },
      gpu: { name: specs?.gpu || null, vramGB: specs?.vram || 0, unified: Boolean(specs?.unifiedMemory) },
      cpu: { model: specs?.cpu || null, logical: cpu.logical, physical: cpu.physical, performance: cpu.performance },
      drives: list.map((drive) => ({ ...drive, benchmark: cached[drive.diskKey] || null })),
      smartAppControl: sac,
      };
      timer.end({ drives: report.drives.length, ramGB: report.ram.totalGB, vramGB: report.gpu.vramGB, smartAppControl: sac });
      return report;
    } catch (error) {
      timer.fail(error);
      throw error;
    }
  }

  /** Benchmarks the disk behind `volume`; refuses a second run and a volume without room. */
  async function runBenchmark(volume, { sizeGB = 4, onProgress } = {}) {
    if (running) return { ok: false, error: "busy" };
    const list = await drives();
    const drive = list.find((d) => d.volume.toLowerCase() === String(volume).toLowerCase());
    if (!drive) return { ok: false, error: "unknown-volume" };
    const sizeBytes = Math.floor(sizeGB * 1024 ** 3);
    if (drive.freeBytes < sizeBytes * 1.5) return { ok: false, error: "no-space" };
    const controller = new AbortController();
    const file = path.join(drive.volume, `.draggy-bench-${process.pid}.tmp`);
    const timer = log.time("engine.bench", "disk benchmark", { volume: drive.volume, sizeGB });
    running = controller;
    try {
      onProgress?.({ phase: "writing", done: 0, total: 1 });
      await write(file, sizeBytes, controller.signal);
      const result = await measure(file, { sizeBytes, signal: controller.signal, onProgress, now });
      const entry = { ...result, at: now(), volume: drive.volume, sizeGB };
      const cache = readCache(cacheFile);
      cache[drive.diskKey] = entry;
      writeCache(cacheFile, cache);
      timer.end({ expertMBps: entry.expertMBps, rand4kIops: entry.rand4kIops, unbuffered: entry.unbuffered });
      return { ok: true, diskKey: drive.diskKey, benchmark: entry };
    } catch (error) {
      if (error?.code === "ABORT") timer.end({ cancelled: true });
      else timer.fail(error);
      return { ok: false, error: error?.code === "ABORT" ? "cancelled" : "failed", detail: error?.code === "ABORT" ? undefined : error?.code || String(error?.message || error) };
    } finally {
      running = null;
      await fs.promises.rm(file, { force: true }).catch(log.swallowed("engine", "removing a temp file is best effort"));
    }
  }

  function cancelBenchmark() {
    running?.abort();
    return Boolean(running);
  }

  return { probe, runBenchmark, cancelBenchmark, benchmarks, smartAppControl, drives };
}

module.exports = { __internals: { writeTemp, measureFile }, createHardwareProbe, parseMountedDevices, parseDiskEnum, buildDrives, parseSmartAppControl, sameDisk, summarize, isFresh, CACHE_MAX_AGE_MS };
