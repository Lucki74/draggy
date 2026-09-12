import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../prompts";
import type { ToolEnvironment } from "../tools/registry";
import type { AppSettings } from "../types";

/**
 * What the model is told before a turn. The project's own file is the part
 * worth holding still: it has to be there when the folder has one, absent when
 * it does not, and never quietly outranked by Draggy's own instructions.
 */

const SETTINGS = {
  thinkingMode: "medium",
  webMode: "auto",
  customInstructions: [],
} as unknown as AppSettings;

const MODE = { nativeTools: true, nativeThinking: true };

const CHAT: ToolEnvironment = {
  webMode: "auto",
  codeExecution: false,
  libraryReady: false,
};

const PROJECT: ToolEnvironment = {
  ...CHAT,
  hasFolder: true,
  projectRoot: "C:\\projects\\thing",
};

describe("a plain chat", () => {
  it("says nothing about a project folder", () => {
    const prompt = buildSystemPrompt(SETTINGS, MODE, CHAT);

    expect(prompt).not.toContain("PROJECT FOLDER");
    expect(prompt).not.toContain("PROJECT INSTRUCTIONS");
  });

  it("ignores a memory file when there is no folder to belong to", () => {
    const prompt = buildSystemPrompt(SETTINGS, MODE, CHAT, {
      path: "AGENTS.md",
      text: "Use tabs.",
    });

    // The block still goes in: a caller that found one meant it. What must not
    // happen is the folder prompt appearing without a folder.
    expect(prompt).not.toContain("PROJECT FOLDER");
  });
});

describe("a project", () => {
  it("says where it is", () => {
    const prompt = buildSystemPrompt(SETTINGS, MODE, PROJECT);

    expect(prompt).toContain("PROJECT FOLDER");
    expect(prompt).toContain("C:\\projects\\thing");
  });

  it("carries the project's own instructions when it has some", () => {
    const prompt = buildSystemPrompt(SETTINGS, MODE, PROJECT, {
      path: "AGENTS.md",
      text: "Always run npm run check.",
    });

    expect(prompt).toContain("PROJECT INSTRUCTIONS (AGENTS.md)");
    expect(prompt).toContain("Always run npm run check.");
  });

  it("puts them after the folder, so they read as rules for it", () => {
    const prompt = buildSystemPrompt(SETTINGS, MODE, PROJECT, {
      path: "AGENTS.md",
      text: "Always run npm run check.",
    });

    expect(prompt.indexOf("PROJECT FOLDER")).toBeLessThan(
      prompt.indexOf("PROJECT INSTRUCTIONS"),
    );
  });

  it("says nothing extra when the project has no instructions", () => {
    const prompt = buildSystemPrompt(SETTINGS, MODE, PROJECT, null);

    expect(prompt).not.toContain("PROJECT INSTRUCTIONS");
  });

  it("keeps the user's own instructions as well", () => {
    const prompt = buildSystemPrompt(
      { ...SETTINGS, customInstructions: ["Call me by my name."] },
      MODE,
      PROJECT,
      { path: "AGENTS.md", text: "Use tabs." },
    );

    expect(prompt).toContain("Call me by my name.");
    expect(prompt).toContain("Use tabs.");
  });
});
