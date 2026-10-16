/** Which cloud voice providers the user has agreed to send reply text to. Stored in the main process,
 * per provider, so the renderer cannot grant it to itself by editing settings. */

const { log } = require("../logger.cjs");

const KEY = "draggy_voice_consent";

function createConsent(storage) {
  const read = () => {
    try {
      const parsed = JSON.parse(storage.getValue(KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      log.swallow("settings.voice", error, "unreadable consent counts as none given");
      return {};
    }
  };
  return {
    has: (provider, kind = "text") => Boolean(read()[provider]?.[kind]),
    grant(provider, kind = "text") {
      const all = read();
      all[provider] = { ...all[provider], [kind]: new Date().toISOString() };
      storage.setValue(KEY, JSON.stringify(all));
      log.info("settings.voice", "consent granted", { provider, kind });
    },
    revoke(provider) {
      const all = read();
      delete all[provider];
      storage.setValue(KEY, JSON.stringify(all));
      log.info("settings.voice", "consent revoked", { provider });
    },
    list: () => Object.fromEntries(Object.entries(read()).map(([id, kinds]) => [id, Object.keys(kinds)])),
  };
}

module.exports = { createConsent };
