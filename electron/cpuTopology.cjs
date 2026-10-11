const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const platform = require("./platform.cjs");
const { log } = require("./logger.cjs");

/**
 * How many cores the engine should use. Token generation is memory-bound and waits on its slowest
 * thread, so it wants the performance cores only: on a hybrid Intel chip an E-core thread holds every
 * step back, and a second thread on one core buys nothing. Prompt processing is compute-bound and
 * splits work into chunks, so every physical core helps there.
 *
 * Returns { logical, physical, performance }.
 */
let cached = null;

function logicalCount() {
  return typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length || 1;
}

/** With SMT on the P-cores only (Intel hybrid) logical - physical is exactly the P-core count; on a
 * uniform SMT chip it equals the physical count; without SMT there is nothing to tell apart. */
function fromCounts(logical, physical) {
  const safePhysical = Math.max(1, Math.min(physical || logical, logical));
  const smt = logical - safePhysical;
  const performance = smt > 0 && smt <= safePhysical ? smt : safePhysical;
  return { logical, physical: safePhysical, performance };
}

/** Expands a sysfs CPU list such as "0-7,16,18-19". */
function parseCpuList(text) {
  const cpus = [];
  for (const part of String(text || "").trim().split(",")) {
    if (!part) continue;
    const [from, to = from] = part.split("-");
    const lo = parseInt(from, 10);
    const hi = parseInt(to, 10);
    if (Number.isNaN(lo) || Number.isNaN(hi)) continue;
    for (let cpu = lo; cpu <= hi; cpu++) cpus.push(cpu);
  }
  return cpus;
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** Linux exposes the real answer: sibling lists give physical cores, cpu_core lists Intel P-cores. */
function linuxTopology(sysRoot = "/sys/devices") {
  const cpuDir = path.join(sysRoot, "system", "cpu");
  let names;
  try {
    names = fs.readdirSync(cpuDir).filter((name) => /^cpu\d+$/.test(name));
  } catch (error) {
    log.warn("engine.cpu", "cpu sysfs unreadable", { code: error?.code ?? null });
    return null;
  }
  const coreOf = new Map();
  for (const name of names) {
    const siblings = readText(path.join(cpuDir, name, "topology", "thread_siblings_list"))
      ?? readText(path.join(cpuDir, name, "topology", "core_cpus_list"));
    if (siblings === null) continue;
    coreOf.set(Number(name.slice(3)), siblings.trim());
  }
  if (coreOf.size === 0) return null;

  const logical = coreOf.size;
  const physical = new Set(coreOf.values()).size;
  const pCoreList = readText(path.join(sysRoot, "cpu_core", "cpus"));
  if (pCoreList !== null) {
    const pCores = new Set(parseCpuList(pCoreList).map((cpu) => coreOf.get(cpu)).filter(Boolean));
    if (pCores.size > 0) return { logical, physical, performance: pCores.size };
  }
  return { logical, physical, performance: physical };
}

/** Read from the processor's name, with no process started: antivirus blocks a hidden PowerShell.
 * AMD names its core count; Intel 12th-14th gen i7/i9 chips have 8 P-cores. */
function windowsTopology(cpus = os.cpus()) {
  const model = cpus[0]?.model || "";
  const match = /\b(\d+)-Core\b/i.exec(model);
  if (match) return fromCounts(logicalCount(), Number(match[1]));
  const logical = logicalCount();
  if (/Intel.*i[79]-(?:1[234]\d{2,3})/i.test(model) && logical >= 20) {
    return fromCounts(logical, logical - 8);
  }
  return null;
}

async function macTopology() {
  const read = async (key) => parseInt(String(await platform.runCommand("sysctl", ["-n", key], 4000) || "").trim(), 10);
  const physical = await read("hw.physicalcpu");
  const logical = await read("hw.logicalcpu");
  if (!(physical > 0)) return null;
  // Apple silicon lists its performance cluster separately; Intel Macs have no perflevels.
  const perf = await read("hw.perflevel0.physicalcpu");
  return { logical: logical > 0 ? logical : physical, physical, performance: perf > 0 ? perf : physical };
}

async function detect() {
  let found;
  try {
    if (platform.IS_WINDOWS) found = windowsTopology();
    else if (platform.IS_MAC) found = await macTopology();
    else found = linuxTopology();
  } catch (error) {
    log.warn("engine.cpu", "cpu topology probe failed", { platform: process.platform, error: error?.name, code: error?.code ?? null });
    found = null;
  }
  if (found) return found;
  // Unknown: assume two threads per core, which is right for most desktop chips.
  const logical = logicalCount();
  const fallback = fromCounts(logical, logical >= 4 ? Math.ceil(logical / 2) : logical);
  log.info("engine.cpu", "cpu topology fallback used", fallback);
  return fallback;
}

/** Detected once per run; the answer does not change while the app is open. */
function getCpuTopology() {
  if (!cached) cached = detect();
  return cached;
}

function resetForTests() {
  cached = null;
}

module.exports = { getCpuTopology, fromCounts, parseCpuList, linuxTopology, windowsTopology, resetForTests };
