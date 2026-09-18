import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_LISTED_SKILLS,
  MAX_LOADED_SKILLS,
  describeSkills,
  loadedSkillIds,
  renderInvokedSkill,
  renderLoadedSkills,
  renderSkill,
  skillInvocation,
  skillsFor,
} from "../skills/skills";
import { matchSlashCommands } from "../chat/slashCommands";
import { registerSkillTools } from "../tools/skills";
import { availableTools, resetRegistry, runTool } from "../tools/registry";
import type { ToolContext, ToolEnvironment } from "../tools/registry";
import type { InstalledSkill, Message, SearchStep } from "../types";

/** The prompt side of skills. The whole idea rests on one number: what a shelf of skills costs when
 * none of them is being used. */

const skill = (id: string, name: string, description: string): InstalledSkill => ({
  id,
  name,
  description,
  path: `C:\\skills\\${id}`,
  source: "user",
});

const WITH_SKILLS: ToolEnvironment = {
  webMode: "auto",
  codeExecution: false,
  libraryReady: false,
  hasSkills: true,
};

function harness() {
  const steps: SearchStep[] = [];

  const context: ToolContext = {
    t: (key) => key,
    settings: {} as never,
    workspaceId: "w1",
    pushStep: (step) => steps.push(step),
    patchStep: (id, patch) => {
      const index = steps.findIndex((entry) => entry.id === id);
      if (index !== -1) steps[index] = { ...steps[index], ...patch };
    },
    syncSteps: () => {},
    newId: () => `step-${steps.length}`,
    signal: new AbortController().signal,
    memo: new Map<string, unknown>(),
  };

  return { context, steps };
}

beforeEach(() => {
  resetRegistry();
  registerSkillTools();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what the prompt carries", () => {
  it("offers each skill by id, name and when it applies", () => {
    const described = describeSkills([
      skill("invoices", "Invoices", "How we write an invoice."),
    ]);

    expect(described).toContain("invoices: Invoices. How we write an invoice.");
    expect(described).toContain("use_skill");
  });

  it("says nothing at all when there are none", () => {
    expect(describeSkills([])).toBe("");
  });

  it("stays small with a shelf full of them", () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      skill(`skill-${i}`, `Skill ${i}`, "A short description of the job."),
    );

    const described = describeSkills(many);

    // The promise of progressive disclosure: the cost is the descriptions, not
    // the instructions, and the list itself is capped.
    expect(described.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(
      MAX_LISTED_SKILLS,
    );
    expect(described.length).toBeLessThan(4000);
  });
});

describe("which skills a side offers", () => {
  const sided = (id: string, surface: InstalledSkill["surface"], enabled = true): InstalledSkill => ({
    ...skill(id, id, `The ${id} job.`),
    source: "library",
    surface,
    enabled,
  });

  it("keeps Chat's and Code's apart, and offers the shared ones on both", () => {
    const all = [sided("docx", "chat"), sided("code-review", "code"), sided("sql-helper", "both")];

    expect(skillsFor(all, "chat").map((one) => one.id)).toEqual(["docx", "sql-helper"]);
    expect(skillsFor(all, "code").map((one) => one.id)).toEqual(["code-review", "sql-helper"]);
  });

  it("leaves out what is switched off", () => {
    expect(skillsFor([sided("docx", "chat", false)], "chat")).toEqual([]);
  });

  it("names a skill once when its name is its id, as skills in the shared format do", () => {
    expect(describeSkills([sided("docx", "chat")])).toContain("- docx: The docx job.");
  });

  it("keeps a slash-only skill out of the model's list", () => {
    const deploy = { ...sided("deploy", "code"), modelInvocable: false };

    expect(describeSkills([deploy])).toBe("");
    expect(describeSkills([deploy, sided("docx", "chat")])).not.toContain("deploy");
  });

  it("fits a whole side of the shipped library, switched on, inside the list's cap", () => {
    const library = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "..", "electron", "skills-library", "library.json"), "utf8"),
    ) as { skills: { id: string; surface: "chat" | "code" | "both"; on: boolean }[] };

    for (const surface of ["chat", "code"] as const) {
      const on = library.skills.filter((entry) => entry.on && entry.surface !== (surface === "chat" ? "code" : "chat"));
      expect(on.length, surface).toBeLessThanOrEqual(MAX_LISTED_SKILLS);
    }
  });

  it("only ever tells the model to use tools that exist", () => {
    const toolsDir = path.join(__dirname, "..", "tools");
    const tools = new Set(
      fs
        .readdirSync(toolsDir)
        .filter((name) => name.endsWith(".ts"))
        .flatMap((name) =>
          [...fs.readFileSync(path.join(toolsDir, name), "utf8").matchAll(/\bname: "([a-z_]+)"/g)].map((m) => m[1]),
        ),
    );

    const libraryDir = path.join(__dirname, "..", "..", "electron", "skills-library");
    const prefixes = /\b(?:search|read|create|run|list|edit|write|move|delete|git|update|use|browser)_[a-z_]+\b/g;

    for (const id of fs.readdirSync(libraryDir).filter((name) => !name.includes("."))) {
      const body = fs.readFileSync(path.join(libraryDir, id, "SKILL.md"), "utf8");
      for (const [word] of body.matchAll(prefixes)) {
        expect(tools.has(word), `${id} mentions ${word}`).toBe(true);
      }
    }
  });
});

