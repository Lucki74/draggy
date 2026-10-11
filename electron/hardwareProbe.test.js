import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const probeModule = require("./hardwareProbe.cjs");
const { createHardwareProbe, parseMountedDevices, parseDiskEnum, buildDrives, parseSmartAppControl, sameDisk, summarize, isFresh, CACHE_MAX_AGE_MS } = probeModule;

const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", "hardware", name), "utf8");

describe("reading the registry", () => {
  const letters = parseMountedDevices(fixture("mounted-devices.txt"));
  const space = (volume) => ({ sizeBytes: 1e12, freeBytes: volume === "D:\\" ? 1.09e12 : 5e11 });

  it("keeps local volumes, marks USB ones and skips optical drives", () => {
    expect([...letters.entries()]).toEqual([["C", { usb: false }], ["D", { usb: false }], ["E", { usb: true }]]);
  });

  it("reads bus and model of each disk", () => {
    const disks = parseDiskEnum(fixture("disk-enum-two-nvme-usb.txt"));
    expect(disks.map((d) => [d.index, d.bus, d.name])).toEqual([
      [0, "nvme", "SAMSUNG MZVL21T0"],
      [1, "nvme", "WD BLACK SN850 P"],
      [2, "usb", "USB Flash Drive"],
    ]);
  });

  it("gives each volume its bus, role and free space", () => {
    const drives = buildDrives(letters, parseDiskEnum(fixture("disk-enum-two-nvme-usb.txt")), space);
    expect(drives.map((d) => [d.volume, d.bus, d.role])).toEqual([
      ["C:\\", "nvme", "good"],
      ["D:\\", "nvme", "good"],
      ["E:\\", "usb", "refuse"],
    ]);
    expect(drives[1].freeBytes).toBe(1.09e12);
  });

  it("ties a volume to its disk only when the computer has one internal disk", () => {
    const single = buildDrives(letters, parseDiskEnum(fixture("disk-enum-single.txt")), space);
    expect(single[0]).toMatchObject({ diskId: "0", name: "Micron 2450" });
    expect(single[2].diskId).toBeNull();
    expect(sameDisk(single[0], single[1])).toBe(true);
    const two = buildDrives(letters, parseDiskEnum(fixture("disk-enum-two-nvme-usb.txt")), space);
    expect(sameDisk(two[0], two[1])).toBe(false);
    expect(two[0].diskKey).not.toBe(two[1].diskKey);
  });

  it("returns nothing for output that is not registry text", () => {
    expect(parseMountedDevices("ERROR: Access is denied.").size).toBe(0);
    expect(parseDiskEnum("").length).toBe(0);
  });
});

describe("Smart App Control", () => {
  const out = (n) => `\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\CI\\Policy\n    VerifiedAndReputablePolicyState    REG_DWORD    0x${n}\n`;
  it("reads off, on and evaluation", () => {
    expect([0, 1, 2].map((n) => parseSmartAppControl(out(n)))).toEqual(["off", "on", "evaluation"]);
  });
  it("says unknown when the value is missing", () => {
    expect(parseSmartAppControl("ERROR: The system was unable to find the specified registry key")).toBe("unknown");
  });
});

describe("benchmark arithmetic", () => {
  it("turns bytes and time into MB/s and IOPS", () => {
    const result = summarize({ seqBytes: 4e9, seqMs: 1000, randBytes: 1e9, randMs: 500, smallReads: 2000, smallMs: 400, unbuffered: true });
    expect(result).toEqual({ seqMBps: 4000, expertMBps: 2000, rand4kMBps: 20.5, rand4kIops: 5000, unbuffered: true });
  });
  it("does not divide by zero", () => {
    expect(summarize({ seqBytes: 1, seqMs: 0, randBytes: 1, randMs: 0, smallReads: 1, smallMs: 0 }).seqMBps).toBe(0);
  });
  it("expires after 30 days", () => {
    expect(isFresh({ at: 1000 }, 1000 + CACHE_MAX_AGE_MS - 1)).toBe(true);
    expect(isFresh({ at: 1000 }, 1000 + CACHE_MAX_AGE_MS)).toBe(false);
    expect(isFresh(undefined, 5)).toBe(false);
  });
});

