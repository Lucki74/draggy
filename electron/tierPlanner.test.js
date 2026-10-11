import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { planModel, describeGguf, describeColibri } = require("./tierPlanner.cjs");

const GB = 1e9;
const drive = (volume, bus, role, freeGB, expertMBps) => ({
  volume,
  bus,
  role,
  freeBytes: freeGB * GB,
  sizeBytes: 2000 * GB,
  benchmark: expertMBps ? { expertMBps, seqMBps: expertMBps * 1.2 } : null,
});

// The section 9 machine: 32 GB RAM, 8 GB VRAM, D: and C: both PCIe 4.0 NVMe.
const devMachine = {
  ram: { totalGB: 32 },
  gpu: { vramGB: 8, unified: false },
  drives: [drive("C:\\", "nvme", "good", 555, 5200), drive("D:\\", "nvme", "good", 1090, 5200)],
};
const withDrives = (hardware, drives) => ({ ...hardware, drives });

// Appendix A.1 rows: totalGB, denseGB, ramMinGB; routedGB is read per token (about 11 GB for GLM-5.2).
const catalog = {
  qwen36: describeColibri({ totalGB: 23.1, denseGB: 3.5, ramMinGB: 10, routedGB: 1.6 }),
  dsv4: describeColibri({ totalGB: 166.9, denseGB: 7.9, ramMinGB: 16, routedGB: 5.5 }),
  glm52: describeColibri({ totalGB: 429.3, denseGB: 9.9, ramMinGB: 16, routedGB: 11 }),
  mimoPro: describeColibri({ totalGB: 563.6, denseGB: 32.4, ramMinGB: 54, routedGB: 12 }),
  kimiK3: describeColibri({ totalGB: 1561, denseGB: 20, ramMinGB: 32, routedGB: 25 }),
};

describe("colibri catalog on the development machine", () => {
  it("runs a model that fits in RAM without touching the disk", () => {
    const plan = planModel({ model: catalog.qwen36, hardware: devMachine });
    expect(plan.engine).toBe("colibri");
    expect(plan.disk.coldGB).toBe(0);
    expect(plan.expectedHitRate).toEqual([1, 1]);
    expect(plan.expectedTokPerSec[1]).toBeGreaterThan(15);
  });

  it("streams DeepSeek V4 Flash from D: at about 1 tok/s", () => {
    const plan = planModel({ model: catalog.dsv4, hardware: devMachine });
    expect(plan.engine).toBe("colibri");
    expect(plan.disk.volume).toBe("D:\\");
    expect(plan.bottleneck).toBe("disk");
    expect(plan.expectedTokPerSec[0]).toBeGreaterThan(0.4);
    expect(plan.expectedTokPerSec[1]).toBeLessThan(2.5);
    expect(plan.expectedHitRate[0]).toBeLessThan(plan.expectedHitRate[1]);
  });

  it("puts GLM-5.2 under 1 tok/s", () => {
    const plan = planModel({ model: catalog.glm52, hardware: devMachine });
    expect(plan.engine).toBe("colibri");
    expect(plan.expectedTokPerSec[1]).toBeLessThan(1);
    expect(plan.expectedTokPerSec[0]).toBeGreaterThan(0.1);
  });

  it("refuses MiMo-V2.6 Pro for its 54 GB RAM floor", () => {
    expect(planModel({ model: catalog.mimoPro, hardware: devMachine }).refusal.reason).toBe("ram-floor");
  });

  it("refuses Kimi K3 for want of a drive with 1.5 TB free", () => {
    expect(planModel({ model: catalog.kimiK3, hardware: { ...devMachine, ram: { totalGB: 64 } } }).refusal.reason).toBe("no-space");
  });
});

