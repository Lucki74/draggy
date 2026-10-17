"use strict";

/**
 * What a page logged to its console and which requests it made, kept in memory only so the agent
 * can debug a web app. Nothing here reaches disk or the logs. Query strings are dropped from URLs
 * because they often carry tokens.
 */

const LEVELS = { log: "log", info: "info", debug: "debug", warning: "warn", error: "error", assert: "error" };

/** A request address without its query or fragment. */
function plainUrl(url) {
  const text = String(url || "");
  const cut = text.search(/[?#]/);
  return (cut === -1 ? text : text.slice(0, cut)).slice(0, 200);
}

function argText(arg) {
  if (!arg) return "";
  if (arg.value !== undefined) return typeof arg.value === "string" ? arg.value : JSON.stringify(arg.value);
  return String(arg.description || arg.type || "");
}

function createTrace({ max = 200 } = {}) {
  let consoleLines = [];
  let requests = new Map();

  const push = (list, item) => {
    list.push(item);
    if (list.length > max) list.splice(0, list.length - max);
  };

  return {
    handle(method, params = {}) {
      if (method === "Runtime.consoleAPICalled") {
        push(consoleLines, {
          level: LEVELS[params.type] || "log",
          text: (params.args || []).map(argText).join(" ").slice(0, 500),
        });
      } else if (method === "Runtime.exceptionThrown") {
        const details = params.exceptionDetails || {};
        push(consoleLines, {
          level: "error",
          text: String(details.exception?.description || details.text || "exception").slice(0, 500),
        });
      } else if (method === "Network.requestWillBeSent") {
        requests.set(params.requestId, { method: params.request?.method || "GET", url: plainUrl(params.request?.url), status: null });
        if (requests.size > max) requests.delete(requests.keys().next().value);
      } else if (method === "Network.responseReceived") {
        const entry = requests.get(params.requestId);
        if (entry) entry.status = params.response?.status ?? null;
      } else if (method === "Network.loadingFailed") {
        const entry = requests.get(params.requestId);
        if (entry) entry.failed = String(params.errorText || "failed").slice(0, 80);
      }
    },

    console: (limit = 50) => consoleLines.slice(-limit),

    network: (limit = 50, onlyFailed = false) => {
      const all = [...requests.values()];
      const shown = onlyFailed ? all.filter((r) => r.failed || (r.status !== null && r.status >= 400)) : all;
      return shown.slice(-limit);
    },

    clear() {
      consoleLines = [];
      requests = new Map();
    },
  };
}

module.exports = { createTrace, plainUrl };
