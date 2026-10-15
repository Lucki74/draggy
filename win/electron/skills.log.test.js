import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const skills = require("./skills.cjs");
const logger = require("./logger.cjs");

let root;
let userData;
let info;

const SKILL = "---\nname: Demo\ndescription: Does a demo thing.\n---\nBody.\n";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-skills-log-"));
  userData = path.join(root, "userData");
  skills.init(userData, { libraryRoot: path.join(root, "library") });
  info = vi.spyOn(logger.log, "info");
});

afterEach(() => {
  info.mockRestore();
  fs.rmSync(root, { recursive: true, force: true });
});

const linesFor = (message) => info.mock.calls.filter(([, text]) => text === message);

describe("skill install and remove in the log", () => {
  it("logs an install and a remove with the id only, and nothing for the first listing", () => {
    skills.listSkills(null);
    expect(linesFor("skill installed")).toEqual([]);

    const folder = path.join(userData, "skills", "alpha-skill");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "SKILL.md"), SKILL);
    skills.listSkills(null);
    expect(linesFor("skill installed")).toEqual([["skills", "skill installed", { id: "alpha-skill" }]]);

    fs.rmSync(folder, { recursive: true, force: true });
    skills.listSkills(null);
    expect(linesFor("skill removed")).toEqual([["skills", "skill removed", { id: "alpha-skill" }]]);

    skills.listSkills(null);
    expect(linesFor("skill removed")).toHaveLength(1);
    expect(JSON.stringify(info.mock.calls)).not.toContain(root);
  });
});
