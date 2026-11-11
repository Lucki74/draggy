"use strict";

/**
 * JavaScript dialogs and download names for the agent's pane. A dialog freezes its page, so the
 * model has to hear about it and answer it; a page leaving with unsaved work is let go.
 * Dialog text is page content, so only its type and length reach the log.
 */

const { log } = require("./logger.cjs");

const SCOPE = "browser.dialogs";

/** Tracks the dialog open on one page, fed the debugger's `Page.*` events. */
function createDialogs({ send, onError }) {
  let pending = null;
  const waiters = new Set();

  return {
    handle(method, params = {}) {
      if (method === "Page.javascriptDialogOpening") {
        if (params.type === "beforeunload") {
          // A navigation the agent asked for must not stall on "leave this page?".
          log.debug(SCOPE, "beforeunload auto-accepted");
          send("Page.handleJavaScriptDialog", { accept: true }).catch((error) => {
            log.warn(SCOPE, "beforeunload accept failed", { code: error?.code });
            onError(error);
          });
          return;
        }
        pending = {
          type: String(params.type || "alert"),
          message: String(params.message || "").slice(0, 500),
          defaultPrompt: String(params.defaultPrompt || "").slice(0, 200),
        };
        log.info(SCOPE, "dialog opened", { type: pending.type, messageLen: pending.message.length });
        for (const wake of waiters) wake(pending);
        waiters.clear();
      } else if (method === "Page.javascriptDialogClosed") {
        log.debug(SCOPE, "dialog closed", { hadPending: pending !== null });
        pending = null;
      }
    },

    pending: () => pending,

    /** Resolves when a dialog opens, so a click that blocks on one can be given up on. */
    opened: () => new Promise((resolve) => waiters.add(resolve)),

    async answer({ accept, text }) {
      if (!pending) {
        log.warn(SCOPE, "answer refused", { reason: "no-dialog" });
        const error = new Error("No dialog is open.");
        error.code = "no_dialog";
        throw error;
      }
      // The page's close event can land before the answer returns, so keep what was open.
      const closing = pending;
      const params = { accept: Boolean(accept) };
      if (typeof text === "string") params.promptText = text;
      try {
        await send("Page.handleJavaScriptDialog", params);
      } catch (error) {
        log.fail(SCOPE, "answer failed", error, { type: closing.type, accept: Boolean(accept) });
        throw error;
      }
      pending = null;
      log.info(SCOPE, "dialog answered", { type: closing.type, accept: Boolean(accept), hasText: typeof text === "string" });
      return closing;
    },
  };
}

/** A download's name as a plain file name: no folders, no characters Windows refuses. */
function safeDownloadName(name) {
  const leaf = String(name || "").split(/[\\/]/).pop();
  const base = Array.from(leaf, (ch) => (ch.charCodeAt(0) < 32 || '<>:"|?*'.includes(ch) ? "_" : ch)).join("").trim();
  const safe = base && base !== "." && base !== ".." ? base.slice(0, 120) : "download";
  if (safe !== leaf) log.debug(SCOPE, "download name sanitised", { changed: true, len: safe.length });
  return safe;
}

module.exports = { createDialogs, safeDownloadName };
