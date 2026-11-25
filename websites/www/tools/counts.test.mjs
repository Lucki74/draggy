/**
 * The counts the site quotes: read from the app checkout, checked against site.config.json, and
 * left as they are when the checkout is not there. Each fake app is built in a temporary folder.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appDirectory, countsFromApp, resolveCounts, writeCounts } from "./counts.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "draggy-counts-test-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

/**
 * A fake app checkout. `servers` is the catalogue length. `skills` maps a folder name to its
 * "on" flag, or to null for a folder with no SKILL.md.
 */
function fakeApp(name, { servers = 3, skills = {} } = {}) {
  const app = join(scratch, name);
  const catalogueDir = join(app, "core", "crates", "mcp", "data");
  const library = join(app, "app", "skills-library");
  mkdirSync(catalogueDir, { recursive: true });
  mkdirSync(library, { recursive: true });

  const entries = Array.from({ length: servers }, (_, i) => ({ id: `server-${i}` }));
  writeFileSync(join(catalogueDir, "catalogue.json"), JSON.stringify(entries));

  const listed = [];
  for (const [folder, on] of Object.entries(skills)) {
    mkdirSync(join(library, folder), { recursive: true });
    if (on === null) continue;
    writeFileSync(join(library, folder, "SKILL.md"), `# ${folder}\n`);
    listed.push({ id: folder, on });
  }
  writeFileSync(join(library, "library.json"), JSON.stringify({ skills: listed }));
  return app;
}

test("the three counts come from the catalogue, the skill folders and library.json", () => {
  const app = fakeApp("full", { servers: 3, skills: { a: true, b: false, c: true, d: null } });
  assert.deepEqual(countsFromApp(app), { mcp: 3, skills: 3, skillsOn: 2 });
});

test("no checkout means no counts", () => {
  assert.equal(countsFromApp(join(scratch, "missing")), null);
});

test("without the app, the committed values stand", () => {
  const config = { mcp: 1, skills: 2, skillsOn: 0, languages: 4, starsMin: 25 };
  assert.deepEqual(resolveCounts(config, join(scratch, "missing")), {
    counts: { mcp: 1, skills: 2, skillsOn: 0 },
    source: "config",
  });
});

test("with the app, matching values are used from the app", () => {
  const app = fakeApp("match", { servers: 3, skills: { a: true } });
  const config = { mcp: 3, skills: 1, skillsOn: 1, starsMin: 25 };
  assert.deepEqual(resolveCounts(config, app), { counts: { mcp: 3, skills: 1, skillsOn: 1 }, source: "app" });
});

test("a count that moved fails the build and names the change", () => {
  const app = fakeApp("moved", { servers: 3, skills: { a: true } });
  const config = { mcp: 2, skills: 1, skillsOn: 1, starsMin: 25 };
  assert.throws(() => resolveCounts(config, app), /mcp 2 -> 3[\s\S]*npm run counts/);
});

test("writeCounts puts the app's counts into site.config.json and keeps the other keys", () => {
  const app = fakeApp("write", { servers: 5, skills: { a: true, b: true } });
  const file = join(scratch, "site.config.json");
  writeFileSync(file, JSON.stringify({ mcp: 0, skills: 0, skillsOn: 0, languages: 4, starsMin: 25 }, null, 2) + "\n");
  writeCounts(app, file);
  assert.equal(readFileSync(file, "utf8"), JSON.stringify({ mcp: 5, skills: 2, skillsOn: 2, languages: 4, starsMin: 25 }, null, 2) + "\n");
});

test("the app is DRAGGY_APP when set, else the repo root", () => {
  const expected = process.env.DRAGGY_APP ? resolve(process.env.DRAGGY_APP) : resolve(root, "..", "..");
  assert.equal(appDirectory(root), expected);
});

test("site.config.json matches the Draggy app checkout when it is present", (t) => {
  const app = appDirectory(root);
  if (!existsSync(join(app, "core", "crates", "mcp", "data", "catalogue.json"))) {
    return t.skip(`no app checkout at ${app}; set DRAGGY_APP to check the counts`);
  }
  const config = JSON.parse(readFileSync(join(root, "site.config.json"), "utf8"));
  assert.equal(resolveCounts(config, app).source, "app");
});
