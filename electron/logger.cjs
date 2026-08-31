const fs = require("fs");
const path = require("path");
const os = require("os");

const MAX_BYTES = 512 * 1024;
const KEEP_ROTATIONS = 2;

let logDir = null;
let logFile = null;
let stream = null;

function ensureStream() {
  if (stream || !logFile) return stream;

  fs.mkdirSync(logDir, { recursive: true });
  rotateIfLarge();
  stream = fs.createWriteStream(logFile, { flags: "a" });
  stream.on("error", () => {
    stream = null;
  });
  return stream;
}

function rotateIfLarge() {
  try {
    if (!fs.existsSync(logFile)) return;
    if (fs.statSync(logFile).size < MAX_BYTES) return;

    for (let index = KEEP_ROTATIONS; index >= 1; index--) {
      const older = `${logFile}.${index}`;
      const newer = index === 1 ? logFile : `${logFile}.${index - 1}`;
      if (fs.existsSync(older) && index === KEEP_ROTATIONS) fs.unlinkSync(older);
      if (fs.existsSync(newer)) fs.renameSync(newer, `${logFile}.${index}`);
    }
  } catch {
    /* a failed rotation must never stop the app */
  }
}

function stamp() {
  return new Date().toISOString();
}

function serialise(value) {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}\n${value.stack || ""}`;
  }
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function write(level, scope, parts) {
  const line = `${stamp()} ${level} [${scope}] ${parts.map(serialise).join(" ")}\n`;
  const target = ensureStream();
  if (target) target.write(line);
  if (level === "ERROR") console.error(line.trimEnd());
}

const log = {
  info: (scope, ...parts) => write("INFO", scope, parts),
  warn: (scope, ...parts) => write("WARN", scope, parts),
  error: (scope, ...parts) => write("ERROR", scope, parts),
};

function init(app) {
  logDir = path.join(app.getPath("userData"), "logs");
  logFile = path.join(logDir, "draggy.log");

  ensureStream();

  log.info(
    "boot",
    `${app.getName()} ${app.getVersion()} | electron ${process.versions.electron} | node ${process.versions.node} | ${process.platform} ${os.arch()} ${os.release()}`,
  );

  process.on("uncaughtException", (error) => {
    log.error("uncaughtException", error);
  });

  process.on("unhandledRejection", (reason) => {
    log.error("unhandledRejection", reason);
  });

  return { logDir, logFile };
}

function attachWindow(window, name) {
  window.webContents.on("render-process-gone", (_event, details) => {
    log.error("renderer", `${name} gone: ${details.reason} (${details.exitCode})`);
  });
  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    log.error("preload", `${name} ${preloadPath}`, error);
  });
  window.webContents.on("console-message", (details) => {
    const level = details.level ?? details.levelName;
    if (level === "error" || level === 3) {
      log.error("console", `${name}: ${details.message ?? ""}`);
    }
  });
}

function readTail(bytes = 64 * 1024) {
  try {
    if (!logFile || !fs.existsSync(logFile)) return "";
    const size = fs.statSync(logFile).size;
    const start = Math.max(0, size - bytes);
    const handle = fs.openSync(logFile, "r");
    const buffer = Buffer.alloc(size - start);
    fs.readSync(handle, buffer, 0, buffer.length, start);
    fs.closeSync(handle);
    return buffer.toString("utf8");
  } catch {
    return "";
  }
}

module.exports = {
  init,
  attachWindow,
  log,
  readTail,
  logFolder: () => logDir,
};
