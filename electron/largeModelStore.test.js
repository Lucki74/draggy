import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const store = require("./largeModelStore.cjs");

const sha = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const GB = 1e9;

describe("manifest", () => {
  it("reads files, sizes and LFS hashes, and drops folders and unsafe paths", () => {
    const hash = "a".repeat(64);
    const files = store.parseManifest([
      { type: "directory", path: "experts" },
      { type: "file", path: "config.json", size: 120 },
      { type: "file", path: "experts/0.bin", size: 134, lfs: { oid: hash, size: 9000 } },
      { type: "file", path: "../escape", size: 1 },
    ]);
    expect(files).toEqual([
      { path: "config.json", size: 120, sha256: null },
      { path: "experts/0.bin", size: 9000, sha256: hash },
    ]);
    expect(store.totalBytes(files)).toBe(9120);
    expect(store.parseManifest(null)).toEqual([]);
  });
});

describe("fetching the manifest", () => {
  const page = (entries, next) => ({ ok: true, json: async () => entries, headers: { get: () => (next ? `<${next}>; rel="next"` : null) } });

  it("follows the next-page links", async () => {
    const urls = [];
    const pages = [page([{ type: "file", path: "a", size: 1 }], "https://huggingface.co/p2"), page([{ type: "file", path: "b", size: 2 }])];
    const files = await store.fetchManifest("o/m", { fetchImpl: async (url) => (urls.push(url), pages.shift()) });
    expect(files.map((f) => f.path)).toEqual(["a", "b"]);
    expect(urls[0]).toContain("/api/models/o/m/tree/main?recursive=true");
    expect(urls[1]).toBe("https://huggingface.co/p2");
  });

  it("refuses a malformed repository id and a failing server", async () => {
    await expect(store.fetchManifest("../x", { fetchImpl: async () => page([]) })).rejects.toThrow(/Invalid/);
    await expect(store.fetchManifest("o/m", { fetchImpl: async () => ({ ok: false, status: 404 }) })).rejects.toThrow(/404/);
  });
});

describe("choosing a drive", () => {
  const drive = (volume, bus, role, freeGB, expertMBps) => ({ volume, bus, role, freeBytes: freeGB * GB, benchmark: expertMBps ? { expertMBps } : null });
  const files = [{ path: "a", size: 100 * GB }];

  it("takes the faster drive that has size plus 10% free", () => {
    const pick = store.chooseVolume(files, [drive("C:\\", "nvme", "good", 105, 6000), drive("D:\\", "nvme", "good", 500, 5000)]);
    expect(pick).toMatchObject({ ok: true, volume: "D:\\" });
  });

  it("refuses when nothing has room, with what is needed", () => {
    const pick = store.chooseVolume(files, [drive("C:\\", "nvme", "good", 105, 6000)]);
    expect(pick).toMatchObject({ ok: false, reason: "no-space", needBytes: 110 * GB });
  });

  it("refuses USB drives outright", () => {
    expect(store.chooseVolume(files, [drive("E:\\", "usb", "refuse", 2000, 400)])).toEqual({ ok: false, reason: "usb-drive" });
  });
});

describe("planning a resumed download", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "large-plan-"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const drive = (volume, freeGB, expertMBps) => ({ volume, bus: "nvme", role: "good", freeBytes: freeGB * GB, benchmark: { expertMBps } });
  const files = [{ path: "experts/0.bin", size: 100 * GB }];

  it("stays on the drive that holds the partial and asks room for only the rest", () => {
    const slow = path.join(dir, "slow");
    const fast = path.join(dir, "fast");
    const target = store.defaultDir(slow, "o/m");
    fs.mkdirSync(path.join(target, "experts"), { recursive: true });
    fs.writeFileSync(path.join(target, store.PARTIAL_MARKER), "{}");
    // 90 GB of the 100 are on disk, so 10 GB + 10% is enough room. The size is stubbed because not
    // every filesystem a runner has can hold a sparse file that large.
    const partial = path.join(target, "experts", "0.bin.partial");
    fs.closeSync(fs.openSync(partial, "w"));
    const realStat = fs.statSync;
    vi.spyOn(fs, "statSync").mockImplementation((p, ...rest) => {
      const stat = realStat(p, ...rest);
      return p === partial ? { ...stat, size: 90 * GB } : stat;
    });

    const pick = store.planTarget("o/m", files, [drive(slow, 12, 1000), drive(fast, 500, 6000)]);
    expect(pick).toMatchObject({ ok: true, volume: slow, resume: true, needBytes: 11 * GB });
    expect(store.chooseVolume(files, [drive(slow, 12, 1000)])).toMatchObject({ ok: false });
  });

  it("picks a drive as usual when nothing has been started", () => {
    expect(store.planTarget("o/m", files, [drive(path.join(dir, "a"), 500, 1000), drive(path.join(dir, "b"), 500, 6000)])).toMatchObject({ ok: true, volume: path.join(dir, "b") });
  });
});

