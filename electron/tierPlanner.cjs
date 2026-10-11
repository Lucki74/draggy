"use strict";

/**
 * Decides where a mixture-of-experts model lives (VRAM, RAM, disk), which engine runs it, and how fast
 * it should go. Pure: the hardware report comes from hardwareProbe, the model from describeGguf or
 * describeColibri. Speed follows the plan's section 3:
 *
 *   t_token ~ t_compute + R * (1 - h) / B_disk
 *
 * and is always a range. Without a disk measurement the disk part is unknown and says so.
 */

const { log } = require("./logger.cjs");

const OS_RESERVE_MIN_GB = 6;
const OS_RESERVE_FRACTION = 0.15;
const VRAM_USABLE_FRACTION = 0.9;
const VRAM_RUNTIME_OVERHEAD_GB = 0.8;
/** Share of disk time hidden behind compute by the loader pool (colibri's PIPE). */
const IO_OVERLAP = 0.3;
const SLOW_TOK_PER_SEC = 3;
/** Effective bandwidth of weights read from system RAM and from VRAM, as [low, high] GB/s. */
const RAM_BANDWIDTH_GBPS = [30, 70];
const VRAM_BANDWIDTH_GBPS = [200, 450];
/** Used when a GGUF does not say how large its shared (dense) part is. */
const DEFAULT_DENSE_FRACTION = 0.06;
const GB = 1e9;

const round = (value, digits = 1) => Number(value.toFixed(digits));
const refuse = (reason, suggestion, extra = {}) => ({ engine: "none", refusal: { reason, suggestion }, warnings: [], ...extra });

/** What a GGUF header and file size say about a model; the dense share is a guess unless `hints` has it. */
function describeGguf(header, fileBytes, hints = {}) {
  const totalGB = fileBytes / GB;
  const expertCount = header?.expertCount || 0;
  const moe = expertCount > 1;
  const denseGB = moe ? hints.denseGB ?? totalGB * DEFAULT_DENSE_FRACTION : totalGB;
  const used = header?.expertUsedCount || Math.max(1, Math.round(expertCount / 32));
  const expertGB = Math.max(0, totalGB - denseGB);
  const kvBytesPerToken =
    header?.blockCount && header?.headCountKv && header?.keyLength
      ? header.blockCount * header.headCountKv * (header.keyLength + (header.valueLength || header.keyLength)) * 2
      : hints.kvBytesPerToken ?? 100 * 1024;
  return {
    kind: "gguf",
    moe,
    totalGB,
    denseGB,
    routedGB: moe ? (expertGB * used) / expertCount : 0,
    kvBytesPerToken,
    ramMinGB: 0,
    estimated: hints.denseGB === undefined && moe,
    colibriAlternative: hints.colibriAlternative || null,
  };
}

/** A colibri catalog entry: sizes are as downloaded, `ramMinGB` is the engine's floor. */
function describeColibri(entry) {
  return {
    kind: "colibri",
    moe: true,
    totalGB: entry.totalGB,
    denseGB: entry.denseGB,
    routedGB: entry.routedGB,
    kvBytesPerToken: entry.kvBytesPerToken ?? 60 * 1024,
    ramMinGB: entry.ramMinGB || 0,
    estimated: Boolean(entry.estimated),
    colibriAlternative: null,
  };
}

/** A plan whose best case is under 3 tokens per second gets the slow-model behaviour in chat. */
function isSlowPlan(plan) {
  const range = plan?.expectedTokPerSec;
  return Array.isArray(range) && range[1] < SLOW_TOK_PER_SEC;
}

function osReserveGB(ramGB) {
  return Math.max(OS_RESERVE_MIN_GB, ramGB * OS_RESERVE_FRACTION);
}

