/** The zip a person sends with a bug report. Built in the main process from the log files and a few
 * snapshots handed in by the caller. Every text file goes through the secret and path scrubbers, and
 * nothing here reads a chat, a prompt or a file the person opened. */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { scrubPaths, scrubSecrets } = require("./logScrub.cjs");

const EVENTS_LIMIT_BYTES = 20 * 1024 * 1024;
const ROTATIONS = 3;
const DUMP_LIMIT = 3;

/** Settings that say nothing about the person. Everything else is dropped, so a field added later
 * stays out until someone decides it is harmless. */
const SETTINGS_ALLOWLIST = new Set([
  "theme",
  "fontSize",
  "language",
  "modelName",
  "thinkingMode",
  "slowModelThinking",
  "colibriLossy",
  "webMode",
  "voiceEngine",
  "voiceRate",
  "voiceSounds",
  "interfaceSounds",
  "searchProvider",
  "codeModel",
  "codeThinkingMode",
  "codeWebMode",
  "codePermissionMode",
  "libraryEnabled",
  "embedModel",
  "showMetrics",
  "autoUpdate",
  "compactLimit",
  "fixedContextSize",
  "updateChannel",
  "imageModel",
]);

let crcTable = null;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) crc = crcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/** A zip with deflated entries and UTF-8 names. No zip64: the bundle stays far below 4 GB. */
function zipEntries(entries, now = new Date()) {
  const { time, day } = dosTime(now);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const packed = zlib.deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

/** The rotations of one log, oldest first: `name.3`, `name.2`, `name.1`, `name`. */
function rotationsOf(dir, name) {
  const files = [];
  for (let index = ROTATIONS; index >= 1; index--) files.push({ file: path.join(dir, `${name}.${index}`), label: `${name}.${index}` });
  files.push({ file: path.join(dir, name), label: name });
  return files.filter((entry) => fs.existsSync(entry.file));
}

/** The last `limit` bytes of some text, starting at a line boundary. */
function tailLines(text, limit) {
  if (Buffer.byteLength(text) <= limit) return text;
  const bytes = Buffer.from(text, "utf8");
  const cut = bytes.subarray(bytes.length - limit).toString("utf8");
  const newline = cut.indexOf("\n");
  return newline >= 0 ? cut.slice(newline + 1) : cut;
}

const DEBUG_LINE = /^\S+ DEBUG /;

function withoutDebug(text, jsonl) {
  return text
    .split("\n")
    .filter((line) => {
      if (!line) return true;
      if (jsonl) {
        try {
          return JSON.parse(line).level !== "DEBUG";
        } catch {
          return true;
        }
      }
      return !DEBUG_LINE.test(line);
    })
    .join("\n");
}

function scrubber({ homeDir, userName }) {
  return (text) => scrubPaths(scrubSecrets(text), { home: homeDir, user: userName });
}

function pickSettings(settings) {
  const kept = {};
  const removed = [];
  for (const [key, value] of Object.entries(settings && typeof settings === "object" ? settings : {})) {
    if (SETTINGS_ALLOWLIST.has(key)) kept[key] = value;
    else removed.push(key);
  }
  return { kept, removed };
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readme({ createdAt, appVersion, files, removed, includeDebug, includeDumps }) {
  const lines = [
    "Draggy diagnostics",
    `Created ${createdAt} by Draggy ${appVersion}.`,
    "",
    "What is inside",
    ...files.map((file) => `  ${file}`),
    "",
    "What was removed",
    "  Your home folder is written as ~ and your user name as <user> in every text file.",
    "  API keys, tokens and OAuth codes are replaced with [secret:...] markers. They are never logged.",
    "  Chats, prompts, replies and file contents are not here: Draggy hashes them before they reach a log.",
    `  Settings: only a short list of harmless fields is kept${removed.length ? ` (${removed.length} dropped)` : ""}.`,
    "  Providers and MCP servers are listed by type and status only, with no address or key.",
    includeDebug ? "" : "  Debug-level lines were left out.",
    includeDumps ? "  Crash dumps are binary, so their paths could not be scrubbed." : "  Crash dumps were left out.",
  ];
  return `${lines.filter((line, index) => line !== "" || lines[index - 1] !== "").join("\n")}\n`;
}

/** Collects the files without writing anything: the preview shows this list, and `saveBundle` zips it. */
function buildBundle(options = {}) {
  const {
    logDir,
    crashDumps = [],
    homeDir = "",
    userName = "",
    includeDebug = false,
    includeDumps = false,
    system = {},
    settings = {},
    providers = [],
    mcpServers = [],
    largeModelReport = null,
    appVersion = "",
    createdAt = new Date().toISOString(),
  } = options;
  const scrub = scrubber({ homeDir, userName });
  const entries = [];
  const text = (name, body) => entries.push({ name, data: Buffer.from(scrub(body), "utf8") });

  if (logDir) {
    for (const { file, label } of rotationsOf(logDir, "app.log")) {
      const raw = readIfExists(file);
      if (raw) text(label, includeDebug ? raw.toString("utf8") : withoutDebug(raw.toString("utf8"), false));
    }
    if (includeDebug) {
      for (const { file, label } of rotationsOf(logDir, "debug.log")) {
        const raw = readIfExists(file);
        if (raw) text(label, raw.toString("utf8"));
      }
    }
    const events = rotationsOf(logDir, "events.jsonl")
      .map(({ file }) => readIfExists(file)?.toString("utf8") ?? "")
      .join("");
    if (events) text("events.jsonl", tailLines(includeDebug ? events : withoutDebug(events, true), EVENTS_LIMIT_BYTES));
  }

  const { kept, removed } = pickSettings(settings);
  text("system.json", json({ createdAt, appVersion, ...system }));
  text("settings.json", json(kept));
  text("providers.json", json({ providers, mcpServers }));
  if (largeModelReport) text("large-models-report.json", json(largeModelReport));

  if (includeDumps) {
    for (const file of crashDumps.slice(0, DUMP_LIMIT)) {
      const raw = readIfExists(file);
      if (raw) entries.push({ name: `crashes/${path.basename(file)}`, data: raw });
    }
  }

  const names = entries.map((entry) => entry.name);
  entries.unshift({
    name: "README.txt",
    data: Buffer.from(readme({ createdAt, appVersion, files: names, removed, includeDebug, includeDumps }), "utf8"),
  });
  return { entries, removedSettings: removed };
}

function previewBundle(options) {
  const { entries } = buildBundle(options);
  return entries.map((entry) => ({ name: entry.name, size: entry.data.length }));
}

/** Writes the zip where the person picked. Returns the size in bytes. */
function saveBundle(options, target, now = new Date()) {
  const { entries } = buildBundle(options);
  const zip = zipEntries(entries, now);
  fs.writeFileSync(target, zip);
  return { file: target, bytes: zip.length, files: entries.length };
}

function defaultName(date = new Date()) {
  return `draggy-diagnostics-${date.toISOString().slice(0, 10)}.zip`;
}

module.exports = {
  SETTINGS_ALLOWLIST,
  buildBundle,
  crc32,
  defaultName,
  previewBundle,
  saveBundle,
  zipEntries,
};
