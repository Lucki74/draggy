import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const skills = require("./skills.cjs");

/** Skills: a hundred cost what one does, since only name and description are in the prompt, and a
 * broken one is skipped rather than fatal. */

let workdir;
let userData;
let project;
let library;

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

  // An empty library of its own, so each test sees only the skills it wrote.
  library = path.join(workdir, "library");
  fs.mkdirSync(library, { recursive: true });
  skills.init(userData, { libraryRoot: library });
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

describe("front matter written for Claude", () => {
  it("reads a description folded over several lines", () => {
    const parsed = skills.parseSkill(
      "---\nname: pdf\ndescription: >\n  Fills in PDF forms\n  and merges files.\nlicense: MIT\n---\n\nBody.",
    );

    expect(parsed.description).toBe("Fills in PDF forms and merges files.");
    expect(parsed.name).toBe("pdf");
  });

  it("skips nested keys it has no use for", () => {
    const parsed = skills.parseSkill(
      "---\nname: notes\nmetadata:\n  version: 2\n  author: someone\ndescription: Takes notes.\n---\n\nBody.",
    );

    expect(parsed.description).toBe("Takes notes.");
  });

  it("marks a skill only a slash command may start", () => {
    const text = "---\nname: deploy\ndescription: Deploys.\ndisable-model-invocation: true\n---\n\nBody.";

    expect(skills.parseSkill(text).disableModelInvocation).toBe(true);
    expect(skills.parseSkill(skill("deploy", "Deploys.")).disableModelInvocation).toBe(false);
  });

  it("cuts a description at the format's limit", () => {
    const parsed = skills.parseSkill(skill("long", "x".repeat(3000)));

    expect(parsed.description).toHaveLength(skills.MAX_DESCRIPTION_CHARS);
  });
});

describe("the library and the switches", () => {
  function writeLibrary(entries) {
    for (const entry of entries) writeSkill(library, entry.id, skill(entry.id, `The ${entry.id} job.`));
    fs.writeFileSync(
      path.join(library, skills.CATALOGUE_FILE),
      JSON.stringify({ categories: ["writing", "code"], skills: entries }),
    );
  }

  it("lists shipped skills with their shelf, side and default", () => {
    writeLibrary([
      { id: "proofreader", category: "writing", surface: "chat", on: true },
      { id: "dockerfile", category: "code", surface: "code", on: false },
    ]);

    const found = skills.listSkills();

    expect(found).toEqual([
      expect.objectContaining({ id: "dockerfile", source: "library", category: "code", surface: "code", enabled: false }),
      expect.objectContaining({ id: "proofreader", source: "library", category: "writing", surface: "chat", enabled: true }),
    ]);
  });

  it("switches on what the user wrote, on both sides", () => {
    writeSkill(userSkills(), "invoices", skill("Invoices", "How we invoice."));

    const [found] = skills.listSkills();

    expect(found).toMatchObject({ enabled: true, defaultOn: true, surface: "both", category: null });
  });

  it("lets the user's switches win over the defaults", () => {
    writeLibrary([
      { id: "proofreader", category: "writing", surface: "chat", on: true },
      { id: "dockerfile", category: "code", surface: "code", on: false },
    ]);
    writeSkill(userSkills(), "invoices", skill("Invoices", "How we invoice."));

    const found = skills.listSkills(undefined, { proofreader: false, dockerfile: true, invoices: false });
    const byId = Object.fromEntries(found.map((one) => [one.id, one.enabled]));

    expect(byId).toEqual({ proofreader: false, dockerfile: true, invoices: false });
  });

  it("lets the user's own version of a shipped skill replace it", () => {
    writeLibrary([{ id: "proofreader", category: "writing", surface: "chat", on: true }]);
    writeSkill(userSkills(), "proofreader", skill("proofreader", "The way I like it."));

    const found = skills.listSkills();

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ source: "user", description: "The way I like it." });
  });

  it("refuses a switched-off skill to the model but still shows it to the user", () => {
    writeLibrary([{ id: "dockerfile", category: "code", surface: "code", on: false }]);

    expect(skills.readSkill("dockerfile", undefined, { enabledOnly: true }).success).toBe(false);
    expect(skills.readSkill("dockerfile").success).toBe(true);
    expect(
      skills.readSkill("dockerfile", undefined, { enabledOnly: true, overrides: { dockerfile: true } }).success,
    ).toBe(true);
  });
});

describe("a summary for the slash menu", () => {
  it("takes the first phrase of a description the user wrote", () => {
    writeSkill(
      userSkills(),
      "invoices",
      skill("Invoices", "Writes our invoices: numbered lines, tax and totals. Use when billing a client."),
    );

    expect(skills.listSkills()[0].summary).toBe("Writes our invoices");
  });

  it("stops at the end of the first sentence", () => {
    expect(skills.summarize("Reviews pull requests. Use when asked.")).toBe("Reviews pull requests");
  });

  it("cuts a long phrase at a word, and says it did", () => {
    const summary = skills.summarize(
      "Turns every single spreadsheet export from the accounting system into a monthly board pack",
    );

    expect(summary.length).toBeLessThanOrEqual(skills.MAX_SUMMARY_CHARS);
    expect(summary.endsWith("…")).toBe(true);
    expect(summary).not.toMatch(/\s…$/);
  });

  it("prefers the library's own summary", () => {
    writeSkill(library, "pptx", skill("pptx", "Creates PowerPoint decks with create_file, using headings."));
    fs.writeFileSync(
      path.join(library, skills.CATALOGUE_FILE),
      JSON.stringify({ skills: [{ id: "pptx", category: "documents", surface: "chat", on: true, summary: "Create a slide deck" }] }),
    );

    expect(skills.listSkills()[0].summary).toBe("Create a slide deck");
  });
});

