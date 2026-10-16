const os = require("node:os");
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

async function detect() {
  let found;
  try {
    found = windowsTopology();
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

module.exports = { getCpuTopology, fromCounts, windowsTopology, resetForTests };
