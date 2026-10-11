const https = require("https");
const { log } = require("./logger.cjs");

/** Asks the host the first model comes from, since "can the model be downloaded" is the only
 * question the check answers. It used to ask google.com, which Draggy needs nothing from. */
const PROBE_URL = "https://huggingface.co/api/models?limit=1";
const TIMEOUT_MS = 3000;

let lastOnline = null;

function checkConnectivity({ request = https.request, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (online) => {
      if (settled) return;
      settled = true;
      if (online !== lastOnline) {
        if (lastOnline !== null) log.info("net", online ? "back online" : "went offline");
        else if (!online) log.warn("net", "offline at first check");
        lastOnline = online;
      }
      resolve(online);
    };

    let req;
    try {
      req = request(PROBE_URL, { method: "HEAD" }, (res) => {
        finish(res.statusCode >= 200 && res.statusCode < 400);
        res.resume?.();
      });
    } catch {
      finish(false);
      return;
    }
    req.on("error", () => finish(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      finish(false);
    });
    req.end();
  });
}

module.exports = { PROBE_URL, checkConnectivity };
