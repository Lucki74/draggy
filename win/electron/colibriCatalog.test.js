import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { CATALOG, find } = require("./colibriCatalog.cjs");
const { planModel, describeColibri } = require("./tierPlanner.cjs");

const GB = 1024 ** 3;
const hardware = {
  ram: { totalGB: 32, availableGB: 20 },
  gpu: { name: "RTX", vramGB: 8, unified: false },
  cpu: { logical: 16, physical: 8, performance: 8 },
  drives: [{ volume: "D:\\", role: "good", bus: "nvme", freeBytes: 2000 * GB, benchmark: { expertMBps: 3000 } }],
};
const plan = (id) => planModel({ model: describeColibri(find(id)), hardware, engines: { llamacpp: true } });

describe("colibri catalog", () => {
  it("lists unique ids and repositories the downloader accepts", () => {
    expect(new Set(CATALOG.map((m) => m.id)).size).toBe(CATALOG.length);
    for (const entry of CATALOG) expect(entry.repo).toMatch(/^\w[\w.-]*\/\w[\w.-]*$/);
  });

  it("plans every model without throwing and refuses with a reason", () => {
    for (const entry of CATALOG) {
      const result = plan(entry.id);
      expect(result.engine === "colibri" || result.refusal?.reason).toBeTruthy();
    }
  });

  it("keeps a 19 GB model out of the disk tier on 32 GB of RAM", () => {
    expect(plan("qwen3-coder-30b-a3b").disk.coldGB).toBe(0);
  });

  it("streams a 167 GB model from disk and carries the estimate flag through", () => {
    const result = plan("dsv4-flash");
    expect(result.disk.coldGB).toBeGreaterThan(100);
    expect(result.expectedTokPerSec[1]).toBeGreaterThan(0);
    expect(plan("glm-53").estimated).toBe(true);
  });

  it("refuses a model whose engine floor exceeds usable RAM", () => {
    expect(plan("inkling").refusal.reason).toBe("ram-floor");
  });
});
