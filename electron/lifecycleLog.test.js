import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const logger = require("./logger.cjs");
const life = require("./lifecycleLog.cjs");
const connectivity = require("./connectivity.cjs");

let tempDir;
let files;
const events = async () => {
  await logger.flush();
  return fs
    .readFileSync(files.eventsFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-life-test-"));
  files = logger.init({ getPath: () => tempDir, getName: () => "Draggy", getVersion: () => "0" });
});
afterEach(async () => {
  await logger.closeStreams();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("process events", () => {
  it("logs child, renderer, hang, load and certificate events with the host only", async () => {
    const app = new EventEmitter();
    life.watchApp(app);
    app.emit("child-process-gone", {}, { type: "GPU", reason: "crashed", exitCode: 5, serviceName: "gpu" });
    app.emit("render-process-gone", {}, { getURL: () => "https://a.test/path?token=abc" }, { reason: "oom", exitCode: 9 });
    const win = new EventEmitter();
    win.getTitle = () => "Draggy";
    app.emit("browser-window-created", {}, win);
    win.emit("unresponsive");
    win.emit("responsive");
    const contents = new EventEmitter();
    app.emit("web-contents-created", {}, contents);
    contents.emit("did-fail-load", {}, -105, "NAME_NOT_RESOLVED", "https://b.test/x?q=hidden", true);
    contents.emit("did-fail-load", {}, -3, "ABORTED", "https://c.test/", true);
    contents.emit("certificate-error", {}, "https://d.test/p?k=1", "ERR_CERT_DATE_INVALID");

    const list = await events();
    const text = JSON.stringify(list);
    expect(list.find((e) => e.msg.startsWith("GPU process gone"))).toMatchObject({ level: "ERROR", data: { exitCode: 5, serviceName: "gpu" } });
    expect(list.find((e) => e.msg === "renderer gone: oom").data.host).toBe("a.test");
    expect(list.find((e) => e.msg === "window stopped responding").level).toBe("WARN");
    expect(list.find((e) => e.msg === "window responding again").data.hungMs).toBeGreaterThanOrEqual(0);
    expect(list.filter((e) => e.msg === "page failed to load")).toHaveLength(1);
    expect(list.find((e) => e.msg === "certificate error").data.host).toBe("d.test");
    expect(text).not.toContain("token=abc");
    expect(text).not.toContain("hidden");
  });

  it("logs power transitions with the sleep length", async () => {
    const power = new EventEmitter();
    let t = 1000;
    life.watchPower(power, () => t);
    power.emit("suspend");
    t = 61000;
    power.emit("resume");
    power.emit("on-battery");
    const list = await events();
    expect(list.find((e) => e.msg === "resume").data.sleptMs).toBe(60000);
    expect(list.some((e) => e.msg === "on-battery" && e.scope === "power")).toBe(true);
  });

  it("starts the crash reporter without upload and reports a failure", () => {
    const started = [];
    const app = { getPath: () => "dumps" };
    expect(life.startCrashReporter({ start: (options) => started.push(options) }, app)).toBe(true);
    expect(started[0].uploadToServer).toBe(false);
    const failing = {
      start: () => {
        throw new Error("no");
      },
    };
    expect(life.startCrashReporter(failing, app)).toBe(false);
  });

  it("finds dumps written since the previous session began", async () => {
    const dumps = path.join(tempDir, "crashes", "reports");
    fs.mkdirSync(dumps, { recursive: true });
    fs.writeFileSync(path.join(dumps, "new.dmp"), "x");
    const old = path.join(dumps, "old.dmp");
    fs.writeFileSync(old, "x");
    fs.utimesSync(old, new Date("2020-01-01"), new Date("2020-01-01"));
    const found = life.reportPreviousDumps({ getPath: () => path.join(tempDir, "crashes") }, new Date(Date.now() - 60000).toISOString());
    expect(found.map((file) => path.basename(file))).toEqual(["new.dmp"]);
    expect((await events()).some((e) => e.msg.startsWith("native crash dump"))).toBe(true);
  });
});

describe("timelines and samples", () => {
  it("prints one startup line with the step lengths", async () => {
    let t = 0;
    const timeline = life.createTimeline("startup", { now: () => t });
    t = 310;
    timeline.mark("ready");
    t = 405;
    timeline.mark("window");
    t = 1285;
    timeline.mark("renderer");
    expect(timeline.finish()).toBe("startup 1285 ms (ready 310, window 95, renderer 880)");
    expect(timeline.finish()).toBeNull();
    expect((await events()).filter((e) => e.msg.startsWith("startup 1285"))).toHaveLength(1);
  });

  it("samples memory at DEBUG and warns on an hour of heap growth", async () => {
    let heap = 100 * 1048576;
    let t = 0;
    const sampler = life.startMemorySampler({
      app: { getAppMetrics: () => [{ type: "Browser", memory: { workingSetSize: 2048 } }] },
      getChildren: () => [{ pid: 7, bin: "llama-server" }],
      sampleChild: async () => 4200,
      intervalMs: 3600000,
      now: () => t,
      usage: () => ({ rss: 1, heapUsed: heap, external: 1 }),
    });
    await sampler.sample();
    heap += 400 * 1048576;
    t = 1800000;
    await sampler.sample();
    sampler.stop();
    const list = await events();
    expect(list.find((e) => e.msg === "memory").data.children[0]).toEqual({ bin: "llama-server", pid: 7, rssMB: 4200 });
    expect(list.find((e) => e.msg.startsWith("main heap grew")).level).toBe("WARN");
  });

  it("describes the machine once", async () => {
    const gpu = { gpuDevice: [{ active: true, vendorId: 1, deviceId: 2, driverVersion: "9" }] };
    const data = await life.logMachineSnapshot({
      app: { getLocale: () => "fr", getGPUInfo: async () => gpu },
      screen: { getAllDisplays: () => [{ size: { width: 1920, height: 1080 }, scaleFactor: 1.5 }] },
      platform: { detectVideoMemoryGB: async () => 8 },
      modelsDir: tempDir,
    });
    expect(data).toMatchObject({ locale: "fr", vramGB: 8, gpu: { driver: "9" }, displays: [{ w: 1920, h: 1080, scale: 1.5 }] });
    expect((await events()).some((e) => e.msg === "machine")).toBe(true);
  });

  it("logs a connectivity change once", async () => {
    const request = (online) => (_url, _options, callback) => {
      const req = new EventEmitter();
      req.setTimeout = () => {};
      req.destroy = () => {};
      req.end = () => setImmediate(() => (online ? callback({ statusCode: 200, resume() {} }) : req.emit("error", new Error("x"))));
      return req;
    };
    await connectivity.checkConnectivity({ request: request(true) });
    await connectivity.checkConnectivity({ request: request(true) });
    await connectivity.checkConnectivity({ request: request(false) });
    const messages = (await events()).filter((e) => e.scope === "net").map((e) => e.msg);
    expect(messages).toEqual(["went offline"]);
  });
});
