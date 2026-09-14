const fs = require("fs");
const path = require("path");
const { log } = require("./logger.cjs");

/** Skills: folders with a SKILL.md, the shared format. Only name and description sit in the prompt;
 * the body loads on request, so a hundred cost about one. */

const SKILL_FILE = "SKILL.md";

/** The skills Draggy ships, with which of them start switched on. */
const LIBRARY_ROOT = path.join(__dirname, "skills-library");
const CATALOGUE_FILE = "library.json";

/** How much of a skill body is worth handing over in one go. */
const MAX_BODY_CHARS = 20000;

/** The format's own limit. A longer description is a body in the wrong place. */
const MAX_DESCRIPTION_CHARS = 1024;

/** A file that came with a skill, read on request. Templates and references, not datasets. */
const MAX_FILE_CHARS = 20000;
const MAX_LISTED_FILES = 100;
const MAX_FILE_DEPTH = 3;

const SURFACES = new Set(["chat", "code", "both"]);

let userSkillRoot = null;
let libraryRoot = LIBRARY_ROOT;

function init(userDataPath, options = {}) {
  userSkillRoot = path.join(userDataPath, "skills");
  if (options.libraryRoot !== undefined) libraryRoot = options.libraryRoot;
  return userSkillRoot;
}

/** A `key: >` or `key: |` value continues on the indented lines below it, as skills written for
 * Claude often do. Folded joins them with spaces, literal keeps the breaks. */
function readBlock(lines, start, style) {
  const taken = [];
  let index = start;

  while (index < lines.length && (lines[index].trim() === "" || /^\s/.test(lines[index]))) {
    taken.push(lines[index].trim());
    index++;
  }

  const value = style.startsWith(">")
    ? taken.join(" ").replace(/\s+/g, " ")
    : taken.join("\n");

  return { value: value.trim(), next: index };
}

/** Front matter read without a YAML parser: flat `key: value` lines and block values are all the
 * format needs, and nested keys such as metadata are skipped. */