/** The drive a large model should go on: not USB, enough room, fastest measured, then roomiest. */
function chooseDrive(drives, needGB) {
  const usable = (drives || []).filter((drive) => drive.role !== "refuse" && drive.freeBytes / GB >= needGB);
  const speed = (drive) => drive.benchmark?.expertMBps || 0;
  const rank = { good: 0, unknown: 1, slow: 2 };
  usable.sort((a, b) => rank[a.role] - rank[b.role] || speed(b) - speed(a) || b.freeBytes - a.freeBytes);
  return usable[0] || null;
}

function bottleneckOf({ ioSeconds, vramShare }) {
  if (ioSeconds > 0.5) return "disk";
  return vramShare > 0.5 ? "vram" : "ram-bandwidth";
}

/**
 * planModel({ model, hardware, contextTokens, engines }) -> TierPlan
 *  - hardware: the hardwareProbe report
 *  - engines: { llamacpp, llamacppStream, colibri } what is installed
 */
function planModelCore({ model, hardware, contextTokens = 8192, engines = { llamacpp: true } }) {
  const ramTotal = hardware?.ram?.totalGB || 0;
  const unified = Boolean(hardware?.gpu?.unified);
  const vramRaw = unified ? 0 : hardware?.gpu?.vramGB || 0;
  const reserveGB = osReserveGB(ramTotal);
  const ramUsable = Math.max(0, ramTotal - reserveGB);
  const vramUsable = vramRaw > 0 ? Math.max(0, vramRaw * VRAM_USABLE_FRACTION - VRAM_RUNTIME_OVERHEAD_GB) : 0;
  const kvGB = (model.kvBytesPerToken * contextTokens) / GB;
  const warnings = [];

  if (!model.moe) {
    if (model.totalGB + kvGB > ramUsable + vramUsable) {
      return refuse("dense-too-large", "Dense models read every weight for every token, so only MoE models can run from disk. Pick a smaller quant or an MoE model.");
    }
  }
  if (model.kind === "colibri" && model.ramMinGB > ramUsable) {
    return refuse("ram-floor", `This model needs at least ${model.ramMinGB} GB of RAM for the engine; ${round(ramUsable)} GB is usable here.`);
  }
  if (model.denseGB + kvGB > ramUsable + vramUsable) {
    return refuse("dense-part-too-large", "The always-active part of this model plus its context does not fit in RAM and VRAM together. Lower the context or pick a smaller model.");
  }

  // Dense weights go to VRAM first, then RAM; the context follows the same order.
  const denseVram = Math.min(model.denseGB, vramUsable);
  const denseRam = model.denseGB - denseVram;
  const kvVram = Math.min(kvGB, vramUsable - denseVram);
  const kvRam = kvGB - kvVram;
  const expertGB = Math.max(0, model.totalGB - model.denseGB);
  const vramExpert = Math.min(expertGB, vramUsable - denseVram - kvVram);
  const ramCache = Math.min(expertGB - vramExpert, Math.max(0, ramUsable - denseRam - kvRam));
  const coldGB = Math.max(0, expertGB - vramExpert - ramCache);

  const base = {
    vram: { denseGB: round(denseVram), expertGB: round(vramExpert), kvGB: round(kvVram) },
    ram: { denseGB: round(denseRam), expertCacheGB: round(ramCache), kvGB: round(kvRam), reserveGB: round(reserveGB) },
    disk: { volume: null, mirrors: [], coldGB: round(coldGB) },
    warnings,
    estimated: Boolean(model.estimated),
  };

  // Compute time: the bytes touched per token, read from VRAM or RAM.
  const activeGB = model.moe ? model.denseGB + model.routedGB : model.totalGB;
  const vramShare = Math.min(1, (denseVram + (model.moe ? 0 : vramExpert)) / Math.max(activeGB, 1e-9));
  const computeSeconds = (high) => {
    const ramBw = RAM_BANDWIDTH_GBPS[high ? 0 : 1];
    const vramBw = VRAM_BANDWIDTH_GBPS[high ? 0 : 1];
    return (activeGB * vramShare) / vramBw + (activeGB * (1 - vramShare)) / ramBw;
  };

  // Nothing leaves RAM and VRAM: no disk, speed set by memory bandwidth.
  if (coldGB <= 0.05) {
    const engine = model.kind === "colibri" ? "colibri" : engines.llamacpp ? "llamacpp" : "none";
    if (engine === "none") return refuse("no-engine", "Install the llama.cpp engine first.", base);
    return {
      ...base,
      engine,
      expectedHitRate: [1, 1],
      expectedTokPerSec: [round(1 / computeSeconds(true)), round(1 / computeSeconds(false))],
      bottleneck: bottleneckOf({ ioSeconds: 0, vramShare }),
    };
  }

  // Part of the experts must stay on disk.
  const drive = chooseDrive(hardware?.drives, model.totalGB);
  if (!drive) {
    const usbOnly = (hardware?.drives || []).some((d) => d.role === "refuse" && d.freeBytes / GB >= model.totalGB);
    return refuse(
      usbOnly ? "usb-drive" : "no-space",
      usbOnly ? "USB drives disconnect under sustained reads. Put the model on an internal NVMe drive." : `No internal drive has ${round(model.totalGB, 0)} GB free.`,
      base,
    );
  }
  if (drive.role === "slow") warnings.push("slow-drive");
  if (drive.role === "unknown") warnings.push("unknown-drive");

  let engine;
  if (model.kind === "colibri") {
    engine = "colibri";
  } else if (engines.llamacppStream) {
    engine = "llamacpp";
  } else {
    return refuse(
      "needs-streaming-engine",
      model.colibriAlternative
        ? "This GGUF is larger than RAM and VRAM and the installed llama.cpp cannot stream experts from disk. The colibri container of this model can."
        : "This GGUF is larger than RAM and VRAM and the installed llama.cpp cannot stream experts from disk. Pick a smaller quant.",
      { ...base, disk: { ...base.disk, volume: drive.volume }, colibriAlternative: model.colibriAlternative },
    );
  }

  const cacheGB = vramExpert + ramCache;
  const ratio = expertGB > 0 ? cacheGB / expertGB : 1;
  const hitRate = [round(ratio, 2), round(Math.min(0.95, Math.sqrt(ratio)), 2)];
  const out = { ...base, engine, disk: { ...base.disk, volume: drive.volume }, expectedHitRate: hitRate };

  const bandwidth = drive.benchmark?.expertMBps ? drive.benchmark.expertMBps / 1000 : 0;
  if (!bandwidth) {
    return { ...out, expectedTokPerSec: null, bottleneck: "disk", needsDiskTest: true };
  }
  const seconds = (hit, high) => computeSeconds(high) + (model.routedGB * (1 - hit) * (1 - IO_OVERLAP)) / bandwidth;
  const slowest = seconds(hitRate[0], true);
  const fastest = seconds(hitRate[1], false);
  return {
    ...out,
    expectedTokPerSec: [round(1 / slowest, 2), round(1 / fastest, 2)],
    bottleneck: bottleneckOf({ ioSeconds: (model.routedGB * (1 - hitRate[1])) / bandwidth, vramShare }),
  };
}

/** Plans a load and logs the outcome once: the engine, where the weights go and the speed range. */
function planModel(input) {
  const plan = planModelCore(input);
  log.info("engine.tier", "tier plan", {
    kind: input?.model?.kind ?? null,
    moe: Boolean(input?.model?.moe),
    totalGB: input?.model?.totalGB,
    engine: plan.engine,
    refusal: plan.refusal?.reason ?? null,
    coldGB: plan.disk?.coldGB ?? null,
    hitRate: plan.expectedHitRate ?? null,
    tokPerSec: plan.expectedTokPerSec ?? null,
    bottleneck: plan.bottleneck ?? null,
    needsDiskTest: Boolean(plan.needsDiskTest),
    estimated: Boolean(plan.estimated),
    warnings: plan.warnings?.length ?? 0,
  });
  return plan;
}

module.exports = { planModel, describeGguf, describeColibri, chooseDrive, osReserveGB, isSlowPlan };
