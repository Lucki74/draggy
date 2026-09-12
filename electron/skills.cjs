const fs = require("fs");
const path = require("path");
const { log } = require("./logger.cjs");

/**
 * Skills: procedural knowledge the user writes down once. A skill is a folder
 * with a SKILL.md in it, the format the wider ecosystem settled on, so one
 * written for another tool works here unchanged.
 *
 * What makes them cheap is that only the name and the description are ever in
 * the prompt. The body is read when the model asks for it, which is why a
 * hundred skills cost about as much as one.
 */

const SKILL_FILE = "SKILL.md";

/** How much of a skill body is worth handing over in one go. */
const MAX_BODY_CHARS = 20000;

let userSkillRoot = null;

function init(userDataPath) {
  userSkillRoot = path.join(userDataPath, "skills");
  return userSkillRoot;
}

/**
 * The YAML front matter at the top of a skill, read without a YAML parser: the
 * format only asks for flat `key: value` lines, and a skill that needs more
 * than that is doing something the loader should not encourage.
 */
function parseSkill(text) {
  // A byte order mark, which an editor on Windows may well have put there.
  const source = String(text || "").replace(/^\uFEFF/, "");
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);

  if (!match) return null;

  const fields = {};

  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at === -1) continue;

    const key = line.slice(0, at).trim().toLowerCase();
    const value = line
      .slice(at + 1)
      .trim()
      .replace(/^["']|["']$/g, "");

    if (key) fields[key] = value;
  }

  if (!fields.name || !fields.description) return null;

  return {
    name: fields.name,
    description: fields.description,
    body: match[2].trim(),
  };
}

function readSkillFolder(folder, source) {
  const file = path.join(folder, SKILL_FILE);

  let parsed;
  try {
    parsed = parseSkill(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }

  // A folder with a broken SKILL.md is skipped rather than breaking the list:
  // one bad skill must not cost the user the others.
  if (!parsed) {
    log.warn("skills", `${path.basename(folder)} has no usable front matter`);
    return null;
  }

  return {
    id: path.basename(folder),
    name: parsed.name,
    description: parsed.description,
    path: folder,
    source,
  };
}

function listIn(root, source) {
  if (!root || !fs.existsSync(root)) return [];

  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => readSkillFolder(path.join(root, entry.name), source))
    .filter(Boolean);
}

/**
 * Every skill available to a workspace: the ones the user keeps for everything,
 * and the ones that live in the project itself. A project skill with the same
 * name wins, because it is the more specific of the two.
 */
function listSkills(projectRoot) {
  const mine = listIn(userSkillRoot, "user");
  const theirs = projectRoot
    ? listIn(path.join(projectRoot, ".draggy", "skills"), "project")
    : [];

  const byId = new Map();
  for (const skill of [...mine, ...theirs]) byId.set(skill.id, skill);

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The whole skill, read only once the model has asked to use it. */
function readSkill(id, projectRoot) {
  const skill = listSkills(projectRoot).find((one) => one.id === id);
  if (!skill) return { success: false, error: `There is no skill called "${id}".` };

  try {
    const parsed = parseSkill(
      fs.readFileSync(path.join(skill.path, SKILL_FILE), "utf8"),
    );

    if (!parsed) return { success: false, error: "That skill could not be read." };

    const files = fs
      .readdirSync(skill.path, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name !== SKILL_FILE)
      .map((entry) => entry.name);

    return {
      success: true,
      skill: {
        ...skill,
        body: parsed.body.slice(0, MAX_BODY_CHARS),
        files,
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  MAX_BODY_CHARS,
  SKILL_FILE,
  init,
  listSkills,
  parseSkill,
  readSkill,
};
