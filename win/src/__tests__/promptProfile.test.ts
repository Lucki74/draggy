import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildSystemPrompt } from "../prompts";
import { promptProfileFor } from "../ai/providers";
import { registerBuiltinTools } from "../tools/builtin";
import { registerCommandTools } from "../tools/commands";
import { registerExploreTools } from "../tools/explore";
import { registerFileTools } from "../tools/files";
import { registerGitTools } from "../tools/git";
import { registerPlanTools } from "../tools/plan";
import { resetRegistry } from "../tools/registry";
import { registerSkillTools } from "../tools/skills";
import type { ToolEnvironment } from "../tools/registry";
import type { AppSettings, InstalledSkill } from "../types";

/** The built-in engine's prompt, frozen: `compact` must stay byte for byte what the engine was sent
 * before prompt profiles existed. The snapshots were written against that code. */

const SETTINGS = { thinkingMode: "medium", webMode: "auto", customInstructions: [] } as unknown as AppSettings;
const CHAT: ToolEnvironment = { webMode: "auto", codeExecution: false, libraryReady: true };
const CODE: ToolEnvironment = { webMode: "auto", codeExecution: true, libraryReady: false, hasFolder: true, projectRoot: "C:\\projects\\thing" };
const SKILL = { id: "pdf", name: "PDF", description: "Reads and writes PDF files.", path: "pdf/SKILL.md", source: "library" } as InstalledSkill;

const CASES: [string, () => string][] = [
  ["chat, native tools and thinking", () => buildSystemPrompt(SETTINGS, { nativeTools: true, nativeThinking: true }, CHAT)],
  ["chat, text tools, web always on", () =>
    buildSystemPrompt({ ...SETTINGS, webMode: "on" } as AppSettings, { nativeTools: false, nativeThinking: false }, CHAT)],
  ["chat, fast, web off, own instructions", () =>
    buildSystemPrompt(
      { ...SETTINGS, thinkingMode: "low", webMode: "off", customInstructions: ["Be brief."] } as AppSettings,
      { nativeTools: true, nativeThinking: false },
      { ...CHAT, webMode: "off" },
    )],
  ["code, native tools, memory and a skill", () =>
    buildSystemPrompt(SETTINGS, { nativeTools: true, nativeThinking: true }, CODE, { path: "AGENTS.md", text: "Use tabs." }, [SKILL])],
  ["code, text tools, high thinking", () =>
    buildSystemPrompt({ ...SETTINGS, thinkingMode: "high" } as AppSettings, { nativeTools: false, nativeThinking: false }, CODE)],
];

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
  // The date line follows the machine's locale; pinned, so the snapshot reads the same everywhere.
  vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(function (this: Date) {
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).format(this);
  });
  resetRegistry();
  registerBuiltinTools();
  registerFileTools();
  registerPlanTools();
  registerSkillTools();
  registerExploreTools();
  registerGitTools();
  registerCommandTools();
});

afterAll(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetRegistry();
});

describe("the compact prompt profile", () => {
  for (const [name, build] of CASES) {
    it(`is today's prompt: ${name}`, () => {
      expect(build()).toMatchSnapshot();
    });
  }

  it("is what the engine gets when no profile is named", () => {
    const mode = { nativeTools: true, nativeThinking: true };
    expect(buildSystemPrompt(SETTINGS, { ...mode, profile: "compact" }, CODE)).toBe(buildSystemPrompt(SETTINGS, mode, CODE));
  });

  it("is where the full profile starts, since full only adds", () => {
    const mode = { nativeTools: true, nativeThinking: true };
    const compact = buildSystemPrompt(SETTINGS, { ...mode, profile: "compact" }, CODE);
    expect(buildSystemPrompt(SETTINGS, { ...mode, profile: "full" }, CODE).startsWith(compact)).toBe(true);
  });
});

describe("the full prompt profile", () => {
  it("adds guidance for the tools a turn has: chat", () => {
    expect(buildSystemPrompt(SETTINGS, { nativeTools: true, nativeThinking: true, profile: "full" }, CHAT)).toMatchSnapshot();
  });

  it("adds guidance for the tools a turn has: code", () => {
    expect(buildSystemPrompt(SETTINGS, { nativeTools: true, nativeThinking: true, profile: "full" }, CODE)).toMatchSnapshot();
  });

  it("adds no tool-calling guidance to a model that calls tools in text", () => {
    const full = buildSystemPrompt(SETTINGS, { nativeTools: false, nativeThinking: false, profile: "full" }, CODE);
    expect(full).not.toContain("Using tools well:");
    expect(full).toContain("Editing files, in more detail:");
  });
});

describe("which profile a model gets", () => {
  const cloud = { kind: "cloud", promptProfile: "auto" } as const;
  const local = { kind: "local", promptProfile: "auto" } as const;

  it("is compact for the built-in engine, whatever else is said", () => {
    expect(promptProfileFor("qwen-72b.gguf", cloud, { id: "qwen-72b", contextLength: 131072 })).toBe("compact");
  });

  it("is full for a cloud model", () => {
    expect(promptProfileFor("@openai/gpt-x", cloud, { id: "gpt-x", contextLength: 8192 })).toBe("full");
  });

  it("is full for a local server's large model and compact for a small one", () => {
    expect(promptProfileFor("@ollama/qwen3:32b", local, { id: "qwen3:32b", contextLength: 8192 })).toBe("full");
    expect(promptProfileFor("@ollama/small", local, { id: "small", contextLength: 65536 })).toBe("full");
    expect(promptProfileFor("@ollama/qwen3:8b", local, { id: "qwen3:8b", contextLength: 32768 })).toBe("compact");
    expect(promptProfileFor("@ollama/qwen3:8b", local, null)).toBe("compact");
  });

  it("is the instance's own choice when it made one", () => {
    expect(promptProfileFor("@openai/gpt-x", { kind: "cloud", promptProfile: "compact" }, null)).toBe("compact");
    expect(promptProfileFor("@ollama/qwen3:8b", { kind: "local", promptProfile: "full" }, null)).toBe("full");
  });

  it("is compact when the instance is gone", () => {
    expect(promptProfileFor("@gone/x", null, null)).toBe("compact");
  });
});
