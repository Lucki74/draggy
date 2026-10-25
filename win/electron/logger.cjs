const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { scrubSecrets, isSecretKey, registerSecret } = require("./logScrub.cjs");

/** Maximum size before rotating logs and number of rotated archives to retain. */
const MAX_BYTES = 5 * 1024 * 1024;
const KEEP_ROTATIONS = 3;

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

function parseLevel(value, fallback) {
  const upper = String(value || "").toUpperCase();
  return upper in LEVELS ? upper : fallback;
}

let logDir = null;
let maxBytes = MAX_BYTES;
let mirrorToTerminal = false;
let sessionId = null;
let sessionStartedAt = 0;
let reportedFailure = false;
let seq = 0;

/** Levels as numbers, plus the scopes raised to DEBUG. Read from the environment at init and
 * changed at runtime by `setLevel`. */
let levels = null;
let scopeRaise = [];
let levelUntil = 0;
let levelTimer = null;
let keepVerbose = false;

/** One output file: its stream, how many bytes it holds, and lines held back while it rotates. */
function makeTarget() {
  return { file: null, stream: null, bytes: 0, rotating: null, pending: [] };
}

const debugTarget = makeTarget();
const appTarget = makeTarget();
const eventsTarget = makeTarget();
const allTargets = [debugTarget, appTarget, eventsTarget];

/** A logger failure is reported once and then ignored: logging must never break the app. */
function reportFailure(error) {
  if (reportedFailure) return;
  reportedFailure = true;
  try {
    process.stderr.write(`logger failure: ${error?.message || error}\n`);
  } catch {
    /* silent-ok: stderr may be closed */
  }
}

function parseScopes(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveLevels() {
  const globalLevel = process.env.LOG_LEVEL;
  const debugLevelName = parseLevel(process.env.DEBUG_LOG_LEVEL || globalLevel, "DEBUG");
  const appLevelName = parseLevel(process.env.APP_LOG_LEVEL || globalLevel, "INFO");
  return {
    debugLevel: LEVELS[debugLevelName],
    appLevel: LEVELS[appLevelName],
  };
}

/** Levels are read from the environment at init, not on every line. */
function currentLevels() {
  if (!levels) levels = resolveLevels();
  return levels;
}

/** `ipc` raises `ipc`, `ipc.files` and `ipc:files`; `*` raises everything. */
function scopeRaised(scope) {
  for (const prefix of scopeRaise) {
    if (prefix === "*" || prefix === "all") return true;
    if (scope === prefix) return true;
    if (scope.startsWith(prefix) && /[.:]/.test(scope[prefix.length])) return true;
  }
  return false;
}

let stampMs = 0;
let stampText = "";
/** `toISOString` is the dearest step of a log call, and a burst of lines shares a millisecond. */
function stamp() {
  const now = Date.now();
  if (now !== stampMs) {
    stampMs = now;
    stampText = new Date(now).toISOString();
  }
  return stampText;
}

function sha8(str) {
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 8);
}

function sanitizeString(str, max = 50) {
  if (typeof str !== "string" || str.length <= max) return str;
  return `${str.slice(0, max)}... [${str.length} chars, sha256:${sha8(str)}]`;
}