describe("GGUF models", () => {
  // gpt-oss-120b: 63 GB, 128 experts, 4 used.
  const gptOss = describeGguf({ expertCount: 128, expertUsedCount: 4, blockCount: 36, headCountKv: 8, keyLength: 64, valueLength: 64 }, 63 * GB, {
    denseGB: 4,
  });

  it("describes the shared part and what is read per token", () => {
    expect(gptOss.moe).toBe(true);
    expect(gptOss.routedGB).toBeCloseTo((59 * 4) / 128, 5);
    expect(gptOss.estimated).toBe(false);
    expect(describeGguf({ expertCount: 128 }, 63 * GB).estimated).toBe(true);
  });

  it("fits a small MoE GGUF in RAM with llama.cpp", () => {
    const small = describeGguf({ expertCount: 128, expertUsedCount: 8 }, 19 * GB, { denseGB: 3 });
    const plan = planModel({ model: small, hardware: devMachine });
    expect(plan.engine).toBe("llamacpp");
    expect(plan.disk.coldGB).toBe(0);
  });

  it("refuses a GGUF that needs the disk tier when llama.cpp cannot stream", () => {
    const plan = planModel({ model: gptOss, hardware: devMachine, engines: { llamacpp: true } });
    expect(plan.refusal.reason).toBe("needs-streaming-engine");
    expect(plan.engine).toBe("none");
  });

  it("suggests the colibri container when one exists", () => {
    const plan = planModel({ model: { ...gptOss, colibriAlternative: "glm-5.2" }, hardware: devMachine });
    expect(plan.refusal.suggestion).toMatch(/colibri/);
    expect(plan.colibriAlternative).toBe("glm-5.2");
  });

  it("streams it once llama.cpp can", () => {
    const plan = planModel({ model: gptOss, hardware: devMachine, engines: { llamacpp: true, llamacppStream: true } });
    expect(plan.engine).toBe("llamacpp");
    expect(plan.expectedTokPerSec[1]).toBeGreaterThan(3);
    expect(plan.expectedTokPerSec[0]).toBeLessThan(plan.expectedTokPerSec[1]);
  });

  it("refuses a dense 405B model", () => {
    const dense = describeGguf({ expertCount: 0 }, 230 * GB);
    expect(planModel({ model: dense, hardware: devMachine, engines: { llamacpp: true, llamacppStream: true } }).refusal.reason).toBe("dense-too-large");
  });

  it("still runs a dense model that fits", () => {
    const dense = describeGguf({ expertCount: 0 }, 20 * GB);
    expect(planModel({ model: dense, hardware: devMachine }).engine).toBe("llamacpp");
  });
});

describe("other machines and drives", () => {
  it("refuses DeepSeek V4 Flash on a 16 GB laptop with no GPU", () => {
    const laptop = { ram: { totalGB: 16 }, gpu: { vramGB: 0 }, drives: [drive("C:\\", "nvme", "good", 900, 3000)] };
    expect(planModel({ model: catalog.dsv4, hardware: laptop }).refusal.reason).toMatch(/ram-floor|dense-part-too-large/);
  });

  it("uses a unified-memory box as one pool", () => {
    const box = { ram: { totalGB: 128 }, gpu: { vramGB: 96, unified: true }, drives: [drive("C:\\", "nvme", "good", 900, 5000)] };
    const plan = planModel({ model: catalog.dsv4, hardware: box });
    expect(plan.vram.denseGB).toBe(0);
    expect(plan.ram.expertCacheGB).toBeGreaterThan(80);
  });

  it("warns about a SATA drive and goes slower on it", () => {
    const sata = withDrives(devMachine, [drive("D:\\", "sata", "slow", 1000, 450)]);
    const plan = planModel({ model: catalog.dsv4, hardware: sata });
    expect(plan.warnings).toContain("slow-drive");
    expect(plan.expectedTokPerSec[1]).toBeLessThan(planModel({ model: catalog.dsv4, hardware: devMachine }).expectedTokPerSec[0]);
  });

  it("refuses a USB drive as the model location", () => {
    const usb = withDrives(devMachine, [drive("E:\\", "usb", "refuse", 1000, 400)]);
    expect(planModel({ model: catalog.dsv4, hardware: usb }).refusal.reason).toBe("usb-drive");
  });

  it("prefers the faster of two internal drives", () => {
    const two = withDrives(devMachine, [drive("C:\\", "nvme", "good", 900, 3000), drive("D:\\", "nvme", "good", 900, 6000)]);
    expect(planModel({ model: catalog.dsv4, hardware: two }).disk.volume).toBe("D:\\");
  });

  it("says the speed is unknown until the disk is measured", () => {
    const unmeasured = withDrives(devMachine, [drive("D:\\", "nvme", "good", 1090, 0)]);
    const plan = planModel({ model: catalog.dsv4, hardware: unmeasured });
    expect(plan.expectedTokPerSec).toBeNull();
    expect(plan.needsDiskTest).toBe(true);
    expect(plan.engine).toBe("colibri");
  });

  it("charges more memory for a longer context", () => {
    const small = planModel({ model: catalog.glm52, hardware: devMachine, contextTokens: 4096 });
    const large = planModel({ model: catalog.glm52, hardware: devMachine, contextTokens: 65536 });
    expect(large.vram.kvGB + large.ram.kvGB).toBeGreaterThan(small.vram.kvGB + small.ram.kvGB);
  });
});

describe("slow-model threshold", () => {
  const { isSlowPlan } = require("./tierPlanner.cjs");

  it("is slow when even the best case is under 3 tokens per second", () => {
    expect(isSlowPlan({ expectedTokPerSec: [0.4, 1.2] })).toBe(true);
    expect(isSlowPlan({ expectedTokPerSec: [2, 3] })).toBe(false);
    expect(isSlowPlan({ expectedTokPerSec: [8, 14] })).toBe(false);
  });

  it("is not slow when the speed is unknown or the plan is missing", () => {
    expect(isSlowPlan({ expectedTokPerSec: null })).toBe(false);
    expect(isSlowPlan(undefined)).toBe(false);
  });
});
