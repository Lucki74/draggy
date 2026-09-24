const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const platform = require("./platform.cjs");

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
  } catch {
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

async function windowsTopology() {
  const script =
    "$p=Get-CimInstance Win32_Processor;" +
    "Write-Output (($p|Measure-Object NumberOfCores -Sum).Sum);" +
    "Write-Output (($p|Measure-Object NumberOfLogicalProcessors -Sum).Sum)";
  const out = await platform.runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], 8000);
  const [physical, logical] = String(out || "").trim().split(/\s+/).map((n) => parseInt(n, 10));
  if (!(physical > 0) || !(logical > 0)) return null;
  return fromCounts(logical, physical);
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
    if (platform.IS_WINDOWS) found = await windowsTopology();
    else if (platform.IS_MAC) found = await macTopology();
    else found = linuxTopology();
  } catch {
    found = null;
  }
  if (found) return found;
  // Unknown: assume two threads per core, which is right for most desktop chips.
  const logical = logicalCount();
  return fromCounts(logical, logical >= 4 ? Math.ceil(logical / 2) : logical);
}

/** Detected once per run; the answer does not change while the app is open. */
function getCpuTopology() {
  if (!cached) cached = detect();
  return cached;
}

function resetForTests() {
  cached = null;
}

module.exports = { getCpuTopology, fromCounts, parseCpuList, linuxTopology, resetForTests };
