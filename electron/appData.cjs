const fsDefault = require("fs");
const pathDefault = require("path");

/**
 * Carrying a data folder over when the app is renamed. Pointing at a folder
 * that does not exist yet looks exactly like having lost everything.
 */

/**
 * The file proving the app stored something. Emptiness is no test: Electron
 * writes its own profile scaffolding into the folder as it starts.
 */
const MARKER = "draggy.db";

/**
 * The marker under the app's previous name. It must arrive renamed, or it sits
 * beside a fresh empty database, which is the same as having lost it.
 */
const LEGACY_MARKER = "localai.db";

/**
 * Only the database is renamed, and its `-wal` and `-shm` travel with it:
 * SQLite finds those by the main file's name. Everything else keeps its name.
 */
function arrivalName(entry, marker, legacyMarker) {
  if (!legacyMarker || !entry.startsWith(legacyMarker)) return entry;
  if (entry === legacyMarker) return marker;
  if (entry.startsWith(`${legacyMarker}-`)) {
    return marker + entry.slice(legacyMarker.length);
  }
  return entry;
}

/**
 * Decides what to do without touching anything: "adopt" carries the old folder
 * over, "keep-new" leaves both alone, "none" has nothing to carry.
 */
function planAdoption({
  fs = fsDefault,
  path = pathDefault,
  from,
  to,
  marker = MARKER,
  legacyMarker = LEGACY_MARKER,
}) {
  if (!from || !to || from === to) return "none";
  if (!fs.existsSync(from)) return "none";

  // Either name proves the old folder was used. On the new side only the
  // current one counts; a stray legacy database there is just a leftover.
  const holdsData = [marker, legacyMarker].some(
    (name) => name && fs.existsSync(path.join(from, name)),
  );
  if (!holdsData) return "none";

  if (fs.existsSync(to) && fs.existsSync(path.join(to, marker))) return "keep-new";
  return "adopt";
}

/**
 * Carries the folder over entry by entry, never overwriting. Never throws:
 * failing to move old data is not a reason to refuse to start.
 */
function adoptFolder({
  fs = fsDefault,
  path = pathDefault,
  from,
  to,
  marker = MARKER,
  legacyMarker = LEGACY_MARKER,
}) {
  let plan;
  try {
    plan = planAdoption({ fs, path, from, to, marker, legacyMarker });
  } catch (error) {
    return { moved: 0, plan: "none", message: `could not inspect ${from}: ${error.message}` };
  }

  if (plan !== "adopt") return { moved: 0, plan, message: null };

  let moved = 0;
  let skipped = 0;

  try {
    fs.mkdirSync(to, { recursive: true });

    for (const entry of fs.readdirSync(from)) {
      const target = path.join(to, arrivalName(entry, marker, legacyMarker));
      if (fs.existsSync(target)) {
        skipped++;
        continue;
      }
      fs.renameSync(path.join(from, entry), target);
      moved++;
    }
  } catch (error) {
    return {
      moved,
      plan,
      message: `only partly carried the data folder over from ${from}: ${error.message}`,
    };
  }

  // Only when nothing is left: an empty folder is tidied away, a folder that
  // still holds something is left for the person to look at.
  try {
    if (fs.readdirSync(from).length === 0) fs.rmdirSync(from);
  } catch {
    /* leaving the old folder behind is harmless */
  }

  return {
    moved,
    plan,
    message:
      `carried ${moved} item(s) over from ${from}` +
      (skipped ? `, leaving ${skipped} that already existed` : ""),
  };
}

module.exports = { planAdoption, adoptFolder, arrivalName, MARKER, LEGACY_MARKER };
