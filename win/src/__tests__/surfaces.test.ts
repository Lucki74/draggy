import { beforeEach, describe, expect, it } from "vitest";
import { registerBuiltinTools } from "../tools/builtin";
import { registerFileTools } from "../tools/files";
import { registerPlanTools } from "../tools/plan";
import { availableTools, resetRegistry } from "../tools/registry";
import type { ToolEnvironment } from "../tools/registry";
import { BASE_PROMPT, CODE_BASE_PROMPT, FILE_FORMAT_PROMPT, buildSystemPrompt } from "../prompts";
import type { AppSettings } from "../types";

/** Chat and Code are separate: each gets its own tools and is told about its own abilities, so a
 * chat never plans or edits a project, and a project never makes loose files. */

const SETTINGS = {
  thinkingMode: "medium",
  webMode: "auto",
  customInstructions: [],
} as unknown as AppSettings;

const MODE = { nativeTools: true, nativeThinking: true };

const CHAT: ToolEnvironment = { webMode: "auto", codeExecution: false, libraryReady: false };

const CODE: ToolEnvironment = {
  ...CHAT,
  codeExecution: true,
  hasFolder: true,
  projectRoot: "C:\\projects\\thing",
};

const names = (environment: ToolEnvironment) => availableTools(environment).map((tool) => tool.name);

beforeEach(() => {
  resetRegistry();
  registerBuiltinTools();
  registerFileTools();
  registerPlanTools();
});

describe("the tools each side gets", () => {
  it("lets Chat make files, and nothing that works on a project", () => {
    const chat = names(CHAT);

    expect(chat).toContain("create_file");
    for (const tool of ["update_plan", "run_code", "read_file", "edit_file", "write_file"]) {
      expect(chat).not.toContain(tool);
    }
  });

  it("lets Code plan, run code and change the project, and not make loose files", () => {
    const code = names(CODE);

    for (const tool of ["update_plan", "run_code", "read_file", "edit_file", "write_file"]) {
      expect(code).toContain(tool);
    }
    expect(code).not.toContain("create_file");
  });
});

describe("what each side is told it can do", () => {
  it("tells Chat about files and browsing, with how to write documents", () => {
    const prompt = buildSystemPrompt(SETTINGS, MODE, CHAT);

    expect(prompt).toContain(BASE_PROMPT);
    expect(prompt).toContain(FILE_FORMAT_PROMPT);
    expect(prompt).not.toContain("working in a project folder");
  });

  it("tells Code about the project, and leaves document formats out", () => {
    const prompt = buildSystemPrompt(SETTINGS, MODE, CODE);

    expect(prompt).toContain(CODE_BASE_PROMPT);
    expect(prompt).toContain("working in a project folder");
    expect(prompt).not.toContain(FILE_FORMAT_PROMPT);
    expect(prompt).not.toContain("create files for the user");
  });

  it("keeps the rules both sides share, spaced as they were", () => {
    for (const prompt of [BASE_PROMPT, CODE_BASE_PROMPT]) {
      expect(prompt).toContain("<safety>");
      expect(prompt).toContain("</honesty>\n\n<capabilities>");
      expect(prompt).toContain("</capabilities>\n\n<coding>");
    }
  });
});