/** No plaintext at all: the hash still lets two log lines be matched to the same value. */
function redactString(str) {
  return `[${str.length} chars, sha256:${sha8(str)}]`;
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

/** Every string under a sensitive key, at any depth, is hashed for every file. Secret-named keys are dropped
 * without a hash, and every other string goes through the secret scrubber before it is cut.
 * `truncate` also shortens the long strings, which only app.log wants. */
function sanitizeValue(value, truncate, depth = 0, sensitive = false) {
  if (depth > 6) return "[Depth]";
  if (typeof value === "string") {
    if (sensitive) return redactString(value);
    const clean = scrubSecrets(value);
    return truncate ? sanitizeString(clean) : clean;
  }
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Error) {
    if (sensitive) return { name: value.name, message: redactString(value.message) };
    const message = scrubSecrets(value.message);
    return { name: value.name, message: truncate ? sanitizeString(message) : message, stack: scrubSecrets(value.stack) };
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, truncate, depth + 1, sensitive));
  }
  const sanitized = {};
  for (const [key, val] of Object.entries(value)) {
    if (isSecretKey(key)) sanitized[key] = `[secret:${key}]`;
    else sanitized[key] = sanitizeValue(val, truncate, depth + 1, sensitive || SENSITIVE_KEYS.has(key));
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

const CAUSE_DEPTH = 3;

/** The parts of an error that explain it. Node errors are useless without `code`; HTTP errors without `status`. */
function describeError(error, depth = 0) {
  if (error === null || error === undefined) return null;
  if (typeof error !== "object") return { name: "NonError", message: scrubSecrets(String(error)) };
  const info = {
    name: typeof error.name === "string" ? error.name : "Error",
    message: scrubSecrets(typeof error.message === "string" ? error.message : String(error.message ?? "")),
  };
  if (typeof error.stack === "string") info.stack = scrubSecrets(error.stack);
  for (const field of ["code", "errno", "syscall"]) {
    if (error[field] !== undefined && error[field] !== null) info[field] = error[field];
  }
  const status = error.status ?? error.statusCode ?? error.response?.status;
  if (typeof status === "number") info.status = status;
  if (error.cause && depth < CAUSE_DEPTH - 1) info.cause = describeError(error.cause, depth + 1);
  return info;
}

/** app.log keeps the error name, a cut message and the stack frames, not the message echoed in the stack header:
 * provider and engine errors often repeat the request body. */
function appError(info) {
  const frames = String(info.stack || "")
    .split("\n")
    .filter((line) => /^\s+at /.test(line));
  const message = sanitizeString(info.message, 200);
  const copy = { ...info, message, stack: `${info.name}: ${message}\n${frames.join("\n")}` };
  if (info.cause) copy.cause = appError(info.cause);
  return copy;
}

function renderError(info) {
  let text = info.stack || `${info.name}: ${info.message}`;
  const extras = ["code", "errno", "syscall", "status"].filter((key) => info[key] !== undefined).map((key) => `${key}=${info[key]}`);
  if (extras.length) text += `\n  [${extras.join(" ")}]`;
  if (info.cause) text += `\n  caused by: ${renderError(info.cause).replace(/\n/g, "\n  ")}`;
  return text;
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

function rotateFiles(filePath) {
  for (let index = KEEP_ROTATIONS; index >= 1; index--) {
    const older = `${filePath}.${index}`;
    const newer = index === 1 ? filePath : `${filePath}.${index - 1}`;
    if (fs.existsSync(older) && index === KEEP_ROTATIONS) fs.unlinkSync(older);
    if (fs.existsSync(newer)) fs.renameSync(newer, `${filePath}.${index}`);
  }
}

/** Opens the stream and seeds the byte counter from what the file already holds. */
function openTarget(target) {
  try {
    fs.mkdirSync(path.dirname(target.file), { recursive: true });
    let size = fs.existsSync(target.file) ? fs.statSync(target.file).size : 0;
    if (size >= maxBytes) {
      rotateFiles(target.file);
      size = 0;
    }
    target.bytes = size;
    target.stream = fs.createWriteStream(target.file, { flags: "a" });
    target.stream.on("error", reportFailure);
  } catch (error) {
    reportFailure(error);
    target.stream = null;
  }
}

/** The stream is closed before the files move: renaming under an open handle makes the session
 * keep appending to the archive. Lines that arrive meanwhile wait in `pending`. */
function startRotation(target) {
  const old = target.stream;
  target.stream = null;
  target.rotating = new Promise((resolve) => {
    const done = () => {
      try {
        rotateFiles(target.file);
      } catch (error) {
        reportFailure(error);
      }
      target.bytes = 0;
      target.rotating = null;
      const held = target.pending;
      target.pending = [];
      for (const line of held) writeTo(target, line);
      resolve();
    };
    if (!old) done();
    else old.end(done);
  });
}

function writeTo(target, line) {
  if (!target.file) return;
  try {
    if (target.rotating) {
      target.pending.push(line);
      return;
    }
    if (!target.stream) openTarget(target);
    if (!target.stream) return;
    const size = Buffer.byteLength(line);
    if (target.bytes > 0 && target.bytes + size > maxBytes) {
      target.pending.push(line);
      startRotation(target);
      return;
    }
    target.stream.write(line);
    target.bytes += size;
  } catch (error) {
    reportFailure(error);
  }
}

function formatLine(level, tag, correlationId, context, message, payload, errorText) {
  const idTag = correlationId ? `[${correlationId}]` : "[system]";
  let line = `${stamp()} ${level} ${tag} ${idTag} [${context || "app"}] ${message}`;
  if (payload !== undefined && payload !== null) {
    const serializedPayload = serialise(payload);
    if (serializedPayload) line += ` ${serializedPayload}`;
  }
  if (errorText) line += `\n${errorText}`;
  return `${line}\n`;
}

/** `renderer.*` is the renderer, `engine.*` a model engine, `mcp.<name>` an MCP server, anything else main. */
function procOf(scope) {
  if (scope.startsWith("renderer")) return "renderer";
  if (scope.startsWith("engine")) return "engine";
  if (scope.startsWith("mcp.")) return `mcp:${scope.slice(4).split(/[.:]/)[0]}`;
  return "main";
}

/** The one write path. Builds the sanitized pieces once per target and fans them out:
 * debug.log (text, full), events.jsonl (structured, full), app.log (text, cut). */
const RECENT_MAX = 100;
const recent = [];

function remember(level, scope, msg, cid) {
  recent.push(`${stamp().slice(11, 23)} ${level} ${scope}${cid ? ` [${cid}]` : ""} ${msg.length > 120 ? `${msg.slice(0, 120)}...` : msg}`);
  if (recent.length > RECENT_MAX) recent.shift();
}

/** The lead-up to a failure in one place: the last lines this process wrote, newest last. */
function dumpRecent(reason) {
  emit("WARN", "logger", "recent events before failure", { reason, count: recent.length, recent: recent.slice() });
}

function emit(level, scope, message, payload, error, extra = {}) {
  try {
    const { debugLevel, appLevel } = currentLevels();
    const numeric = LEVELS[level] ?? LEVELS.INFO;
    const context = scope || "app";
    const toDebug = numeric >= debugLevel && Boolean(debugTarget.file);
    const toEvents = numeric >= debugLevel && Boolean(eventsTarget.file);
    const toApp = Boolean(appTarget.file) && (numeric >= appLevel || (numeric === LEVELS.DEBUG && scopeRaised(context)));

    if (toDebug || toEvents || toApp) {
      const mySeq = ++seq;
      if (level === "ERROR") stats.errors[context] = (stats.errors[context] || 0) + 1;
      const tag = `${sessionId || "-"}.${mySeq}`;
      const msg = typeof message === "string" ? scrubSecrets(message) : serialise(sanitizeValue(message, false));
      const errInfo = error ? describeError(error) : null;
      const cid = extra.correlationId ?? payload?.cid ?? payload?.correlationId ?? null;
      if (scope !== "logger") remember(level, context, msg, cid);
      const rawDur = extra.durMs ?? payload?.durMs ?? payload?.durationMs;
      const durMs = typeof rawDur === "number" && Number.isFinite(rawDur) ? Math.round(rawDur * 10) / 10 : undefined;

      if (toDebug || toEvents) {
        const fullData = payload !== undefined ? sanitizeValue(payload, false) : undefined;
        if (toDebug) {
          writeTo(debugTarget, formatLine(level, tag, cid, context, msg, fullData, errInfo && renderError(errInfo)));
        }
        if (toEvents) {
          const record = {
            ts: stamp(),
            seq: mySeq,
            level,
            session: sessionId,
            proc: procOf(context),
            pid: process.pid,
            scope: context,
            msg,
            cid: cid || undefined,
            durMs,
            data: fullData,
            err: errInfo || undefined,
          };
          let json;
          try {
            json = JSON.stringify(record);
          } catch {
            json = JSON.stringify({ ...record, data: "[unserialisable]" });
          }
          writeTo(eventsTarget, `${json}\n`);
        }
      }

      if (toApp) {
        const cutData = payload !== undefined ? sanitizeValue(payload, true) : undefined;
        const cutMsg = typeof message === "string" ? msg : sanitizeValue(message, true);
        writeTo(appTarget, formatLine(level, tag, cid, context, cutMsg, cutData, errInfo && renderError(appError(errInfo))));
      }
    }

    if (level === "ERROR") {
      console.error(scrubSecrets(`${stamp()} ${level} [${context}] ${message}`));
      if (error) console.error(scrubSecrets(serialise(error)));
    } else if (mirrorToTerminal && (level === "WARN" || level === "INFO")) {
      console.log(scrubSecrets(`${stamp()} ${level} [${context}] ${message}`));
    }
  } catch (failure) {
    reportFailure(failure);
  }
}

function logEntry(entry) {
  if (!entry) return;
  const level = String(entry.level || "INFO").toUpperCase();
  const payload = entry.data !== undefined ? entry.data : entry.payload;
  emit(level, entry.context || "renderer", entry.message || "", payload, entry.error || null, {
    correlationId: entry.correlationId || null,
  });
}

function logEntries(entries) {
  if (!Array.isArray(entries)) return;
  for (const entry of entries) logEntry(entry);
}

const MAX_BATCH_ENTRIES = 200;
const MAX_ENTRIES_PER_SECOND = 1000;
const MAX_MESSAGE_CHARS = 2000;
const MAX_CONTEXT_CHARS = 80;
const MAX_ID_CHARS = 64;

let rateWindowStart = 0;
let rateWindowCount = 0;

function clampString(value, max) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** Turns whatever the renderer sent into a logger entry, or null. The renderer cannot pick a main-process
 * scope: every context lands under `renderer.`. */
function validateRendererEntry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const level = String(raw.level || "INFO").toUpperCase();
  const context = clampString(raw.context, MAX_CONTEXT_CHARS).replace(/^renderer\.?/, "") || "app";
  const entry = {
    level: level in LEVELS ? level : "INFO",
    context: `renderer.${context}`,
    message: clampString(typeof raw.message === "string" ? raw.message : String(raw.message ?? ""), MAX_MESSAGE_CHARS),
    correlationId: clampString(raw.correlationId, MAX_ID_CHARS) || null,
    data: raw.data !== undefined ? raw.data : raw.payload,
  };
  if (raw.error && typeof raw.error === "object") {
    const error = new Error(clampString(raw.error.message, MAX_MESSAGE_CHARS));
    error.name = clampString(raw.error.name, MAX_CONTEXT_CHARS) || "Error";
    error.stack = clampString(raw.error.stack, 8000) || `${error.name}: ${error.message}`;
    entry.error = error;
  } else if (typeof raw.error === "string") {
    entry.error = new Error(clampString(raw.error, MAX_MESSAGE_CHARS));
  }
  return entry;
}

/** Entry point for `logs:write` and `logs:batch`: shape-checked, capped per batch and per second. */
function ingestRendererEntries(input) {
  try {
    const list = Array.isArray(input) ? input.slice(0, MAX_BATCH_ENTRIES) : [input];
    const now = Date.now();
    if (now - rateWindowStart >= 1000) {
      rateWindowStart = now;
      rateWindowCount = 0;
    }
    let dropped = 0;
    for (const raw of list) {
      if (rateWindowCount >= MAX_ENTRIES_PER_SECOND) {
        dropped++;
        continue;
      }
      const entry = validateRendererEntry(raw);
      if (!entry) {
        dropped++;
        continue;
      }
      rateWindowCount++;
      if (entry.message === "turn summary") stats.turns++;
      logEntry(entry);
    }
    const overflow = Array.isArray(input) ? Math.max(0, input.length - MAX_BATCH_ENTRIES) : 0;
    if (dropped + overflow > 0) emit("WARN", "logger", "renderer entries dropped", { count: dropped + overflow });
  } catch (error) {
    reportFailure(error);
  }
}

/** A plain object among the arguments is data, so it gets the sanitizer instead of being flattened into the message. */
function isPlainData(part) {
  return part !== null && typeof part === "object" && !(part instanceof Error) && !Array.isArray(part);
}

function logWith(level, scope, ...parts) {
  const context = scope || callerContext();
  let error = null;
  let data;
  const remaining = [];
  for (const part of parts) {
    if (part instanceof Error && !error) error = part;
    else if (isPlainData(part)) data = data ? { ...data, ...part } : part;
    else remaining.push(part);
  }
  emit(level, context, remaining.map(serialise).join(" "), data, error);
}

/** `log.fail("providers.openai", "request failed", err, { status })`: the error's code, errno, syscall, status and cause chain are kept. */
function fail(scope, message, error, data) {
  emit("ERROR", scope, message, data, error ?? null);
}

/** `const t = log.time("engine.llama", "load", { model }, { warnMs: 30000 })`, then `t.end({ ... })` or `t.fail(err)`. */
function time(scope, label, data, options = {}) {
  const startedAt = performance.now();
  let finished = false;
  return {
    elapsed: () => performance.now() - startedAt,
    end(extra) {
      if (finished) return;
      finished = true;
      const durMs = performance.now() - startedAt;
      const slow = typeof options.warnMs === "number" && durMs > options.warnMs;
      emit(slow ? "WARN" : options.level || "INFO", scope, slow ? `${label} slow` : label, { ...data, ...extra, durMs });
    },
    fail(error, extra) {
      if (finished) return;
      finished = true;
      emit("ERROR", scope, `${label} failed`, { ...data, ...extra, durMs: performance.now() - startedAt }, error ?? null);
    },
  };
}

const MAX_ONCE_KEYS = 2000;
const onceKeys = new Set();

/** Logs a warning the first time `key` is seen and never again this session. */
function once(key, scope, message, data, level = "WARN") {
  if (onceKeys.has(key)) return false;
  if (onceKeys.size >= MAX_ONCE_KEYS) onceKeys.clear();
  onceKeys.add(key);
  emit(level, scope, message, data);
  return true;
}

const repeats = new Map();

/** For hot paths. The first call logs; repeats inside the window are counted and summed up in one line when it closes. */
function limited(key, level, scope, message, data, windowMs = 10000) {
  const open = repeats.get(key);
  if (open) {
    open.count++;
    return false;
  }
  emit(level, scope, message, data);
  const entry = { count: 0 };
  entry.timer = setTimeout(() => {
    repeats.delete(key);
    if (entry.count > 0) {
      emit(level, scope, `${message} repeated ${entry.count} times in ${Math.round(windowMs / 1000)} s`, data);
    }
  }, windowMs);
  entry.timer.unref?.();
  repeats.set(key, entry);
  return true;
}

/** An error that is dropped on purpose. DEBUG, so it costs nothing until someone raises the scope. */
function swallow(scope, error, why) {
  emit("DEBUG", scope, `swallowed: ${why}`, {
    error: error?.message ?? (error === undefined ? undefined : String(error)),
    code: error?.code,
  });
}

/** For `.catch(...)`: logs the dropped error and resolves to `fallback`. */
function swallowed(scope, why, fallback) {
  return (error) => {
    swallow(scope, error, why);
    return fallback;
  };
}

const log = {
  debug: (scope, ...parts) => logWith("DEBUG", scope, ...parts),
  info: (scope, ...parts) => logWith("INFO", scope, ...parts),
  warn: (scope, ...parts) => logWith("WARN", scope, ...parts),
  error: (scope, ...parts) => logWith("ERROR", scope, ...parts),
  fail,
  time,
  once,
  limited,
  swallow,
  swallowed,
};

const SESSION_MARKER = "session.json";
const LEVEL_FILE = "level.json";

function readJson(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(logDir, name), "utf8"));
  } catch {
    return null;
  }
}

