import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const binary = require("./colibriBinary.cjs");

const sha = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const asset = (name, size = 100, tag = "v2") => ({ name, size, browser_download_url: `https://github.com/JustVugg/colibri/releases/download/${tag}/${name}` });

const WINDOWS_ASSETS = [
  asset("colibri-v2.0.0-linux-x86_64.tar.gz"),
  asset("colibri-v2.0.0-macos-arm64.tar.gz"),
  asset("colibri-v2.0.0-windows-x86_64-cuda.zip"),
  asset("colibri-v2.0.0-windows-x86_64.zip"),
  asset("SHA256SUMS.txt"),
];

describe("asset selection", () => {
  const pick = (opts) => binary.pickColibriAssets(WINDOWS_ASSETS, { platformName: "win32", arch: "x64", ...opts });

  it("takes the main Windows archive, and the CUDA drop-in only on a capable card", () => {
    expect(pick({ cudaCapable: false })).toMatchObject({ cuda: null, variant: "vulkan" });
    expect(pick({ cudaCapable: false }).main.name).toBe("colibri-v2.0.0-windows-x86_64.zip");
    expect(pick({ cudaCapable: true }).cuda.name).toBe("colibri-v2.0.0-windows-x86_64-cuda.zip");
    expect(pick({ cudaCapable: true }).variant).toBe("cuda");
  });

  it("picks the Linux and macOS archives, and nothing for a platform without one", () => {
    expect(binary.pickColibriAssets(WINDOWS_ASSETS, { platformName: "linux", arch: "x64" }).main.name).toMatch(/linux/);
    expect(binary.pickColibriAssets(WINDOWS_ASSETS, { platformName: "darwin", arch: "arm64" }).main.name).toMatch(/macos/);
    expect(binary.pickColibriAssets(WINDOWS_ASSETS, { platformName: "win32", arch: "arm64" }).main).toBeNull();
  });

  it("reads the compute capability of the best card", () => {
    expect(binary.parseComputeCapability("8.9\n")).toBe(8.9);
    expect(binary.parseComputeCapability("7.5\n8.6\n")).toBe(8.6);
    expect(binary.parseComputeCapability("")).toBe(0);
  });

  it("asks nvidia-smi through the hidden launcher", async () => {
    const calls = [];
    const exec = (file, args, options, callback) => {
      calls.push([file, ...args]);
      callback(null, "8.9\n");
    };
    expect(await binary.detectCudaCapable({ exec })).toBe(true);
    expect(calls[0][0]).toBe("nvidia-smi");
    expect(await binary.detectCudaCapable({ exec: (f, a, o, cb) => cb(new Error("missing"), "") })).toBe(false);
    expect(await binary.detectCudaCapable({ exec: (f, a, o, cb) => cb(null, "7.5\n") })).toBe(false);
  });
});

