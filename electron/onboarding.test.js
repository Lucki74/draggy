import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const onboarding = require("./onboarding.cjs");
const { planOnboarding, readRecord, collectInputs, doneRecord, inProgressRecord, CURRENT_VERSION } = onboarding;

const fresh = { record: null, hasSettings: false, modelCount: 0, chatCount: 0, forced: false };
const done = { version: CURRENT_VERSION, status: "done", path: "local" };

describe("who sees the setup", () => {
  it("shows it on a fresh install", () => {
    expect(planOnboarding(fresh)).toBe("show");
  });

  it("shows it when forced, whatever is recorded", () => {
    expect(planOnboarding({ ...fresh, record: done, hasSettings: true, forced: true })).toBe("show");
  });

  it("resumes a setup left half way, even with its model already on disk", () => {
    const record = { version: 1, status: "in-progress" };
    expect(planOnboarding({ ...fresh, record, hasSettings: true, modelCount: 1 })).toBe("show");
  });

  it("stays out of the way once done", () => {
    expect(planOnboarding({ ...fresh, record: done, hasSettings: true })).toBe("done");
  });

  it("treats a record from an older version as done", () => {
    expect(planOnboarding({ ...fresh, record: { ...done, version: 0 } })).toBe("done");
  });

  it("adopts an existing user by their settings alone", () => {
    expect(planOnboarding({ ...fresh, hasSettings: true })).toBe("adopt");
  });

  it("adopts an existing user by a model on disk alone", () => {
    expect(planOnboarding({ ...fresh, modelCount: 2 })).toBe("adopt");
  });

  it("adopts an existing user by their chats alone", () => {
    expect(planOnboarding({ ...fresh, chatCount: 5 })).toBe("adopt");
  });
});

describe("reading the signs of prior use", () => {
  const readers = (overrides = {}) => ({
    readRaw: () => null,
    readSettings: () => null,
    countModels: () => 0,
    countChats: () => 0,
    forced: false,
    ...overrides,
  });
  const boom = () => {
    throw new Error("unreadable");
  };

  it("reads a fresh install as fresh", () => {
    expect(planOnboarding(collectInputs(readers()))).toBe("show");
  });

  it("counts any read that fails as prior use", () => {
    for (const failing of ["readSettings", "countModels", "countChats"]) {
      expect(planOnboarding(collectInputs(readers({ [failing]: boom }))), failing).toBe("adopt");
    }
  });

  it("counts a closed database, which reports no chat count at all, as prior use", () => {
    expect(planOnboarding(collectInputs(readers({ countChats: () => null })))).toBe("adopt");
  });

  it("finds saved settings", () => {
    expect(collectInputs(readers({ readSettings: () => '{"theme":"light"}' })).hasSettings).toBe(true);
    expect(collectInputs(readers({ readSettings: () => "" })).hasSettings).toBe(false);
  });

  it("passes the record and the switch through", () => {
    const inputs = collectInputs(readers({ readRaw: () => JSON.stringify(done), forced: "1" }));
    expect(inputs.record).toEqual(done);
    expect(inputs.forced).toBe(true);
  });
});

describe("the stored record", () => {
  it("reads a corrupt or foreign record as none", () => {
    for (const raw of [null, "", "{", "[]", "null", '"done"', '{"status":"done"}', '{"version":1,"status":"maybe"}']) {
      expect(readRecord(raw), String(raw)).toBeNull();
    }
    expect(planOnboarding({ ...fresh, record: readRecord("{") })).toBe("show");
  });

  it("writes the two shapes the spec names", () => {
    const now = new Date("2026-09-26T10:00:00Z");
    expect(inProgressRecord(now)).toEqual({ version: 1, status: "in-progress", startedAt: "2026-09-26T10:00:00.000Z" });
    expect(doneRecord("skipped", now)).toEqual({
      version: 1,
      status: "done",
      path: "skipped",
      completedAt: "2026-09-26T10:00:00.000Z",
    });
    expect(readRecord(JSON.stringify(doneRecord("local", now)))).not.toBeNull();
  });

  it("refuses a path it does not know", () => {
    expect(() => doneRecord("cloud")).toThrow();
    expect(() => doneRecord(undefined)).toThrow();
  });
});

