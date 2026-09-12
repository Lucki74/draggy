import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_LISTED_SKILLS, describeSkills, renderSkill } from "../skills/skills";
import { registerSkillTools } from "../tools/skills";
import { availableTools, resetRegistry, runTool } from "../tools/registry";
import type { ToolContext, ToolEnvironment } from "../tools/registry";
import type { InstalledSkill, SearchStep } from "../types";

/**
 * The prompt side of skills. The whole idea rests on one number: what a shelf
 * of skills costs when none of them is being used.
 */

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

describe("handing one over", () => {
  it("gives the model the instructions and what came with them", () => {
    const rendered = renderSkill({
      ...skill("invoices", "Invoices", "How we invoice."),
      body: "Put the date first.",
      files: ["template.docx"],
    });

    expect(rendered).toContain("Put the date first.");
    expect(rendered).toContain("template.docx");
    expect(rendered).toContain("C:\\skills\\invoices");
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

    expect(read).toHaveBeenCalledWith("w1", "invoices");
    expect(result).toContain("Put the date first.");
    expect(steps[0].type).toBe("skill");
    expect(steps[0].isComplete).toBe(true);
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
