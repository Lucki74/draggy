/**
 * The report a person can attach to a bug about large models: what the computer is, what each plan
 * said, which engine ran, and the engine's last log lines. Nothing in it comes from a conversation:
 * no prompts, no replies, no file names beyond drive letters. Speeds are numbers; log lines are cut
 * short and come from the logger, which already hashes long text.
 */
const { log } = require("./logger.cjs");

const LOG_LINES = 200;
const LINE_CHARS = 300;

/** The newest engine lines from the application log, oldest first. */
function engineLines(logText, limit = LOG_LINES) {
  const lines = String(logText || "")
    .split(/\r?\n/)
    .filter((line) => line.includes("[colibri]") || line.includes("[llama]"));
  return lines.slice(-limit).map((line) => (line.length > LINE_CHARS ? `${line.slice(0, LINE_CHARS)}…` : line));
}

function describeDrive(drive) {
  return {
    volume: drive.volume,
    bus: drive.bus,
    role: drive.role,
    sizeGB: Math.round(drive.sizeBytes / 1024 ** 3),
    freeGB: Math.round(drive.freeBytes / 1024 ** 3),
    benchmark: drive.benchmark || null,
  };
}

function buildReport(input) {
  const report = assembleReport(input);
  log.debug("engine.diagnostics", "diagnostics report built", {
    plans: report.plans.length,
    engineLines: report.engineLog.length,
    drives: report.hardware?.drives.length ?? 0,
    running: report.engine.running,
  });
  return report;
}

function assembleReport({ appVersion, createdAt, hardware, catalog, engine, runtime, stats, logText }) {
  return {
    createdAt,
    appVersion,
    engine: {
      colibri: runtime ? { tag: runtime.tag, variant: runtime.variant } : null,
      running: Boolean(engine?.running),
      kind: engine?.kind || null,
      slow: Boolean(engine?.slow),
    },
    hardware: hardware
      ? {
          ramGB: hardware.ram,
          gpu: hardware.gpu,
          cpu: hardware.cpu,
          smartAppControl: hardware.smartAppControl,
          drives: (hardware.drives || []).map(describeDrive),
        }
      : null,
    plans: (catalog || []).map((entry) => ({
      id: entry.id,
      downloaded: Boolean(entry.downloaded),
      complete: Boolean(entry.downloaded?.complete),
      refusal: entry.plan?.refusal?.reason || null,
      expectedTokPerSec: entry.plan?.expectedTokPerSec ?? null,
      expectedHitRate: entry.plan?.expectedHitRate ?? null,
      bottleneck: entry.plan?.bottleneck ?? null,
      measured: Boolean(entry.plan?.measured),
      estimated: Boolean(entry.plan?.estimated),
      warnings: entry.plan?.warnings || [],
    })),
    speeds: stats || {},
    engineLog: engineLines(logText),
  };
}

module.exports = { buildReport, engineLines, LOG_LINES };
