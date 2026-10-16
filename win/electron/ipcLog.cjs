/** The one place that registers IPC handlers. Every call logs its channel, duration and outcome,
 * and a slow one logs a WARN. Argument values never reach the log, only their count and size. */

const logger = require("./logger.cjs");

const { log } = logger;

const { DEFAULT_IPC_SLOW_MS: DEFAULT_SLOW_MS, IPC_SLOW_MS: SLOW_MS } = require("./logThresholds.cjs");

/** The log's own channels and the per-frame ones would log about themselves or flood the file. */
const SILENT = new Set(["logs:write", "logs:batch", "logs:tail", "logs:open", "browser-pane:bounds", "browser-pane:visible"]);

function slowLimit(channel) {
  return SLOW_MS[channel] ?? DEFAULT_SLOW_MS;
}

/** Bytes an argument list would take on the wire, without ever keeping the values. */
function argBytes(args) {
  let total = 0;
  for (const arg of args) {
    if (arg === undefined || arg === null) continue;
    if (typeof arg === "string") total += Buffer.byteLength(arg);
    else if (ArrayBuffer.isView(arg)) total += arg.byteLength;
    else {
      try {
        total += Buffer.byteLength(JSON.stringify(arg) ?? "");
      } catch {
        // circular or unserialisable: the size is unknown, not worth a line
      }
    }
  }
  return total;
}

function correlationId(args) {
  const first = args[0];
  if (!first || typeof first !== "object") return undefined;
  // An image job's request id is its correlation id: the same string tags the engine's lines.
  const id = first.cid ?? first.correlationId ?? first.requestId;
  return typeof id === "string" ? id.slice(0, 64) : undefined;
}

function scopeFor(channel) {
  const name = channel.split(/[:\-.]/)[0].replace(/[^a-z0-9]/gi, "");
  return `ipc.${name || "misc"}`;
}

function finish(channel, started, args, outcome) {
  const durMs = Math.round(performance.now() - started);
  logger.noteSlow(channel, durMs);
  const data = { channel, durMs, argc: args.length, bytes: argBytes(args), cid: correlationId(args) };
  if (outcome.error) {
    log.fail(scopeFor(channel), `${channel} failed`, outcome.error, data);
    return;
  }
  const limit = slowLimit(channel);
  if (durMs > limit) log.warn(scopeFor(channel), `${channel} slow`, { ...data, limitMs: limit });
  else log.debug(scopeFor(channel), channel, data);
}

function wrapHandler(channel, fn) {
  if (SILENT.has(channel)) return fn;
  return (event, ...args) => {
    const started = performance.now();
    let result;
    try {
      result = fn(event, ...args);
    } catch (error) {
      finish(channel, started, args, { error });
      throw error;
    }
    if (result && typeof result.then === "function") {
      return result.then(
        (value) => {
          finish(channel, started, args, {});
          return value;
        },
        (error) => {
          finish(channel, started, args, { error });
          throw error;
        },
      );
    }
    finish(channel, started, args, {});
    return result;
  };
}

/** Wraps an `ipcMain` (or anything with the same methods). The wrapper is what the rest of the main
 * process calls; `electron/ipcLog.test.js` fails when a file registers on `ipcMain` directly. */
function createIpc(ipcMain) {
  const wrapped = new WeakMap();
  return {
    handle(channel, fn) {
      return ipcMain.handle(channel, wrapHandler(channel, fn));
    },
    on(channel, fn) {
      const listener = wrapHandler(channel, fn);
      wrapped.set(fn, listener);
      return ipcMain.on(channel, listener);
    },
    // The caller holds the original function, so map it back to the one that was registered.
    removeListener(channel, fn) {
      return ipcMain.removeListener(channel, wrapped.get(fn) ?? fn);
    },
    removeHandler(channel) {
      return ipcMain.removeHandler?.(channel);
    },
  };
}

/** webContents.send to a window that is gone throws or vanishes; this records it at DEBUG and moves on. */
function sendTo(win, channel, ...args) {
  try {
    const contents = win?.webContents;
    if (!contents || win.isDestroyed?.() || contents.isDestroyed?.()) {
      log.debug("ipc.send", `${channel} dropped, window gone`, { channel });
      return false;
    }
    contents.send(channel, ...args);
    return true;
  } catch (error) {
    log.debug("ipc.send", `${channel} failed`, { channel, error: error?.message });
    return false;
  }
}

module.exports = { sendTo, createIpc, wrapHandler, slowLimit, argBytes, scopeFor, DEFAULT_SLOW_MS };
