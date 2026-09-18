import { describe, expect, it } from "vitest";
import {
  RUNTIME_OVERHEAD_GB,
  USABLE_UNIFIED_FRACTION,
  USABLE_VRAM_FRACTION,
  describeFit,
  describeSplit,
} from "../vram";

const GB = 1024 ** 3;

describe("fit ratings", () => {
  it("rates a model that fits comfortably as green", () => {
    const fit = describeFit({ modelBytes: 4.9 * GB, vramGB: 8 });

    expect(fit.tone).toBe("green");
    expect(fit.gpuPercent).toBe(100);
  });

  it("rates a model that only partly fits as amber", () => {
    const fit = describeFit({ modelBytes: 9 * GB, vramGB: 8 });
    expect(fit.tone).toBe("amber");
  });

  it("rates a model far too large as red", () => {
    const fit = describeFit({ modelBytes: 20 * GB, vramGB: 8 });

    expect(fit.tone).toBe("red");
    expect(fit.gpuPercent).toBeLessThan(60);
  });

  it("reports unknown rather than zero when VRAM detection failed", () => {
    const fit = describeFit({ modelBytes: 4.9 * GB, vramGB: 0 });

    expect(fit.tone).toBe("unknown");
    expect(describeSplit(fit)).toBe("");
  });

  it("adds a fixed runtime overhead to the weights", () => {
    const fit = describeFit({ modelBytes: 4 * GB, vramGB: 8 });
    expect(fit.neededGB).toBeCloseTo(fit.sizeGB + RUNTIME_OVERHEAD_GB, 5);
  });

  it("never reports more than 100% on GPU", () => {
    const fit = describeFit({ modelBytes: 0.5 * GB, vramGB: 48 });

    expect(fit.gpuPercent).toBe(100);
    expect(describeSplit(fit)).toBe("100% GPU");
  });

  it("gets worse as the model gets bigger", () => {
    let previous = 101;
    for (const gb of [1, 4, 8, 14, 24, 40]) {
      const fit = describeFit({ modelBytes: gb * GB, vramGB: 8 });
      expect(fit.gpuPercent).toBeLessThanOrEqual(previous);
      previous = fit.gpuPercent;
    }
  });

  it("reserves headroom on a discrete card", () => {
    const fit = describeFit({ modelBytes: 1 * GB, vramGB: 10 });
    expect(fit.usableGB).toBeCloseTo(10 * USABLE_VRAM_FRACTION, 5);
  });

  it("gives unified memory a larger usable share", () => {
    const discrete = describeFit({ modelBytes: 4.9 * GB, vramGB: 32 });
    const unified = describeFit({
      modelBytes: 4.9 * GB,
      vramGB: 32,
      unifiedMemory: true,
    });

    expect(unified.usableGB).toBeCloseTo(32 * USABLE_UNIFIED_FRACTION, 5);
    expect(unified.usableGB).toBeGreaterThan(discrete.usableGB);
  });

  it("reports the download size in gigabytes", () => {
    expect(describeFit({ modelBytes: 4.9 * GB, vramGB: 8 }).sizeGB).toBeCloseTo(4.9, 5);
  });
});

describe("describing the split", () => {
  it("formats a partial offload", () => {
    const fit = describeFit({ modelBytes: 9 * GB, vramGB: 8 });
    expect(describeSplit(fit)).toMatch(/^\d+% GPU \/ \d+% CPU$/);
  });

  it("adds up to a hundred percent", () => {
    const fit = describeFit({ modelBytes: 14 * GB, vramGB: 8 });
    const [, gpu, cpu] = describeSplit(fit).match(/(\d+)% GPU \/ (\d+)% CPU/) as string[];

    expect(Number(gpu) + Number(cpu)).toBe(100);
  });
});
