const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

/** Maximum size before rotating logs and number of rotated archives to retain. */
const MAX_BYTES = 5 * 1024 * 1024;
const KEEP_ROTATIONS = 3;

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

function parseLevel(value, fallback) {
  const upper = String(value || "").toUpperCase();
  return upper in LEVELS ? upper : fallback;
}

let logDir = null;
let debugFile = null;
let appFile = null;
let debugStream = null;
let appStream = null;
let debugBytesWritten = 0;
let appBytesWritten = 0;

function resolveLevels() {
  const globalLevel = process.env.LOG_LEVEL;
  const debugLevelName = parseLevel(process.env.DEBUG_LOG_LEVEL || globalLevel, "DEBUG");
  const appLevelName = parseLevel(process.env.APP_LOG_LEVEL || globalLevel, "INFO");
  return {
    debugLevel: LEVELS[debugLevelName],
    appLevel: LEVELS[appLevelName],
  };
}

function stamp() {
  return new Date().toISOString();
}

function sanitizeString(str, max = 50) {
  if (typeof str !== "string" || str.length <= max) return str;
  const hash = crypto.createHash("sha256").update(str).digest("hex").slice(0, 8);
  return `${str.slice(0, max)}... [${str.length} chars, sha256:${hash}]`;
}

const SENSITIVE_KEYS = new Set([
  "prompt",
  "content",
  "text",
  "rawChunk",
  "streamBuffer",
  "response",
  "reply",
  "input",
  "userPrompt",
  "body",
]);

function sanitizeValue(value, depth = 0) {
  if (depth > 6) return "[Depth]";
  if (typeof value === "string") return sanitizeString(value);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Error) {
    return { name: value.name, message: sanitizeString(value.message), stack: value.stack };
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }
  const sanitized = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key) && typeof val === "string") {
      sanitized[key] = sanitizeString(val);
    } else {
      sanitized[key] = sanitizeValue(val, depth + 1);
    }
  }
  return sanitized;
}

function serialise(value) {
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack || ""}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Extracts caller location when an explicit file or context was not provided. */
function callerContext() {
  const stack = new Error().stack || "";
  const lines = stack.split("\n");
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("logger.cjs") || line.includes("node:") || line.includes("internal/")) continue;
    const match = line.match(/(?:at\s+(?:.*?\s+)?\(?)(.*?):(\d+):(\d+)\)?$/);
    if (match) {
      const fileName = path.basename(match[1]);
      return `${fileName}:${match[2]}`;
    }
  }
  return "system";
}

function rotateTarget(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    if (fs.statSync(filePath).size < MAX_BYTES) return;

    for (let index = KEEP_ROTATIONS; index >= 1; index--) {
      const older = `${filePath}.${index}`;
      const newer = index === 1 ? filePath : `${filePath}.${index - 1}`;
      if (fs.existsSync(older) && index === KEEP_ROTATIONS) fs.unlinkSync(older);
      if (fs.existsSync(newer)) fs.renameSync(newer, `${filePath}.${index}`);
    }
  } catch {
    /* failed rotation must never crash the application */
  }
}

function openTargetStream(filePath) {
  if (!filePath) return null;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  rotateTarget(filePath);
  const stream = fs.createWriteStream(filePath, { flags: "a" });
  stream.on("error", () => {});
  return stream;
}

function ensureStreams() {
  if (!debugStream && debugFile) debugStream = openTargetStream(debugFile);
  if (!appStream && appFile) appStream = openTargetStream(appFile);
}

function formatLine(level, correlationId, context, message, payload, error) {
  const idTag = correlationId ? `[${correlationId}]` : "[system]";
  const ctxTag = `[${context || "app"}]`;
  let line = `${stamp()} ${level} ${idTag} ${ctxTag} ${message}`;
  if (payload !== undefined && payload !== null) {
    const serializedPayload = serialise(payload);
    if (serializedPayload) line += ` ${serializedPayload}`;
  }
  if (error) {
    const errText = serialise(error);
    line += `\n${errText}`;
  }
  return `${line}\n`;
}

