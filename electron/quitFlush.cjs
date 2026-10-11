const { log } = require("./logger.cjs");
/** Channels of the quit handshake: main asks the window to save, the window says it has. */
const FLUSH_CHANNEL = "app:flush-saves";
const FLUSHED_CHANNEL = "app:saves-flushed";

/** A quit that hangs on a stuck window is worse than losing its last unsaved change. */
const FLUSH_TIMEOUT_MS = 3000;

/** Asks the window to write what it has not saved yet and waits for its answer, or for the timeout.
 * Resolves true only when the window answered. */
function flushWindow(win, ipc, timeoutMs = FLUSH_TIMEOUT_MS) {
  const contents = win && !win.isDestroyed() ? win.webContents : null;
  if (!contents || contents.isDestroyed() || contents.isCrashed()) return Promise.resolve(false);

  return new Promise((resolve) => {
    let timer = null;

    const finish = (answered) => {
      clearTimeout(timer);
      ipc.removeListener(FLUSHED_CHANNEL, onFlushed);
      contents.removeListener("destroyed", onGone);
      resolve(answered);
    };
    const onFlushed = (event) => {
      if (event.sender === contents) finish(true);
    };
    const onGone = () => finish(false);

    timer = setTimeout(() => finish(false), timeoutMs);
    ipc.on(FLUSHED_CHANNEL, onFlushed);
    contents.on("destroyed", onGone);

    try {
      contents.send(FLUSH_CHANNEL);
    } catch {
      finish(false);
    }
  });
}

/** Last step of a quit: writes session-end, then closes the log streams so nothing is lost. Never throws. */
async function closeLogs(logger) {
  try {
    logger.endSession(true);
    await logger.closeStreams();
  } catch (error) {
    log.swallow("files", error, "the app is quitting; a logger failure has nowhere to go");
  }
}

module.exports = { FLUSH_CHANNEL, FLUSHED_CHANNEL, FLUSH_TIMEOUT_MS, flushWindow, closeLogs };
