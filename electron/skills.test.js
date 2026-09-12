import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const skills = require("./skills.cjs");

/**
 * Skills. The promise they make is that a hundred of them cost what one does,
 * because only the name and the description are ever in the prompt, and that a
 * broken one is skipped rather than fatal.
 */

let workdir;
let userData;
let project;

function writeSkill(root, id, text) {
  const folder = path.join(root, id);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "SKILL.md"), text);
  return folder;
}

const skill = (name, description, body = "Do the thing.") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;

beforeEach(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-skills-"));
  userData = path.join(workdir, "userdata");
  project = path.join(workdir, "project");

  fs.mkdirSync(path.join(userData, "skills"), { recursive: true });
  fs.mkdirSync(path.join(project, ".draggy", "skills"), { recursive: true });

  skills.init(userData);
});

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

const userSkills = () => path.join(userData, "skills");
const projectSkills = () => path.join(project, ".draggy", "skills");

describe("reading the front matter", () => {
  it("takes the name, the description and the body", () => {
    const parsed = skills.parseSkill(
      skill("Invoices", "How we write an invoice.", "Always put the date first."),
    );

    expect(parsed.name).toBe("Invoices");
    expect(parsed.description).toBe("How we write an invoice.");
    expect(parsed.body).toBe("Always put the date first.");
  });

  it("copes with quotes and Windows line endings", () => {
    const parsed = skills.parseSkill(
      '---\r\nname: "Invoices"\r\ndescription: \'How we do it.\'\r\n---\r\n\r\nBody.\r\n',
    );

    expect(parsed.name).toBe("Invoices");
    expect(parsed.description).toBe("How we do it.");
  });

  it("refuses one with no description, which is what matching needs", () => {
    expect(skills.parseSkill("---\nname: Invoices\n---\n\nBody.")).toBeNull();
  });

  it("refuses a file with no front matter at all", () => {
    expect(skills.parseSkill("# Just a document")).toBeNull();
    expect(skills.parseSkill("")).toBeNull();
  });
});

describe("listing what is installed", () => {
  it("finds the user's own skills", () => {
    writeSkill(userSkills(), "invoices", skill("Invoices", "How we invoice."));

    expect(skills.listSkills()).toEqual([
      expect.objectContaining({ id: "invoices", name: "Invoices", source: "user" }),
    ]);
  });

  it("finds the ones that live in the project", () => {
    writeSkill(projectSkills(), "release", skill("Release", "How we release."));

    const found = skills.listSkills(project);

    expect(found).toHaveLength(1);
    expect(found[0].source).toBe("project");
  });

  it("lets a project skill win over one of the same name", () => {
    writeSkill(userSkills(), "release", skill("Release", "The general way."));
    writeSkill(projectSkills(), "release", skill("Release", "The way we do it."));

    const found = skills.listSkills(project);

    expect(found).toHaveLength(1);
    expect(found[0].description).toBe("The way we do it.");
  });

  it("keeps the body out of the listing", () => {
    writeSkill(
      userSkills(),
      "invoices",
      skill("Invoices", "How we invoice.", "A very long body indeed."),
    );

    const [found] = skills.listSkills();

    expect(found.body).toBeUndefined();
    expect(JSON.stringify(found)).not.toContain("very long body");
  });

  it("skips a broken skill and keeps the rest", () => {
    writeSkill(userSkills(), "good", skill("Good", "Works."));
    writeSkill(userSkills(), "broken", "no front matter here");
    fs.mkdirSync(path.join(userSkills(), "empty"), { recursive: true });

    expect(skills.listSkills().map((one) => one.id)).toEqual(["good"]);
  });

  it("says nothing when there are none", () => {
    expect(skills.listSkills()).toEqual([]);
    expect(skills.listSkills(project)).toEqual([]);
  });
});

describe("reading one on demand", () => {
  it("hands over the body and whatever came with it", () => {
    const folder = writeSkill(
      userSkills(),
      "invoices",
      skill("Invoices", "How we invoice.", "Put the date first."),
    );
    fs.writeFileSync(path.join(folder, "template.docx"), "not really a document");

    const { success, skill: loaded } = skills.readSkill("invoices");

    expect(success).toBe(true);
    expect(loaded.body).toBe("Put the date first.");
    expect(loaded.files).toEqual(["template.docx"]);
  });

  it("says so for a skill that is not there", () => {
    expect(skills.readSkill("nothing").success).toBe(false);
  });

  it("stops a runaway skill filling the context", () => {
    writeSkill(
      userSkills(),
      "long",
      skill("Long", "Too much.", "x".repeat(skills.MAX_BODY_CHARS * 2)),
    );

    const { skill: loaded } = skills.readSkill("long");

    expect(loaded.body).toHaveLength(skills.MAX_BODY_CHARS);
  });
});