describe("downloading", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "large-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const bodies = { "config.json": Buffer.from("{}"), "experts/0.bin": Buffer.from("0123456789abcdef"), "experts/1.bin": Buffer.from("fedcba9876543210") };
  const files = Object.entries(bodies).map(([name, body]) => ({ path: name, size: body.length, sha256: name.endsWith(".bin") ? sha(body) : null }));
  const run = (fetcher, extra = {}) => store.downloadRepo({ repo: "o/m", files, destDir: path.join(dir, "m"), resolveUrl: (file) => file.path, fetcher, concurrency: 2, ...extra });

  /** Serves the bodies by path; `corrupt[url]` is how many times that file is served wrong. */
  function server({ corrupt = {} } = {}) {
    const calls = [];
    const fetcher = async (url, { start }) => {
      calls.push({ url, start });
      const wrong = (corrupt[url] || 0) > 0;
      if (wrong) corrupt[url] -= 1;
      const body = wrong ? Buffer.from("x".repeat(bodies[url].length)) : bodies[url];
      return { status: start > 0 ? 206 : 200, stream: Readable.from([body.subarray(start)]) };
    };
    return { calls, fetcher };
  }

  it("downloads every file and clears the partial marker only when all are in place", async () => {
    const { fetcher } = server();
    const result = await run(fetcher);
    expect(result).toMatchObject({ ok: true });
    expect(fs.readFileSync(path.join(dir, "m", "experts", "1.bin"))).toEqual(bodies["experts/1.bin"]);
    expect(store.isComplete(path.join(dir, "m"))).toBe(true);
  });

  it("leaves the marker when a file fails", async () => {
    const result = await run(async () => {
      throw new Error("boom");
    });
    expect(result).toMatchObject({ ok: false, error: "boom" });
    expect(store.isComplete(path.join(dir, "m"))).toBe(false);
  });

  it("resumes a partial file from its size and skips finished ones", async () => {
    const target = path.join(dir, "m");
    fs.mkdirSync(path.join(target, "experts"), { recursive: true });
    fs.writeFileSync(path.join(target, "config.json"), bodies["config.json"]);
    fs.writeFileSync(path.join(target, "experts", "0.bin.partial"), bodies["experts/0.bin"].subarray(0, 6));
    const { fetcher, calls } = server();
    const result = await run(fetcher);
    expect(result.ok).toBe(true);
    expect(calls.find((c) => c.url === "experts/0.bin").start).toBe(6);
    expect(calls.some((c) => c.url === "config.json")).toBe(false);
    expect(fs.readFileSync(path.join(target, "experts", "0.bin"))).toEqual(bodies["experts/0.bin"]);
  });

  it("starts a file over when the server ignores the range", async () => {
    const target = path.join(dir, "m");
    fs.mkdirSync(path.join(target, "experts"), { recursive: true });
    fs.writeFileSync(path.join(target, "experts", "0.bin.partial"), bodies["experts/0.bin"].subarray(0, 6));
    const fetcher = async (url) => ({ status: 200, stream: Readable.from([bodies[url]]) });
    expect((await run(fetcher)).ok).toBe(true);
    expect(fs.readFileSync(path.join(target, "experts", "0.bin"))).toEqual(bodies["experts/0.bin"]);
  });

  it("re-downloads only the file whose hash failed", async () => {
    const { fetcher, calls } = server({ corrupt: { "experts/0.bin": 1 } });
    const result = await run(fetcher);
    expect(result.ok).toBe(true);
    const count = (name) => calls.filter((c) => c.url === name).length;
    expect(count("experts/0.bin")).toBe(2);
    expect(count("experts/1.bin")).toBe(1);
    expect(count("config.json")).toBe(1);
  });

  it("fails when a file keeps failing its hash", async () => {
    const { fetcher } = server({ corrupt: { "experts/0.bin": 5 } });
    const result = await run(fetcher);
    expect(result).toMatchObject({ ok: false });
    expect(result.error).toMatch(/Checksum mismatch/);
  });

  it("reports progress with a rate and an ETA", async () => {
    const { fetcher } = server();
    const seen = [];
    let clock = 0;
    await run(fetcher, { onProgress: (p) => seen.push(p), now: () => (clock += 1000) });
    expect(seen.at(-1).doneBytes).toBe(store.totalBytes(files));
    expect(seen.some((p) => p.etaSeconds > 0)).toBe(true);
  });

  it("measures speed and time left from this run's bytes, not the ones it already had", async () => {
    const target = path.join(dir, "m");
    fs.mkdirSync(path.join(target, "experts"), { recursive: true });
    fs.writeFileSync(path.join(target, "config.json"), bodies["config.json"]);
    fs.writeFileSync(path.join(target, "experts", "0.bin"), bodies["experts/0.bin"]);
    const { fetcher } = server();
    const seen = [];
    let clock = 0;
    await run(fetcher, { onProgress: (p) => seen.push(p), now: () => (clock += 1000) });
    const first = seen[0];
    // Two of three files were already there: nothing moved yet, so there is no rate to quote.
    expect(first.doneBytes).toBe(bodies["config.json"].length + bodies["experts/0.bin"].length);
    expect(first.bytesPerSecond).toBe(0);
    expect(first.etaSeconds).toBeNull();
    expect(seen.at(-1).bytesPerSecond).toBeLessThanOrEqual(bodies["experts/1.bin"].length);
  });

  it("never counts more than the file has when a partial is longer than the file", async () => {
    const target = path.join(dir, "m");
    fs.mkdirSync(path.join(target, "experts"), { recursive: true });
    fs.writeFileSync(path.join(target, "experts", "0.bin.partial"), Buffer.alloc(500, 1));
    const { fetcher } = server();
    const seen = [];
    await run(fetcher, { onProgress: (p) => seen.push(p) });
    expect(Math.max(...seen.map((p) => p.doneBytes))).toBeLessThanOrEqual(store.totalBytes(files));
    expect(seen.at(-1).doneBytes).toBe(store.totalBytes(files));
  });

  it("stops when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetcher } = server();
    expect(await run(fetcher, { signal: controller.signal })).toMatchObject({ ok: false, error: "cancelled" });
  });
});