describe("wired into the boot", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const ready = main.slice(main.indexOf("app.whenReady().then("));

  it("decides after the database opens and before any window exists", () => {
    const decided = ready.indexOf("onboardingPlan = decideOnboarding()");
    expect(decided).toBeGreaterThan(ready.indexOf("storage.init("));
    expect(decided).toBeGreaterThan(ready.indexOf("adoptLegacyDataFolder()"));
    expect(decided).toBeLessThan(ready.indexOf("createSplashWindow()"));
    expect(decided).toBeLessThan(ready.indexOf("createWindow("));
  });

  it("opens a new install on the setup, with the boot already counted as finished", () => {
    const show = ready.slice(ready.indexOf('if (onboardingPlan === "show") {'));
    const branch = show.slice(0, show.indexOf("} else {"));
    expect(branch).toContain("createWindow({ onboarding: true })");
    expect(branch).not.toContain("createSplashWindow()");
    expect(branch.indexOf("bootCompleted = true")).toBeGreaterThan(-1);
    expect(branch.indexOf("bootCompleted = true")).toBeLessThan(branch.indexOf("createWindow("));
    const created = main.slice(main.indexOf("function createWindow("));
    expect(created.slice(0, created.indexOf("\n}"))).toContain("?onboarding=true");
  });

  it("keeps a new install off the network until its setup is done", () => {
    // The filter lists come from three hosts; a new install fetches them only after choosing.
    expect(ready).toContain('if (onboardingPlan !== "show") startAdblocker();');
    expect(ready).not.toContain("adblocker.primeAdblocker(");
    const complete = main.slice(main.indexOf('ipcMain.handle("onboarding:complete"'));
    expect(complete.slice(0, complete.indexOf("\n});"))).toContain("startAdblocker();");
  });

  it("records an existing install as adopted", () => {
    const decide = main.slice(main.indexOf("function decideOnboarding()"));
    const body = decide.slice(0, decide.indexOf("\n}"));
    expect(body).toContain('doneRecord("adopted")');
    expect(body).toContain('process.env.DRAGGY_ONBOARDING === "1"');
  });
});

describe("starting the setup", () => {
  it("records a start once, and keeps the first start on a resume", () => {
    const now = new Date("2026-09-26T10:00:00Z");
    expect(onboarding.recordOnStart(null, now)).toEqual(inProgressRecord(now));
    expect(onboarding.recordOnStart({ version: 1, status: "in-progress", startedAt: "x" }, now)).toBeNull();
    expect(onboarding.recordOnStart({ version: 1, status: "done", path: "adopted" }, now)).toEqual(inProgressRecord(now));
  });
});

describe("the capture scripts", () => {
  const fs = require("node:fs");
  const path = require("node:path");

  it("record the setup as done before the app loads, so captures open on the app", () => {
    for (const script of ["screenshots.cjs", "wiki-shots.cjs"]) {
      const source = fs.readFileSync(path.join(__dirname, "..", "scripts", script), "utf8");
      const seeded = source.indexOf('onboarding.doneRecord("adopted")');
      expect(seeded, script).toBeGreaterThan(-1);
      expect(seeded, script).toBeLessThan(source.indexOf('"electron", "main.cjs"'));
    }
  });

  it("can capture the setup itself, forced on before the app loads", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "screenshots.cjs"), "utf8");
    const forced = source.indexOf('process.env.DRAGGY_ONBOARDING = "1"');
    expect(forced).toBeGreaterThan(-1);
    expect(forced).toBeLessThan(source.indexOf('"electron", "main.cjs"'));
  });
});