function parseSkill(text) {
  // A byte order mark, which an editor on Windows may well have put there.
  const source = String(text || "").replace(/^\uFEFF/, "");
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);

  if (!match) return null;

  const fields = {};
  const lines = match[1].split(/\r?\n/);

  for (let index = 0; index < lines.length; ) {
    const line = lines[index];
    const at = line.indexOf(":");

    if (at === -1 || /^\s/.test(line)) {
      index++;
      continue;
    }

    const key = line.slice(0, at).trim().toLowerCase();
    const raw = line.slice(at + 1).trim();

    if (/^[>|][-+]?$/.test(raw)) {
      const block = readBlock(lines, index + 1, raw);
      if (key) fields[key] = block.value;
      index = block.next;
      continue;
    }

    if (key) fields[key] = raw.replace(/^["']|["']$/g, "");
    index++;
  }

  if (!fields.name || !fields.description) return null;

  return {
    name: fields.name,
    description: fields.description.slice(0, MAX_DESCRIPTION_CHARS),
    body: match[2].trim(),
    disableModelInvocation: fields["disable-model-invocation"] === "true",
  };
}

/** A few words for the slash menu, where a whole description does not fit. */
const MAX_SUMMARY_CHARS = 48;

/** A skill written without a summary gets the first phrase of its description, cut at a word. */
function summarize(description) {
  const phrase = String(description || "").split(/(?<=\.)\s|:\s|\s\(|;\s/)[0].replace(/\.$/, "").trim();
  if (phrase.length <= MAX_SUMMARY_CHARS) return phrase;

  const cut = phrase.slice(0, MAX_SUMMARY_CHARS - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 20 ? cut.slice(0, space) : cut).replace(/[,\s]+$/, "")}…`;
}

/** Which library skills exist, what they are for, and whether each starts on. */
function readCatalogue() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(libraryRoot, CATALOGUE_FILE), "utf8"));
    const entries = Array.isArray(parsed?.skills) ? parsed.skills : [];
    return new Map(entries.map((entry) => [entry.id, entry]));
  } catch {
    return new Map();
  }
}

function readSkillFolder(folder, source, catalogue) {
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

  const id = path.basename(folder);
  const entry = source === "library" ? catalogue.get(id) : null;

  return {
    id,
    name: parsed.name,
    description: parsed.description,
    summary: typeof entry?.summary === "string" && entry.summary ? entry.summary : summarize(parsed.description),
    path: folder,
    source,
    category: entry?.category ?? null,
    surface: SURFACES.has(entry?.surface) ? entry.surface : "both",
    // What the user writes is meant to be used; the library waits to be asked, bar its defaults.
    defaultOn: source === "library" ? Boolean(entry?.on) : true,
    modelInvocable: !parsed.disableModelInvocation,
  };
}

function listIn(root, source, catalogue) {
  if (!root || !fs.existsSync(root)) return [];

  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => readSkillFolder(path.join(root, entry.name), source, catalogue))
    .filter(Boolean);
}

/** Every skill a workspace can reach: the library, the user's, and the project's, each winning over
 * the one before when ids match. `overrides` holds the switches the user has flipped. */
function listSkills(projectRoot, overrides = {}) {
  const catalogue = readCatalogue();
  const library = listIn(libraryRoot, "library", catalogue);
  const mine = listIn(userSkillRoot, "user", catalogue);
  const theirs = projectRoot
    ? listIn(path.join(projectRoot, ".draggy", "skills"), "project", catalogue)
    : [];

  const byId = new Map();
  for (const skill of [...library, ...mine, ...theirs]) byId.set(skill.id, skill);

  return [...byId.values()]
    .map((skill) => {
      const flipped = overrides?.[skill.id];
      return { ...skill, enabled: typeof flipped === "boolean" ? flipped : skill.defaultOn };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** What else sits in a skill's folder, as paths relative to it. */
function listFiles(folder) {
  const found = [];

  const walk = (directory, prefix, depth) => {
    if (depth > MAX_FILE_DEPTH || found.length >= MAX_LISTED_FILES) return;

    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || found.length >= MAX_LISTED_FILES) continue;

      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) walk(path.join(directory, entry.name), relative, depth + 1);
      else if (entry.isFile() && relative !== SKILL_FILE) found.push(relative);
    }
  };

  walk(folder, "", 0);
  return found;
}

/** One file from a skill's folder, which it may not climb out of. */
function readSkillFile(skill, name) {
  const target = path.resolve(skill.path, String(name));
  const relative = path.relative(skill.path, target);

  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return { success: false, error: `"${name}" is not a file in the ${skill.id} skill.` };
  }

  let content;
  try {
    if (!fs.statSync(target).isFile()) throw new Error("not a file");
    content = fs.readFileSync(target, "utf8");
  } catch {
    return { success: false, error: `The ${skill.id} skill has no file called "${name}".` };
  }

  if (content.includes("\u0000")) {
    return { success: false, error: `"${name}" is not a text file, so it cannot be read here.` };
  }

  return {
    success: true,
    file: { name: relative.split(path.sep).join("/"), content: content.slice(0, MAX_FILE_CHARS) },
  };
}

/** The whole skill, read only once the model has asked to use it, or one of its files. A switched
 * off skill is refused when `enabledOnly` says the model is the one asking. */
function readSkill(id, projectRoot, options = {}) {
  const { overrides = {}, enabledOnly = false, file = null } = options;
  const skill = listSkills(projectRoot, overrides).find((one) => one.id === id);

  if (!skill) return { success: false, error: `There is no skill called "${id}".` };
  if (enabledOnly && !skill.enabled) {
    return { success: false, error: `The ${id} skill is switched off.` };
  }

  try {
    const files = listFiles(skill.path);

    if (file) {
      const read = readSkillFile(skill, file);
      return read.success ? { success: true, skill: { ...skill, body: "", files }, file: read.file } : read;
    }

    const parsed = parseSkill(fs.readFileSync(path.join(skill.path, SKILL_FILE), "utf8"));

    if (!parsed) return { success: false, error: "That skill could not be read." };

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
  CATALOGUE_FILE,
  LIBRARY_ROOT,
  MAX_BODY_CHARS,
  MAX_DESCRIPTION_CHARS,
  MAX_FILE_CHARS,
  MAX_SUMMARY_CHARS,
  SKILL_FILE,
  init,
  listSkills,
  parseSkill,
  readCatalogue,
  readSkill,
  summarize,
};
