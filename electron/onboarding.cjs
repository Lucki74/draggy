/** Whether a launch opens on the first-run setup. Decides from plain inputs and touches nothing,
 * like appData.cjs, so every case is a unit test rather than a fresh install. */

const CURRENT_VERSION = 1;
const RECORD_KEY = "onboarding";
const PATHS = ["local", "provider", "both", "skipped", "adopted"];

/** The stored record, or null for anything that is not one. A damaged record reads as none. */
function readRecord(raw) {
  if (typeof raw !== "string" || !raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (parsed.status !== "in-progress" && parsed.status !== "done") return null;
  if (typeof parsed.version !== "number") return null;
  return parsed;
}

/** "show", "adopt" (an existing user: record it as done and show nothing) or "done". */
function planOnboarding({ record, hasSettings, modelCount, chatCount, forced }) {
  if (forced) return "show";
  if (record?.status === "in-progress") return "show";
  // An older version is done too: the field is room for a later "new steps only" flow.
  if (record?.status === "done") return "done";
  if (hasSettings || modelCount > 0 || chatCount > 0) return "adopt";
  return "show";
}

/** Runs each reader, and counts one that fails as prior use: losing the setup costs a new user
 * less than showing it costs an existing one. */
function collectInputs({ readRaw, readSettings, countModels, countChats, forced }) {
  const failed = Symbol("failed");
  const attempt = (read) => {
    try {
      return read();
    } catch {
      return failed;
    }
  };
  const count = (read) => {
    const value = attempt(read);
    return typeof value === "number" && Number.isFinite(value) ? value : 1;
  };

  const raw = attempt(readRaw);
  const settings = attempt(readSettings);
  return {
    record: raw === failed ? null : readRecord(raw),
    hasSettings: settings === failed || (typeof settings === "string" && settings.length > 0),
    modelCount: count(countModels),
    chatCount: count(countChats),
    forced: Boolean(forced),
  };
}

function isValidPath(path) {
  return PATHS.includes(path);
}

function inProgressRecord(now = new Date()) {
  return { version: CURRENT_VERSION, status: "in-progress", startedAt: now.toISOString() };
}

/** The record once setup ends. A path that is not one of the known ones is refused, not stored. */
function doneRecord(path, now = new Date(), startedAt) {
  if (!isValidPath(path)) throw new Error(`not a setup path: ${String(path)}`);
  const record = { version: CURRENT_VERSION, status: "done", path, completedAt: now.toISOString() };
  return startedAt ? { ...record, startedAt } : record;
}

/** What starting the setup writes: nothing over a start already recorded, so a resume keeps its date. */
function recordOnStart(existing, now = new Date()) {
  return existing?.status === "in-progress" ? null : inProgressRecord(now);
}

module.exports = {
  recordOnStart,
  CURRENT_VERSION,
  RECORD_KEY,
  PATHS,
  readRecord,
  planOnboarding,
  collectInputs,
  isValidPath,
  inProgressRecord,
  doneRecord,
};
