"use strict";

/**
 * JavaScript dialogs and download names for the agent's pane. A dialog freezes its page, so the
 * model has to hear about it and answer it; a page leaving with unsaved work is let go.
 */

/** Tracks the dialog open on one page, fed the debugger's `Page.*` events. */
function createDialogs({ send, onError }) {
  let pending = null;
  const waiters = new Set();

  return {
    handle(method, params = {}) {
      if (method === "Page.javascriptDialogOpening") {
        if (params.type === "beforeunload") {
          // A navigation the agent asked for must not stall on "leave this page?".
          send("Page.handleJavaScriptDialog", { accept: true }).catch(onError);
          return;
        }
        pending = {
          type: String(params.type || "alert"),
          message: String(params.message || "").slice(0, 500),
          defaultPrompt: String(params.defaultPrompt || "").slice(0, 200),
        };
        for (const wake of waiters) wake(pending);
        waiters.clear();
      } else if (method === "Page.javascriptDialogClosed") {
        pending = null;
      }
    },

    pending: () => pending,

    /** Resolves when a dialog opens, so a click that blocks on one can be given up on. */
    opened: () => new Promise((resolve) => waiters.add(resolve)),

    async answer({ accept, text }) {
      if (!pending) {
        const error = new Error("No dialog is open.");
        error.code = "no_dialog";
        throw error;
      }
      const params = { accept: Boolean(accept) };
      if (typeof text === "string") params.promptText = text;
      await send("Page.handleJavaScriptDialog", params);
      const closed = pending;
      pending = null;
      return closed;
    },
  };
}

/** A download's name as a plain file name: no folders, no characters Windows refuses. */
function safeDownloadName(name) {
  const leaf = String(name || "").split(/[\\/]/).pop();
  const base = Array.from(leaf, (ch) => (ch.charCodeAt(0) < 32 || '<>:"|?*'.includes(ch) ? "_" : ch)).join("").trim();
  return base && base !== "." && base !== ".." ? base.slice(0, 120) : "download";
}

module.exports = { createDialogs, safeDownloadName };