describe("the probe", () => {
  let dir;
  let clock;
  let calls;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "hw-"));
    clock = 1_000_000;
    calls = [];
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const make = (extra = {}) =>
    createHardwareProbe({
      userDataDir: dir,
      platformName: "win32",
      now: () => clock,
      topology: () => ({ logical: 32, physical: 24, performance: 8 }),
      getSpecs: async () => ({ cpu: "i9", gpu: "RTX 4070", vram: 8, unifiedMemory: false }),
      space: (volume) => ({ sizeBytes: 1e12, freeBytes: volume === "E:\\" ? 5e10 : 9e11 }),
      exec: async (file, args) => {
        calls.push([path.basename(file).toLowerCase(), ...args]);
        if (args.includes("MountedDevices") || args[1]?.endsWith("MountedDevices")) return fixture("mounted-devices.txt");
        if (args[1]?.endsWith("disk\Enum")) return fixture("disk-enum-two-nvme-usb.txt");
        return "VerifiedAndReputablePolicyState    REG_DWORD    0x0";
      },
      write: async () => {},
      measure: async () => ({ seqMBps: 6500, expertMBps: 5200, rand4kMBps: 60, rand4kIops: 15000, unbuffered: true }),
      ...extra,
    });

  it("reports RAM, GPU, CPU topology, drives and Smart App Control", async () => {
    const report = await make().probe();
    expect(report.gpu).toEqual({ name: "RTX 4070", vramGB: 8, unified: false });
    expect(report.cpu).toMatchObject({ logical: 32, physical: 24, performance: 8 });
    expect(report.ram.totalGB).toBeGreaterThan(0);
    expect(report.drives).toHaveLength(3);
    expect(report.smartAppControl).toBe("off");
  });

  it("asks only reg.exe, never a shell or PowerShell", async () => {
    await make().probe();
    expect(calls.map((c) => c[0]).sort()).toEqual(["reg.exe", "reg.exe", "reg.exe"]);
  });

  it("caches a benchmark and shows it on its volume", async () => {
    const probe = make();
    const run = await probe.runBenchmark("D:\\", { sizeGB: 1 });
    expect(run.ok).toBe(true);
    const report = await probe.probe();
    const byVolume = Object.fromEntries(report.drives.map((d) => [d.volume, d.benchmark]));
    expect(byVolume["D:\\"].seqMBps).toBe(6500);
    expect(byVolume["C:\\"]).toBeNull();
  });

  it("forgets a benchmark once it has expired", async () => {
    const probe = make();
    await probe.runBenchmark("D:\\", { sizeGB: 1 });
    clock += CACHE_MAX_AGE_MS + 1;
    expect((await probe.probe()).drives.every((d) => d.benchmark === null)).toBe(true);
  });

  it("refuses a volume without room for the temporary file, and an unknown one", async () => {
    const probe = make();
    expect((await probe.runBenchmark("E:\\", { sizeGB: 100 })).error).toBe("no-space");
    expect((await probe.runBenchmark("Z:\\")).error).toBe("unknown-volume");
  });

  it("can be cancelled, and refuses to run twice at once", async () => {
    const probe = make({
      write: (file, size, signal) =>
        new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { code: "ABORT" })));
        }),
    });
    const first = probe.runBenchmark("D:\\", { sizeGB: 1 });
    await new Promise((r) => setTimeout(r, 20));
    expect((await probe.runBenchmark("D:\\", { sizeGB: 1 })).error).toBe("busy");
    expect(probe.cancelBenchmark()).toBe(true);
    expect((await first).error).toBe("cancelled");
    expect(probe.cancelBenchmark()).toBe(false);
  });
});

describe("the real measurement on a temporary file", () => {
  it("reads a file and reports plausible numbers", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hw-real-"));
    const file = path.join(dir, "bench.tmp");
    const size = 64 * 1024 * 1024;
    const { writeTemp, measureFile } = probeModule.__internals;
    await writeTemp(file, size);
    const result = await measureFile(file, { sizeBytes: size });
    expect(result.seqMBps).toBeGreaterThan(0);
    expect(result.rand4kIops).toBeGreaterThan(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