describe("checksums and URLs", () => {
  it("parses sha256sum output with and without the binary marker", () => {
    const a = "a".repeat(64);
    const b = "B".repeat(64);
    expect(binary.parseSha256Sums(`${a}  one.zip\n${b} *two.zip\nnot a line\n`)).toEqual({ "one.zip": a, "two.zip": "b".repeat(64) });
  });

  it("allows GitHub and python.org over https only", () => {
    expect(binary.isAllowedUrl("https://github.com/JustVugg/colibri/releases/download/v2/x.zip")).toBe(true);
    expect(binary.isAllowedUrl("https://objects.githubusercontent.com/abc")).toBe(true);
    expect(binary.isAllowedUrl("https://www.python.org/ftp/python/3.12.10/x.zip")).toBe(true);
    expect(binary.isAllowedUrl("http://github.com/x")).toBe(false);
    expect(binary.isAllowedUrl("https://evil.example.com/x.zip")).toBe(false);
    expect(binary.isAllowedUrl("https://github.com.evil.example/x.zip")).toBe(false);
  });

  it("pins the embedded Python to a SHA-256", () => {
    expect(binary.PYTHON.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(binary.PYTHON.url).toContain("python-3.12.10-embed-amd64.zip");
  });
});

describe("installing", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "colibri-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  /** A fake release: archive bodies by asset name, hashed into a SHA256SUMS body. */
  const makeRelease = (tag, { corrupt = false } = {}) => {
    const bodies = {
      "colibri-v2.0.0-windows-x86_64.zip": Buffer.from(`main ${tag}`),
      "colibri-v2.0.0-windows-x86_64-cuda.zip": Buffer.from(`cuda ${tag}`),
    };
    const sums = Object.entries(bodies)
      .map(([name, body]) => `${corrupt ? "0".repeat(64) : sha(body)}  ${name}`)
      .join("\n");
    bodies["SHA256SUMS.txt"] = Buffer.from(sums);
    const assets = WINDOWS_ASSETS.filter((a) => bodies[a.name]).map((a) => asset(a.name, 100, tag));
    return { tag_name: tag, assets, bodies, byUrl: Object.fromEntries(assets.map((a) => [a.browser_download_url, bodies[a.name]])) };
  };
  const deps = (release) => ({
    platformName: "win32",
    arch: "x64",
    fetchStream: async (url) => Readable.from([release.byUrl[url]]),
    // The "archive" is unpacked into a folder holding the gateway script, and the CUDA one adds a DLL.
    extract: async (archive, destination) => {
      fs.mkdirSync(destination, { recursive: true });
      const cuda = archive.includes("cuda");
      fs.writeFileSync(path.join(destination, cuda ? "coli_cuda.dll" : "openai_server.py"), fs.readFileSync(archive));
    },
  });

  it("installs the main archive and the CUDA drop-in into one version folder", async () => {
    const release = makeRelease("v2.0.0");
    const result = await binary.installColibri(dir, { release, cudaCapable: true, deps: deps(release) });
    expect(result).toMatchObject({ tag: "v2.0.0", variant: "cuda" });
    expect(fs.existsSync(path.join(result.dir, "openai_server.py"))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, "coli_cuda.dll"))).toBe(true);
    expect(binary.readState(dir)).toMatchObject({ current: "v2.0.0", previous: null, variant: "cuda" });
    expect(fs.readdirSync(path.join(dir, "colibri")).filter((n) => n.startsWith(".stage"))).toEqual([]);
  });

  it("rejects an archive whose hash is not the published one and installs nothing", async () => {
    const release = makeRelease("v2.0.0", { corrupt: true });
    await expect(binary.installColibri(dir, { release, cudaCapable: false, deps: deps(release) })).rejects.toThrow(/Checksum mismatch/);
    expect(binary.readState(dir).current).toBeNull();
    expect(fs.existsSync(path.join(dir, "colibri", "v2.0.0"))).toBe(false);
    expect(fs.readdirSync(path.join(dir, "colibri")).filter((n) => n.startsWith(".stage"))).toEqual([]);
  });

  it("refuses a release without a checksum list or an entry for its archive", async () => {
    const release = makeRelease("v2.0.0");
    const noSums = { ...release, assets: release.assets.filter((a) => a.name !== "SHA256SUMS.txt") };
    await expect(binary.installColibri(dir, { release: noSums, cudaCapable: false, deps: deps(release) })).rejects.toThrow(/SHA256SUMS/);
    const partial = makeRelease("v2.0.0");
    const sumsUrl = partial.assets.find((a) => a.name === "SHA256SUMS.txt").browser_download_url;
    partial.byUrl[sumsUrl] = Buffer.from(`${"a".repeat(64)}  other.zip`);
    await expect(binary.installColibri(dir, { release: partial, cudaCapable: false, deps: deps(partial) })).rejects.toThrow(/no entry/);
  });

  it("keeps the old version for rollback, drops older ones, and rolls back", async () => {
    for (const tag of ["v2.0.0", "v2.1.0", "v2.2.0"]) {
      const release = makeRelease(tag);
      await binary.installColibri(dir, { release, cudaCapable: false, deps: deps(release) });
    }
    expect(binary.readState(dir)).toMatchObject({ current: "v2.2.0", previous: "v2.1.0" });
    const folders = fs.readdirSync(path.join(dir, "colibri")).filter((n) => n.startsWith("v"));
    expect(folders.sort()).toEqual(["v2.1.0", "v2.2.0"]);
    expect(binary.rollback(dir)).toBe("v2.1.0");
    expect(binary.readState(dir)).toMatchObject({ current: "v2.1.0", previous: "v2.2.0" });
  });

  it("has nothing to roll back to on a first install", async () => {
    const release = makeRelease("v2.0.0");
    await binary.installColibri(dir, { release, cudaCapable: false, deps: deps(release) });
    expect(binary.rollback(dir)).toBeNull();
  });

  it("keeps the working version when an update fails", async () => {
    const good = makeRelease("v2.0.0");
    await binary.installColibri(dir, { release: good, cudaCapable: false, deps: deps(good) });
    const bad = makeRelease("v2.1.0", { corrupt: true });
    await expect(binary.installColibri(dir, { release: bad, cudaCapable: false, deps: deps(bad) })).rejects.toThrow();
    expect(binary.readState(dir).current).toBe("v2.0.0");
    expect(binary.isInstalled(dir, "v2.0.0")).toBe(true);
  });

  it("picks the newest stable release from the list when none is named", async () => {
    const older = makeRelease("v2.0.0");
    const newer = makeRelease("v2.1.0");
    const draft = { ...makeRelease("v3.0.0"), draft: true };
    const all = { byUrl: { ...older.byUrl, ...newer.byUrl, ...draft.byUrl } };
    const result = await binary.installColibri(dir, { cudaCapable: false, deps: { ...deps(all), fetchJson: async () => [draft, newer, older] } });
    expect(result.tag).toBe("v2.1.0");
  });
});

describe("embedded Python", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "colibri-py-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const extractPython = async (archive, destination) => {
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, "python.exe"), "exe");
  };

  it("refuses a download that does not match the pinned hash", async () => {
    await expect(
      binary.ensurePython(dir, { deps: { fetchStream: async () => Readable.from([Buffer.from("tampered")]), extract: extractPython } }),
    ).rejects.toThrow(/Checksum mismatch/);
    expect(fs.existsSync(path.join(binary.pythonDir(dir), "python.exe"))).toBe(false);
  });

  it("writes a path file that lets the gateway find its sibling modules", () => {
    const py = path.join(dir, "py");
    fs.mkdirSync(py);
    binary.writePythonPath(py, "C:\\app\\colibri\\v2.0.0");
    const text = fs.readFileSync(path.join(py, "python312._pth"), "utf8");
    expect(text.split(/\r?\n/)).toEqual(["python312.zip", ".", "C:\\app\\colibri\\v2.0.0", ""]);
  });
});