function writeRaw(level, correlationId, context, message, payload, error) {
  ensureStreams();
  const { debugLevel, appLevel } = resolveLevels();
  const numericLevel = LEVELS[level] ?? LEVELS.INFO;

  if (numericLevel >= debugLevel && debugStream) {
    const line = formatLine(level, correlationId, context, message, payload, error);
    debugStream.write(line);
    debugBytesWritten += Buffer.byteLength(line);
    if (debugBytesWritten > MAX_BYTES) {
      debugBytesWritten = 0;
      rotateTarget(debugFile);
    }
  }

  if (numericLevel >= appLevel && appStream) {
    const sanitizedPayload = payload !== undefined ? sanitizeValue(payload) : undefined;
    const sanitizedMsg = typeof message === "string" ? message : sanitizeValue(message);
    const line = formatLine(level, correlationId, context, sanitizedMsg, sanitizedPayload, error);
    appStream.write(line);
    appBytesWritten += Buffer.byteLength(line);
    if (appBytesWritten > MAX_BYTES) {
      appBytesWritten = 0;
      rotateTarget(appFile);
    }
  }

  if (level === "ERROR") {
    const termLine = `${stamp()} ${level} [${context || "app"}] ${message}`;
    console.error(termLine);
    if (error) console.error(serialise(error));
  }
}

function logEntry(entry) {
  if (!entry) return;
  const level = String(entry.level || "INFO").toUpperCase();
  const correlationId = entry.correlationId || null;
  const context = entry.context || "renderer";
  const message = entry.message || "";
  const payload = entry.data !== undefined ? entry.data : entry.payload;
  const error = entry.error || null;
  writeRaw(level, correlationId, context, message, payload, error);
}

function logEntries(entries) {
  if (!Array.isArray(entries)) return;
  for (const entry of entries) logEntry(entry);
}

function logWith(level, scope, ...parts) {
  const context = scope || callerContext();
  let error = null;
  const remaining = [];
  for (const part of parts) {
    if (part instanceof Error && !error) error = part;
    else remaining.push(part);
  }
  const message = remaining.map(serialise).join(" ");
  writeRaw(level, null, context, message, undefined, error);
}

const log = {
  debug: (scope, ...parts) => logWith("DEBUG", scope, ...parts),
  info: (scope, ...parts) => logWith("INFO", scope, ...parts),
  warn: (scope, ...parts) => logWith("WARN", scope, ...parts),
  error: (scope, ...parts) => logWith("ERROR", scope, ...parts),
};

function init(app) {
  logDir = path.join(app.getPath("userData"), "logs");
  debugFile = path.join(logDir, "debug.log");
  appFile = path.join(logDir, "app.log");

  ensureStreams();

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

  return { logDir, debugFile, appFile };
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

function readTail(target = "app", bytes = 64 * 1024) {
  try {
    const chosenFile = target === "debug" ? debugFile : (appFile || debugFile);
    if (!chosenFile || !fs.existsSync(chosenFile)) return "";
    const size = fs.statSync(chosenFile).size;
    const start = Math.max(0, size - bytes);
    const handle = fs.openSync(chosenFile, "r");
    const buffer = Buffer.alloc(size - start);
    fs.readSync(handle, buffer, 0, buffer.length, start);
    fs.closeSync(handle);
    return buffer.toString("utf8");
  } catch {
    return "";
  }
}

function flush() {
  return new Promise((resolve) => {
    let pending = 0;
    const check = () => {
      pending--;
      if (pending <= 0) resolve();
    };
    if (debugStream && !debugStream.destroyed) {
      pending++;
      debugStream.write("", check);
    }
    if (appStream && !appStream.destroyed) {
      pending++;
      appStream.write("", check);
    }
    if (pending === 0) resolve();
  });
}

function closeStreams() {
  return new Promise((resolve) => {
    let pending = 0;
    const check = () => {
      pending--;
      if (pending <= 0) resolve();
    };
    if (debugStream) {
      pending++;
      const s = debugStream;
      debugStream = null;
      s.end(check);
    }
    if (appStream) {
      pending++;
      const s = appStream;
      appStream = null;
      s.end(check);
    }
    if (pending === 0) resolve();
  });
}

module.exports = {
  init,
  attachWindow,
  log,
  logEntry,
  logEntries,
  readTail,
  flush,
  closeStreams,
  logFolder: () => logDir,
};