describe("bandwidth cap and mirrors", () => {
  it("waits once a stream goes over the cap", async () => {
    const waits = [];
    let clock = 0;
    const throttle = store.createThrottle(1000, () => clock, async (ms) => waits.push(ms));
    clock = 1000;
    await throttle(500);
    expect(waits).toEqual([]);
    await throttle(1500);
    expect(waits[0]).toBe(1000);
    expect(store.createThrottle(0)).toBeNull();
  });

  it("keeps mirror paths per model across restarts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mirrors-"));
    try {
      store.createMirrorStore(dir).set("glm-5.2", ["E:\\m", "E:\\m", "F:\\m"]);
      const again = store.createMirrorStore(dir);
      expect(again.get("glm-5.2")).toEqual(["E:\\m", "F:\\m"]);
      again.set("glm-5.2", []);
      expect(store.createMirrorStore(dir).get("glm-5.2")).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds Hugging Face file addresses", () => {
    expect(store.hfUrl("o/m", { path: "experts/a b.bin" })).toBe("https://huggingface.co/o/m/resolve/main/experts/a%20b.bin?download=true");
  });
});

describe("finding a downloaded model", () => {
  it("reports the folder on the volume that has it and whether it finished", () => {
    const volume = fs.mkdtempSync(path.join(os.tmpdir(), "vol-"));
    try {
      expect(store.locate("o/m", [volume])).toBeNull();
      const dir = store.defaultDir(volume, "o/m");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, store.PARTIAL_MARKER), "{}");
      expect(store.locate("o/m", [volume])).toEqual({ dir, complete: false });
      fs.rmSync(path.join(dir, store.PARTIAL_MARKER));
      expect(store.locate("o/m", ["Z:\nope", volume])).toEqual({ dir, complete: true });
    } finally {
      fs.rmSync(volume, { recursive: true, force: true });
    }
  });
});
