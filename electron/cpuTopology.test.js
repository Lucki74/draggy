import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

  it("expands sysfs CPU lists", () => {
    expect(cpuTopology.parseCpuList("0-3,8,10-11\n")).toEqual([0, 1, 2, 3, 8, 10, 11]);
  });

  it("reads Linux sysfs, P-core list included", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-sys-"));
    try {
      // 2 P-cores with SMT (cpu0-3) and 2 E-cores (cpu4, cpu5).
      const siblings = ["0-1", "0-1", "2-3", "2-3", "4", "5"];
      siblings.forEach((list, cpu) => {
        const dir = path.join(root, "system", "cpu", `cpu${cpu}`, "topology");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "thread_siblings_list"), `${list}\n`);
      });
      expect(cpuTopology.linuxTopology(root)).toEqual({ logical: 6, physical: 4, performance: 4 });

      fs.mkdirSync(path.join(root, "cpu_core"));
      fs.writeFileSync(path.join(root, "cpu_core", "cpus"), "0-3\n");
      expect(cpuTopology.linuxTopology(root)).toEqual({ logical: 6, physical: 4, performance: 2 });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