function writeJson(name, value) {
  try {
    fs.writeFileSync(path.join(logDir, name), JSON.stringify(value));
  } catch (error) {
    reportFailure(error);
  }
}

function removeFile(name) {
  try {
    fs.rmSync(path.join(logDir, name), { force: true });
  } catch (error) {
    reportFailure(error);
  }
}

function levelName(numeric) {
  return Object.keys(LEVELS).find((name) => LEVELS[name] === numeric) || "INFO";
}

function getLevelState() {
  return {
    level: levelName(currentLevels().appLevel),
    scopes: [...scopeRaise],
    keep: keepVerbose,
    until: levelUntil || null,
  };
}

/** Changes what app.log records, with no restart. `durationMs` makes it turn itself off; `keep` makes it survive the next boot. */
function setLevel(options = {}) {
  const current = currentLevels();
  const baseline = resolveLevels();
  if (options.level !== undefined) {
    const name = parseLevel(options.level, null);
    current.appLevel = name ? LEVELS[name] : baseline.appLevel;
  }
  if (options.scopes !== undefined) scopeRaise = parseScopes(options.scopes).slice(0, 50).map((scope) => scope.slice(0, MAX_CONTEXT_CHARS));
  keepVerbose = options.keep === true;
  clearTimeout(levelTimer);
  levelTimer = null;
  levelUntil = 0;
  const verbose = current.appLevel === LEVELS.DEBUG || scopeRaise.length > 0;
  if (verbose && Number(options.durationMs) > 0) {
    const ms = Math.min(Number(options.durationMs), 24 * 3600 * 1000);
    levelUntil = Date.now() + ms;
    levelTimer = setTimeout(() => {
      setLevel({ level: "INFO", scopes: [], keep: false });
      emit("INFO", "logger", "verbose logging ended");
    }, ms);
    levelTimer.unref?.();
  }
  if (logDir) {
    if (keepVerbose && verbose) {
      writeJson(LEVEL_FILE, { level: levelName(current.appLevel), scopes: scopeRaise, keep: true });
    } else {
      removeFile(LEVEL_FILE);
    }
  }
  emit("INFO", "logger", "level changed", getLevelState());
  return getLevelState();
}

