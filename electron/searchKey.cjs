/** The Brave Search key, in the keystore. Earlier versions kept it in the settings, in the clear;
 * without a keystore it lasts this run only, since a weaker fallback would be the clear again. */
const OWNER = "search:brave";
const SETTINGS_KEY = "draggy_settings";

function createSearchKey({ secrets, storage }) {
  let thisRunOnly = "";

  function get() {
    return (secrets.available() && secrets.get(OWNER).apiKey) || thisRunOnly;
  }

  /** Write-only; an empty key removes it. `kept` says whether it survives a restart. */
  function set(value) {
    const key = String(value || "").trim();
    if (secrets.available() && secrets.set(OWNER, key ? { apiKey: key } : {})) {
      thisRunOnly = "";
      return { success: true, kept: true };
    }
    thisRunOnly = key;
    return { success: true, kept: false };
  }

  function status() {
    const key = get();
    return { hasKey: Boolean(key), keyHint: key ? key.slice(-4) : "", keystore: secrets.available() };
  }

  /** Takes the key out of the saved settings, once, before any window reads them. */
  function adopt() {
    let parsed;
    try {
      parsed = JSON.parse(storage.getValue(SETTINGS_KEY) || "null");
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object" || !("braveApiKey" in parsed)) return;
    if (String(parsed.braveApiKey || "").trim() && !get()) set(parsed.braveApiKey);
    delete parsed.braveApiKey;
    storage.setValue(SETTINGS_KEY, JSON.stringify(parsed));
  }

  return { get, set, status, adopt };
}

module.exports = { createSearchKey };