describe("files that come with a skill", () => {
  function skillWithFiles() {
    const folder = writeSkill(userSkills(), "reports", skill("reports", "Writes reports."));
    fs.mkdirSync(path.join(folder, "templates"), { recursive: true });
    fs.writeFileSync(path.join(folder, "templates", "weekly.md"), "# Weekly\n");
    fs.writeFileSync(path.join(folder, "checklist.md"), "- [ ] Numbers checked\n");
    fs.writeFileSync(path.join(folder, ".hidden"), "not listed");
    fs.writeFileSync(path.join(folder, "logo.png"), Buffer.from([137, 80, 78, 71, 0, 0, 0, 13]));
    return folder;
  }

  it("lists them by path inside the skill, nested ones included", () => {
    skillWithFiles();

    const { skill: loaded } = skills.readSkill("reports");

    expect(loaded.files).toEqual(["checklist.md", "logo.png", "templates/weekly.md"]);
  });

  it("reads one on request instead of the instructions", () => {
    skillWithFiles();

    const result = skills.readSkill("reports", undefined, { file: "templates/weekly.md" });

    expect(result.success).toBe(true);
    expect(result.file).toEqual({ name: "templates/weekly.md", content: "# Weekly\n" });
    expect(result.skill.body).toBe("");
  });

  it("never reads outside the skill's folder", () => {
    skillWithFiles();
    writeSkill(userSkills(), "secret", skill("secret", "Other skill.", "Private body."));
    fs.writeFileSync(path.join(userData, "settings.json"), "{}");

    for (const escape of ["../secret/SKILL.md", "../../settings.json", path.join(userData, "settings.json")]) {
      const result = skills.readSkill("reports", undefined, { file: escape });
      expect(result.success, escape).toBe(false);
    }
  });

  it("says so for a file that is missing or not text", () => {
    skillWithFiles();

    expect(skills.readSkill("reports", undefined, { file: "nope.md" }).success).toBe(false);
    expect(skills.readSkill("reports", undefined, { file: "logo.png" }).error).toContain("not a text file");
  });
});

describe("the library Draggy ships", () => {
  beforeEach(() => {
    skills.init(userData, { libraryRoot: skills.LIBRARY_ROOT });
  });

  const catalogue = () =>
    JSON.parse(fs.readFileSync(path.join(skills.LIBRARY_ROOT, skills.CATALOGUE_FILE), "utf8"));

  const folders = () =>
    fs
      .readdirSync(skills.LIBRARY_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

  it("holds at least 56 skills, and loads every one of them", () => {
    expect(folders().length).toBeGreaterThanOrEqual(56);
    expect(skills.listSkills().map((one) => one.id).sort()).toEqual(folders());
  });

  it("lists every folder in the catalogue and nothing else", () => {
    expect(catalogue().skills.map((entry) => entry.id).sort()).toEqual(folders());
  });

  it("names each skill after its folder, with a description the format accepts", () => {
    for (const found of skills.listSkills()) {
      const raw = fs.readFileSync(path.join(found.path, skills.SKILL_FILE), "utf8");
      const parsed = skills.parseSkill(raw);
      const written = raw.match(/^description: (.*)$/m)[1].replace(/^"|"$/g, "");

      expect(parsed.name, found.id).toBe(found.id);
      expect(found.id, found.id).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
      expect(written.length, found.id).toBeLessThanOrEqual(skills.MAX_DESCRIPTION_CHARS);
      expect(parsed.body.length, found.id).toBeGreaterThan(400);
    }
  });

  it("puts each skill on a known shelf and side", () => {
    const { categories, skills: entries } = catalogue();

    for (const entry of entries) {
      expect(categories, entry.id).toContain(entry.category);
      expect(["chat", "code", "both"], entry.id).toContain(entry.surface);
      expect(typeof entry.on, entry.id).toBe("boolean");
    }
  });

  it("gives every skill a summary short enough for one line of the slash menu", () => {
    for (const found of skills.listSkills()) {
      expect(found.summary, found.id).toBeTruthy();
      expect(found.summary.length, found.id).toBeLessThanOrEqual(36);
    }
  });

  it("starts with many switched on, and some left for the user to choose", () => {
    const on = catalogue().skills.filter((entry) => entry.on).length;

    expect(on).toBeGreaterThanOrEqual(20);
    expect(on).toBeLessThan(catalogue().skills.length);
  });

  it("ships every file a skill tells the model to read", () => {
    for (const found of skills.listSkills()) {
      const { skill: loaded } = skills.readSkill(found.id);

      for (const [, name] of loaded.body.matchAll(/file "([^"]+)"/g)) {
        expect(loaded.files, `${found.id} mentions ${name}`).toContain(name);
        expect(skills.readSkill(found.id, undefined, { file: name }).success, name).toBe(true);
      }
    }
  });
});
