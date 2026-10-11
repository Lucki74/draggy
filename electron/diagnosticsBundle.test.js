import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const logger = require("./logger.cjs");
const bundle = require("./diagnosticsBundle.cjs");

const HOME = "C:\\Users\\zoltan";
const SECRET = "sk-test-0123456789abcdef0123456789abcdef";
const CHAT = "my landlord owes me two thousand euros";

let tempDir;
let logDir;

/** Reads a zip written by `zipEntries` back into `{ name: Buffer }`. */
function unzip(buffer) {
  const files = {};
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  for (let index = 0; index < count; index++) {
    const packedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const data = zlib.inflateRawSync(buffer.subarray(dataStart, dataStart + packedSize));
    expect(bundle.crc32(data)).toBe(buffer.readUInt32LE(cursor + 16));
    files[name] = data;
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-bundle-test-"));
  const files = logger.init({ getPath: () => tempDir, getName: () => "Draggy", getVersion: () => "0" });
  logDir = path.dirname(files.appFile);
  logger.log.info("files", `opened ${HOME}\\Documents\\notes.txt as zoltan`);
  logger.log.info("providers", "request failed", { url: `https://api.example.test/v1?key=${SECRET}`, headers: { authorization: `Bearer ${SECRET}` } });
  logger.log.info("agent", "turn sent", { prompt: CHAT, reply: CHAT, text: CHAT });
  logger.log.debug("engine", "a debug line only the verbose bundle keeps");
  logger.logEntries([{ level: "INFO", context: "renderer", message: "seen", data: { content: CHAT, input: CHAT } }]);
  await logger.flush();
});

afterEach(async () => {
  await logger.closeStreams();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const options = (extra = {}) => ({
  logDir,
  homeDir: HOME,
  userName: "zoltan",
  appVersion: "1.2.3",
  system: { platform: "win32", note: `at ${HOME}\\AppData` },
  settings: { language: "fr", theme: "dark", customInstructions: [CHAT], searxngUrl: `https://me:${SECRET}@host.test`, braveKey: SECRET },
  providers: [{ type: "openai", kind: "cloud", hasKey: true }],
  mcpServers: [{ id: "files", status: "running", tools: 3 }],
  ...extra,
});

describe("diagnostics bundle", () => {
  it("holds no home path, user name, secret or chat text", () => {
    expect(fs.readFileSync(path.join(logDir, "app.log"), "utf8")).toContain("zoltan");
    const zip = bundle.saveBundle(options(), path.join(tempDir, "out.zip"));
    const files = unzip(fs.readFileSync(zip.file));
    const all = Object.values(files).map((data) => data.toString("utf8")).join("\n");
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["README.txt", "app.log", "events.jsonl", "system.json", "settings.json", "providers.json"]));
    expect(all).not.toContain("zoltan");
    expect(all).not.toContain(HOME);
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain(CHAT);
    expect(all).toContain("~");
    expect(all).toContain("<user>");
  });

  it("keeps only the harmless settings", () => {
    const files = unzip(bundle.zipEntries(bundle.buildBundle(options()).entries));
    expect(JSON.parse(files["settings.json"].toString("utf8"))).toEqual({ language: "fr", theme: "dark" });
    expect(files["README.txt"].toString("utf8")).toContain("harmless fields");
  });

  it("leaves debug lines out unless asked", () => {
    const quiet = unzip(bundle.zipEntries(bundle.buildBundle(options()).entries));
    expect(quiet["events.jsonl"].toString("utf8")).not.toContain("only the verbose bundle keeps");
    expect(quiet["debug.log"]).toBeUndefined();
    const verbose = unzip(bundle.zipEntries(bundle.buildBundle(options({ includeDebug: true })).entries));
    expect(verbose["events.jsonl"].toString("utf8")).toContain("only the verbose bundle keeps");
    expect(verbose["debug.log"]).toBeDefined();
    expect(verbose["debug.log"].toString("utf8")).not.toContain(CHAT);
  });

  it("lists crash dumps only when asked, three at most", () => {
    const dumps = ["a", "b", "c", "d"].map((name) => {
      const file = path.join(tempDir, `${name}.dmp`);
      fs.writeFileSync(file, name);
      return file;
    });
    const without = bundle.previewBundle(options({ crashDumps: dumps })).map((file) => file.name);
    expect(without.some((name) => name.startsWith("crashes/"))).toBe(false);
    const withDumps = bundle.previewBundle(options({ crashDumps: dumps, includeDumps: true })).map((file) => file.name);
    expect(withDumps.filter((name) => name.startsWith("crashes/"))).toHaveLength(3);
  });

  it("previews the same files it saves, with sizes", () => {
    const preview = bundle.previewBundle(options());
    const saved = unzip(fs.readFileSync(bundle.saveBundle(options(), path.join(tempDir, "again.zip")).file));
    expect(preview.map((file) => file.name).sort()).toEqual(Object.keys(saved).sort());
    for (const file of preview) expect(saved[file.name].length).toBe(file.size);
  });

  it("caps events.jsonl at 20 MB from the newest end", () => {
    const line = `${JSON.stringify({ level: "INFO", msg: "x".repeat(1000) })}\n`;
    fs.writeFileSync(path.join(logDir, "events.jsonl.1"), line.repeat(12000));
    fs.writeFileSync(path.join(logDir, "events.jsonl"), line.repeat(12000));
    const events = bundle.buildBundle(options()).entries.find((entry) => entry.name === "events.jsonl");
    expect(events.data.length).toBeLessThanOrEqual(20 * 1024 * 1024);
    expect(events.data.length).toBeGreaterThan(15 * 1024 * 1024);
  });
});