describe("a skill started from the composer", () => {
  const skills = [
    { ...skill("code-review", "code-review", "Reviews code."), source: "library" as const },
    { ...skill("docx", "docx", "Word documents."), source: "library" as const },
  ];

  it("recognises the skill's command at the start of a message, with what follows", () => {
    expect(skillInvocation("/code-review src/app.ts please", skills)).toEqual({
      skill: skills[0],
      request: "src/app.ts please",
    });
    expect(skillInvocation("/docx", skills)?.request).toBe("");
  });

  it("leaves other slashes alone", () => {
    expect(skillInvocation("/dev/null is not a file", skills)).toBeNull();
    expect(skillInvocation("please /code-review this", skills)).toBeNull();
    expect(skillInvocation("/unknown thing", skills)).toBeNull();
  });

  it("tells the model the skill is loaded, with the request, so no tool call is needed", () => {
    const rendered = renderInvokedSkill(skills[0], "src/app.ts");

    expect(rendered).toContain("/code-review");
    expect(rendered).toContain("src/app.ts");
    expect(rendered).toContain("LOADED SKILLS");
  });

  it("lists skills in the slash menu after the built-in commands", () => {
    const ids = matchSlashCommands("/", { surface: "code", skills }).map((command) => command.id);

    expect(ids.slice(-2)).toEqual(["code-review", "docx"]);
    expect(matchSlashCommands("/co", { surface: "code", skills }).map((command) => command.id)).toEqual([
      "compact",
      "compact-limit",
      "code-review",
    ]);
  });

  it("describes a skill in the menu by its short summary, not the whole description", () => {
    const pptx = {
      ...skill("pptx", "pptx", "Creates PowerPoint slide decks with create_file, using headings and separators."),
      summary: "Create a slide deck",
      source: "library" as const,
    };

    expect(matchSlashCommands("/pp", { surface: "chat", skills: [pptx] })[0].description).toBe("Create a slide deck");
  });

  it("never lets a skill shadow a built-in command of the same name", () => {
    const init = { ...skill("init", "init", "Mine."), source: "user" as const };

    expect(matchSlashCommands("/init", { surface: "code", skills: [init] })).toHaveLength(1);
    expect(matchSlashCommands("/init", { surface: "code", skills: [init] })[0].description).toBeUndefined();
  });
});

describe("skills that stay loaded", () => {
  const offered: InstalledSkill[] = [
    { ...skill("docx", "docx", "Word documents."), source: "library" },
    { ...skill("pptx", "pptx", "Slides."), source: "library" },
  ];

  const user = (content: string, id = content): Message => ({ id, role: "user", content });
  const reply = (steps: SearchStep[], id: string): Message => ({ id, role: "assistant", content: "done", steps });
  const used = (skillId: string, isComplete = true): SearchStep => ({
    id: `s-${skillId}`,
    type: "skill",
    content: `Used **${skillId}**`,
    isComplete,
    skill: skillId,
  });

  it("counts a skill the model loaded and one the user started, most recent last", () => {
    const messages = [
      user("/pptx the quarterly deck", "u1"),
      reply([], "a1"),
      user("now a handout", "u2"),
      reply([used("docx")], "a2"),
    ];

    expect(loadedSkillIds(messages, offered)).toEqual(["pptx", "docx"]);
  });

  it("moves a skill loaded again to the end rather than listing it twice", () => {
    const messages = [reply([used("docx")], "a1"), reply([used("pptx")], "a2"), user("/docx again", "u3")];

    expect(loadedSkillIds(messages, offered)).toEqual(["pptx", "docx"]);
  });

  it("ignores a load that failed and a skill no longer offered", () => {
    const messages = [reply([used("docx", false)], "a1"), reply([used("dockerfile")], "a2")];

    expect(loadedSkillIds(messages, offered)).toEqual([]);
  });

  it("keeps only the most recent few", () => {
    const many = Array.from({ length: MAX_LOADED_SKILLS + 3 }, (_, i) => ({
      ...skill(`s${i}`, `s${i}`, "A job."),
      source: "library" as const,
    }));
    const messages = many.map((one, i) => reply([used(one.id)], `a${i}`));

    const kept = loadedSkillIds(messages, many);

    expect(kept).toHaveLength(MAX_LOADED_SKILLS);
    expect(kept.at(-1)).toBe(`s${MAX_LOADED_SKILLS + 2}`);
  });

  it("puts every loaded skill's instructions under one heading", () => {
    const rendered = renderLoadedSkills([
      { ...offered[0], body: "Headings become Word headings.", files: [] },
      { ...offered[1], body: "One idea per slide.", files: [] },
    ]);

    expect(rendered).toMatch(/^LOADED SKILLS/);
    expect(rendered).toContain("Headings become Word headings.");
    expect(rendered).toContain("One idea per slide.");
    expect(renderLoadedSkills([])).toBe("");
  });
});

