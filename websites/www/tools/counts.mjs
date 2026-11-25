/**
 * The three numbers the site quotes, read from the Draggy app repo so none of them is typed by hand:
 *
 *   mcp       core/crates/mcp/data/catalogue.json, the number of entries (107)
 *   skills    win/skills-library/<name>/SKILL.md, one per folder (572)
 *   skillsOn  win/skills-library/library.json, the skills with "on": true (50)
 *
 * The app is DRAGGY_APP when that is set, else the repo root. Without it the committed site.config.json
 * stands. The build fails when the two disagree, so a count that moves is written down on purpose:
 * run `npm run counts`, which writes the app's numbers into site.config.json, and commit that.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const CONFIG = join(root, "site.config.json");

/** The keys this module owns. The rest of site.config.json (starsMin, languages) is not counted from the app. */
export const KEYS = ["mcp", "skills", "skillsOn"];

/** The app checkout: DRAGGY_APP when set, else the repo root two levels up. */
export function appDirectory(base = root) {
  if (process.env.DRAGGY_APP) return resolve(process.env.DRAGGY_APP);
  return join(base, "..", "..");
}

/** The three counts from an app checkout, or null when the checkout is not there. */
export function countsFromApp(app) {
  const catalogue = join(app, "core", "crates", "mcp", "data", "catalogue.json");
  const library = join(app, "app", "skills-library");
  const manifest = join(library, "library.json");
  if (!existsSync(catalogue) || !existsSync(manifest)) return null;
  return {
    mcp: countCatalogue(catalogue),
    skills: countSkillFolders(library),
    skillsOn: JSON.parse(readFileSync(manifest, "utf8")).skills.filter((skill) => skill.on === true).length,
  };
}

/** The number of entries in the MCP catalogue, which is a JSON array. */
function countCatalogue(file) {
  return JSON.parse(readFileSync(file, "utf8")).length;
}

/** One skill per folder that holds a SKILL.md, the same rule the app uses to list the library. */
function countSkillFolders(library) {
  return readdirSync(library, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && existsSync(join(library, entry.name, "SKILL.md")),
  ).length;
}

/**
 * The counts the build uses. With the app present they must match site.config.json, or the build
 * throws and names the change. Without the app the committed values are used as they are.
 */
export function resolveCounts(config, app = appDirectory()) {
  const fromApp = countsFromApp(app);
  if (!fromApp) return { counts: pick(config), source: "config" };

  const moved = KEYS.filter((key) => fromApp[key] !== config[key]);
  if (moved.length) {
    const changes = moved.map((key) => `${key} ${config[key]} -> ${fromApp[key]}`).join(", ");
    throw new Error(
      `site.config.json is out of date with the app (${changes}). Run "npm run counts" and commit the result if the new numbers are right.`,
    );
  }
  return { counts: fromApp, source: "app" };
}

/** Writes the app's counts into site.config.json. Other keys keep their values and their order. */
export function writeCounts(app = appDirectory(), file = CONFIG) {
  const fromApp = countsFromApp(app);
  if (!fromApp) throw new Error(`no Draggy app checkout at ${app}. Set DRAGGY_APP to its folder.`);
  const next = { ...JSON.parse(readFileSync(file, "utf8")), ...fromApp };
  writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
  return next;
}

function pick(config) {
  return Object.fromEntries(KEYS.map((key) => [key, config[key]]));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const next = writeCounts();
  console.log(`site.config.json: mcp ${next.mcp}, skills ${next.skills}, skillsOn ${next.skillsOn}`);
}