let handlersInstalled = false;

/** In development, `DRAGGY_DEBUG=scope,scope` in `.env.local` stands in for the environment variable. */
function devDebugSetting(app) {
  if (process.env.DRAGGY_DEBUG || app.isPackaged !== false) return process.env.DRAGGY_DEBUG;
  try {
    const root = typeof app.getAppPath === "function" ? app.getAppPath() : process.cwd();
    const match = /^s*DRAGGY_DEBUGs*=s*(.*?)s*$/m.exec(fs.readFileSync(path.join(root, ".env.local"), "utf8"));
    return match ? match[1].replace(/^["']|["']$/g, "") : undefined;
  } catch {
    return undefined; // no .env.local is the normal case
  }
}

function init(app) {
  logDir = path.join(app.getPath("userData"), "logs");
  debugTarget.file = path.join(logDir, "debug.log");
  appTarget.file = path.join(logDir, "app.log");
  eventsTarget.file = path.join(logDir, "events.jsonl");
  for (const target of allTargets) target.stream = null;
  levels = resolveLevels();
  scopeRaise = parseScopes(devDebugSetting(app));
  keepVerbose = false;
  clearTimeout(levelTimer);
  levelTimer = null;
  levelUntil = 0;
  mirrorToTerminal = app.isPackaged === false;
  sessionId = crypto.randomBytes(4).toString("hex");
  sessionStartedAt = Date.now();
  seq = 0;

  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch (error) {
    reportFailure(error);
  }
  const previous = readJson(SESSION_MARKER);
  writeJson(SESSION_MARKER, { id: sessionId, startedAt: new Date(sessionStartedAt).toISOString(), pid: process.pid, clean: false });

  // Verbose logging lasts one run unless the user asked to keep it.
  const saved = readJson(LEVEL_FILE);
  if (saved && saved.keep === true) {
    const name = parseLevel(saved.level, null);
    if (name) levels.appLevel = LEVELS[name];
    scopeRaise = [...new Set([...scopeRaise, ...parseScopes(saved.scopes)])];
    keepVerbose = true;
  } else if (saved) {
    removeFile(LEVEL_FILE);
  }

  log.info(
    "boot",
    `${app.getName()} ${app.getVersion()} | electron ${process.versions.electron} | node ${process.versions.node} | ${process.platform} ${os.arch()} ${os.release()} | session ${sessionId}`,
    { pid: process.pid, packaged: app.isPackaged === true },
  );
  if (previous && previous.clean !== true) {
    log.warn("boot", `previous session ${previous.id} ended without session-end (crash or kill), started ${previous.startedAt}`, {
      previousSession: previous.id,
    });
  }

  if (!handlersInstalled) {
    handlersInstalled = true;
    process.on("uncaughtException", (error) => {
      log.error("uncaughtException", error);
      dumpRecent("uncaughtException");
    });

    process.on("unhandledRejection", (reason) => {
      log.error("unhandledRejection", reason);
      dumpRecent("unhandledRejection");
    });
  }

  return {
    logDir,
    debugFile: debugTarget.file,
    appFile: appTarget.file,
    eventsFile: eventsTarget.file,
    sessionId,
    previousCrashed: Boolean(previous && previous.clean !== true),
    previousSession: previous?.id ?? null,
    previousStartedAt: previous?.startedAt ?? null,
  };
}

/** Counters for the closing summary: what went wrong and what was slow, without keeping any content. */
const stats = { turns: 0, errors: {}, slow: new Map(), peakMB: 0, engineCrashes: 0 };

function noteSlow(name, durMs) {
  if (typeof durMs !== "number" || !Number.isFinite(durMs)) return;
  const known = stats.slow.get(name);
  if (!known || durMs > known) stats.slow.set(name, durMs);
  if (stats.slow.size > 200) stats.slow.delete([...stats.slow.entries()].sort((a, b) => a[1] - b[1])[0][0]);
}

function noteStat(kind, value = 1) {
  if (kind === "turn") stats.turns += value;
  else if (kind === "engineCrash") stats.engineCrashes += value;
  else if (kind === "peakMB" && value > stats.peakMB) stats.peakMB = value;
}

function sessionSummary() {
  return {
    turns: stats.turns,
    errorsByScope: stats.errors,
    slowestIpc: [...stats.slow.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([channel, ms]) => ({ channel, ms })),
    peakMemoryMB: stats.peakMB,
    engineCrashes: stats.engineCrashes,
  };
}

/** Writes the closing line and marks the run clean, so the next boot knows it did not crash. */
function endSession(clean = true) {
  if (!logDir) return;
  log.info("lifecycle", "session summary", sessionSummary());
  log.info("session-end", `uptime ${Math.round((Date.now() - sessionStartedAt) / 1000)} s`, clean ? "clean" : "dirty");
  writeJson(SESSION_MARKER, { id: sessionId, startedAt: new Date(sessionStartedAt).toISOString(), pid: process.pid, clean });
}

function attachWindow(window, name) {
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

const MAX_TAIL_BYTES = 2 * 1024 * 1024;

function readTail(target = "app", bytes = 64 * 1024) {
  try {
    const wanted = Number.isFinite(Number(bytes)) ? Math.min(Math.max(0, Math.floor(Number(bytes))), MAX_TAIL_BYTES) : 64 * 1024;
    const chosen = target === "debug" ? debugTarget : target === "events" ? eventsTarget : appTarget;
    const chosenFile = chosen.file || debugTarget.file;
    if (!chosenFile || !fs.existsSync(chosenFile)) return "";
    const size = fs.statSync(chosenFile).size;
    const start = Math.max(0, size - wanted);
    const handle = fs.openSync(chosenFile, "r");
    try {
      const buffer = Buffer.alloc(size - start);
      fs.readSync(handle, buffer, 0, buffer.length, start);
      return buffer.toString("utf8");
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return "";
  }
}

async function settleRotations() {
  for (const target of allTargets) {
    while (target.rotating) await target.rotating;
  }
}

/** Resolves once every queued line, including ones held back by a rotation, is on disk. */
async function flush() {
  await settleRotations();
  await Promise.all(
    allTargets.map(
      (target) =>
        new Promise((resolve) => {
          if (target.stream && !target.stream.destroyed) target.stream.write("", () => resolve());
          else resolve();
        }),
    ),
  );
}

async function closeStreams() {
  await settleRotations();
  await Promise.all(
    allTargets.map(
      (target) =>
        new Promise((resolve) => {
          const stream = target.stream;
          target.stream = null;
          if (stream) stream.end(() => resolve());
          else resolve();
        }),
    ),
  );
}

/** Test hook: shrinks the rotation cap so rotation can run in milliseconds. */
function setMaxBytes(value) {
  maxBytes = value > 0 ? value : MAX_BYTES;
}

module.exports = {
  init,
  attachWindow,
  log,
  logEntry,
  logEntries,
  ingestRendererEntries,
  endSession,
  noteSlow,
  noteStat,
  sessionSummary,
  readTail,
  flush,
  closeStreams,
  setMaxBytes,
  setLevel,
  getLevelState,
  registerSecret,
  dumpRecent,
  logFolder: () => logDir,
  sessionId: () => sessionId,
};