describe("handing one over", () => {
  it("gives the model the instructions and what came with them", () => {
    const rendered = renderSkill({
      ...skill("invoices", "Invoices", "How we invoice."),
      body: "Put the date first.",
      files: ["template.docx"],
    });

    expect(rendered).toContain("Put the date first.");
    expect(rendered).toContain("- template.docx");
    // Read through the tool, which keeps it inside the skill, rather than by a path on disk.
    expect(rendered).toContain("use_skill");
    expect(rendered).not.toContain("C:\\skills\\invoices");
  });

  it("says nothing about files when a skill is only instructions", () => {
    const rendered = renderSkill({
      ...skill("invoices", "Invoices", "How we invoice."),
      body: "Put the date first.",
      files: [],
    });

    expect(rendered).not.toMatch(/files/i);
  });
});

describe("the tool that loads one", () => {
  it("is offered only where there are skills", () => {
    expect(availableTools(WITH_SKILLS).map((tool) => tool.name)).toEqual([
      "use_skill",
    ]);

    expect(
      availableTools({ webMode: "auto", codeExecution: false, libraryReady: false }),
    ).toEqual([]);
  });

  it("asks for the skill the model named, in its own workspace", async () => {
    const read = vi.fn(async () => ({
      success: true,
      skill: {
        ...skill("invoices", "Invoices", "How we invoice."),
        body: "Put the date first.",
        files: [],
      },
    }));

    vi.stubGlobal("window", { electronAPI: { skills: { read } } });

    const { context, steps } = harness();
    const result = await runTool("use_skill", { id: "invoices" }, context, WITH_SKILLS);

    expect(read).toHaveBeenCalledWith("w1", "invoices", { enabledOnly: true, file: undefined });
    expect(result).toContain("Put the date first.");
    expect(steps[0].type).toBe("skill");
    expect(steps[0].isComplete).toBe(true);
  });

  it("reads a file that came with the skill when asked for one", async () => {
    const read = vi.fn(async () => ({
      success: true,
      skill: { ...skill("reports", "reports", "Writes reports."), body: "", files: ["templates/weekly.md"] },
      file: { name: "templates/weekly.md", content: "# Weekly" },
    }));

    vi.stubGlobal("window", { electronAPI: { skills: { read } } });

    const { context, steps } = harness();
    const result = await runTool(
      "use_skill",
      { id: "reports", file: "templates/weekly.md" },
      context,
      WITH_SKILLS,
    );

    expect(read).toHaveBeenCalledWith("w1", "reports", { enabledOnly: true, file: "templates/weekly.md" });
    expect(result).toContain("SKILL FILE: reports/templates/weekly.md");
    expect(result).toContain("# Weekly");
    expect(steps[0].content).toContain("reports/templates/weekly.md");
  });

  it("tells the model plainly when there is no such skill", async () => {
    vi.stubGlobal("window", {
      electronAPI: {
        skills: {
          read: async () => ({ success: false, error: 'There is no skill called "x".' }),
        },
      },
    });

    const { context, steps } = harness();
    const result = await runTool("use_skill", { id: "x" }, context, WITH_SKILLS);

    expect(result).toContain("no skill called");
    expect(steps[0].type).toBe("error");
  });

  it("survives a build with no skill bridge", async () => {
    vi.stubGlobal("window", { electronAPI: {} });

    const { context } = harness();
    const result = await runTool("use_skill", { id: "x" }, context, WITH_SKILLS);

    expect(result).toMatch(/not available/i);
  });
});
