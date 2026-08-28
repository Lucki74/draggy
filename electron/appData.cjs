const fsDefault = require("fs");
const pathDefault = require("path");

/**
 * Carrying a data folder over when the app changes its name.
 *
 * Chats, settings, created files and the model cache all live in a folder
 * named after the app. Renaming the app therefore points it at a folder that
 * does not exist yet, which to the person using it is indistinguishable from
 * having everything deleted. The old folder is adopted once, on the first run
 * under the new name.
 *
 * This has to be right the first time — there is no second chance at someone's
 * chat history — so the decision is kept here, away from the startup sequence,
 * where it can be tested.
 */

/**
 * The file that proves the app itself has stored something. Emptiness is not a
 * usable test: Electron writes its own profile scaffolding (Preferences, a
 * Network folder, a Local State file) into the folder as it starts, so a
 * folder nobody has ever used still has things in it.
 */
const MARKER = "draggy.db";

/**
 * Decides what to do, without touching anything. Returns one of:
 *
 * - `"adopt"`    the old folder holds the data and should be carried over
 * - `"keep-new"` the new folder already holds data of its own; leave both
 * - `"none"`     there is nothing to carry over
 */
function planAdoption({ fs = fsDefault, path = pathDefault, from, to, marker = MARKER }) {
  if (!from || !to || from === to) return "none";
  if (!fs.existsSync(from)) return "none";
  if (!fs.existsSync(path.join(from, marker))) return "none";
  if (fs.existsSync(to) && fs.existsSync(path.join(to, marker))) return "keep-new";
  return "adopt";
}

/**
 * Carries the folder over, and says in one line what happened.
 *
 * The contents are moved one by one rather than the folder as a whole, since
 * the new folder usually exists already by this point. Anything the new folder
 * has a name for is left alone: overwriting is never the right answer when the
 * question is whose data is newer.
 *
 * Never throws. Failing to move old data is not a reason to refuse to start,
 * and the old folder is left untouched so a later run can try again.
 */
function adoptFolder({ fs = fsDefault, path = pathDefault, from, to, marker = MARKER }) {
  let plan;
  try {
    plan = planAdoption({ fs, path, from, to, marker });
  } catch (error) {
    return { moved: 0, plan: "none", message: `could not inspect ${from}: ${error.message}` };
  }

  if (plan !== "adopt") return { moved: 0, plan, message: null };

  let moved = 0;
  let skipped = 0;

  try {
    fs.mkdirSync(to, { recursive: true });

    for (const entry of fs.readdirSync(from)) {
      const target = path.join(to, entry);
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

module.exports = { planAdoption, adoptFolder, MARKER };
