import { describe, expect, it } from "vitest";
import diagnostics from "./tierDiagnostics.cjs";

const hardware = {
  ram: { totalGB: 32, availableGB: 20 },
  gpu: { name: "GPU", vramGB: 8 },
  cpu: { model: "CPU", logical: 16 },
  smartAppControl: "off",
  drives: [{ volume: "D:\\", bus: "nvme", role: "good", sizeBytes: 2 * 1024 ** 4, freeBytes: 1024 ** 4, benchmark: { expertMBps: 3000 }, name: "Samsung SSD", diskId: "serial-1" }],
};

const base = {
  appVersion: "2.4.0",
  createdAt: "2026-10-07T00:00:00.000Z",
  hardware,
  catalog: [
    { id: "a", downloaded: { dir: "D:\\secret-folder\\a", complete: true }, plan: { expectedTokPerSec: [1, 2], bottleneck: "disk", warnings: ["slow-drive"] } },
    { id: "b", downloaded: null, plan: { refusal: { reason: "ram-floor", suggestion: "text" } } },
  ],
  engine: { running: true, kind: "colibri", slow: true },
  runtime: { tag: "v2.0.0", variant: "cpu", dir: "C:\\Users\\someone\\AppData" },
  stats: { a: { tokPerSec: 1.4, hitRate: 0.5, samples: 5 } },
  logText: "",
};

describe("tierDiagnostics", () => {
  it("keeps the newest 200 engine lines and nothing from other contexts", () => {
    const lines = Array.from({ length: 300 }, (_, i) => `t INFO [colibri] line ${i}`).concat("t INFO [chat] a prompt about taxes");
    const kept = diagnostics.engineLines(lines.join("\n"));
    expect(kept).toHaveLength(200);
    expect(kept[0]).toContain("line 100");
    expect(kept.join("\n")).not.toContain("taxes");
  });

  it("cuts long lines", () => {
    expect(diagnostics.engineLines(`[colibri] ${"x".repeat(1000)}`)[0].length).toBe(301);
  });

  it("reports plans, hardware and speeds without paths, drive names or serials", () => {
    const report = diagnostics.buildReport(base);
    const text = JSON.stringify(report);
    expect(report.plans.map((p) => p.refusal)).toEqual([null, "ram-floor"]);
    expect(report.engine.colibri).toEqual({ tag: "v2.0.0", variant: "cpu" });
    expect(report.speeds.a.samples).toBe(5);
    expect(text).not.toMatch(/secret-folder|someone|Samsung|serial-1|suggestion/);
  });

  it("still builds when nothing is known yet", () => {
    const report = diagnostics.buildReport({ appVersion: "x", createdAt: "y" });
    expect(report.hardware).toBeNull();
    expect(report.plans).toEqual([]);
    expect(report.engineLog).toEqual([]);
  });
});
