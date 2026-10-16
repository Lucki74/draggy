import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const cpuTopology = require("./cpuTopology.cjs");

describe("cpuTopology", () => {
  it("finds the P-cores of a hybrid Intel chip from its counts", () => {
    // i9-14900HX: 8 P-cores with SMT + 16 E-cores = 24 cores, 32 threads.
    expect(cpuTopology.fromCounts(32, 24)).toEqual({ logical: 32, physical: 24, performance: 8 });
  });

  it("uses every core of a uniform chip, with or without SMT", () => {
    expect(cpuTopology.fromCounts(16, 8)).toEqual({ logical: 16, physical: 8, performance: 8 }); // 7800X3D
    expect(cpuTopology.fromCounts(8, 8)).toEqual({ logical: 8, physical: 8, performance: 8 });
  });

  it("reads a Windows core count from the processor's name, including Intel hybrid chips", () => {
    const amd = cpuTopology.windowsTopology([{ model: "AMD Ryzen 9 7900X3D 12-Core Processor          " }]);
    expect(amd.physical).toBe(Math.min(12, amd.logical));
    const intel = cpuTopology.windowsTopology([{ model: "13th Gen Intel(R) Core(TM) i7-13700K" }]);
    if (intel) expect(intel.performance).toBe(8);
    expect(cpuTopology.windowsTopology([{ model: "Intel(R) Core(TM) i3-10100" }])).toBeNull();
    expect(cpuTopology.windowsTopology([])).toBeNull();
  });
});
