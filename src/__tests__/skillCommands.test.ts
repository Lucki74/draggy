// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareTurn } from "../agent/agentLoop";
import type { TurnInput } from "../agent/agentLoop";
import { defaultSettings } from "../app/settings";
import { forgetContextSize, forgetModelInfo } from "../ollama";
import { resetRegistry } from "../tools/registry";
import type { InstalledSkill } from "../types";

/** A skill typed as a slash command arrives with the message it came in, and the model only ever
 * hears of the skills switched on for its own side. */

const MODEL = "skill-model";

const shelf: InstalledSkill[] = [
  {
    id: "docx",
    name: "docx",
    description: "Creates Word documents.",
    path: "C:\\library\\docx",
    source: "library",
    category: "documents",
    surface: "chat",
    enabled: true,
  },
  {
    id: "code-review",
    name: "code-review",
    description: "Reviews code changes.",
    path: "C:\\library\\code-review",
    source: "library",
    category: "code",
    surface: "code",
    enabled: true,
  },
  {
    id: "dockerfile",
    name: "dockerfile",
    description: "Containerises applications.",
    path: "C:\\library\\dockerfile",
    source: "library",
    category: "code",
    surface: "chat",
    enabled: false,
  },
];

const input = (content: string, overrides: Partial<TurnInput> = {}): TurnInput => ({
  model: MODEL,
  settings: { ...defaultSettings, modelName: MODEL },
  environment: { webMode: "off", codeExecution: false, libraryReady: false, hasSkills: true },
  messages: [{ id: "u1", role: "user", content }],
  workspaceId: "default",
  ...overrides,
});

let read: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetRegistry();
  forgetModelInfo(MODEL);
  forgetContextSize(MODEL);

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/api/show")
        ? new Response(
            JSON.stringify({ capabilities: ["completion", "tools"], model_info: { "test.context_length": 32768 } }),
          )
        : new Response("{}", { status: 404 }),
    ),
  );

  read = vi.fn(async (_workspace: string, id: string) => ({
    success: true,
    skill: { ...shelf.find((one) => one.id === id)!, body: `How to do the ${id} job.`, files: [] },
  }));

  vi.stubGlobal("electronAPI", {
    skills: { list: async () => ({ success: true, skills: shelf }), read },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const lastUser = (turn: Awaited<ReturnType<typeof prepareTurn>>) =>
  [...turn.wire].reverse().find((entry) => entry.role === "user")!.content;

describe("a skill's slash command", () => {
  it("loads the skill with the message it starts, without waiting for the model to ask", async () => {
    const turn = await prepareTurn(input("/docx a packing list for a hike"));

    expect(read).toHaveBeenCalledWith("default", "docx", { enabledOnly: true });
    expect(turn.wire[0].content).toContain("LOADED SKILLS");
    expect(turn.wire[0].content).toContain("How to do the docx job.");
    expect(lastUser(turn)).toContain("/docx a packing list for a hike");
    expect(lastUser(turn)).toContain("The request that came with it: a packing list for a hike");
    expect(turn.invokedSkill).toEqual({ id: "docx", name: "docx" });
  });

  it("does nothing for a message that only mentions a skill", async () => {
    const turn = await prepareTurn(input("make a docx for me"));

    expect(read).not.toHaveBeenCalled();
    expect(lastUser(turn)).not.toContain("How to do");
  });

  it("does not load a skill from the other side", async () => {
    const turn = await prepareTurn(input("/code-review src/app.ts"));

    expect(read).not.toHaveBeenCalled();
    expect(lastUser(turn)).not.toContain("How to do the code-review job.");
  });

  it("keeps the skill loaded when a cut-off reply is continued, without starting it again", async () => {
    const turn = await prepareTurn(
      input("", {
        isContinuation: true,
        messages: [
          { id: "u1", role: "user", content: "/docx a packing list" },
          { id: "a1", role: "assistant", content: "Here is the start of" },
        ],
      }),
    );

    expect(turn.wire[0].content).toContain("How to do the docx job.");
    expect(turn.invokedSkill).toBeNull();
  });

  it("sends the message as written when the skill cannot be read", async () => {
    read.mockResolvedValueOnce({ success: false, error: "The docx skill is switched off." });

    const turn = await prepareTurn(input("/docx a packing list"));

    expect(lastUser(turn)).toContain("/docx a packing list");
    expect(lastUser(turn)).not.toContain("LOADED SKILLS");
    expect(turn.wire[0].content).not.toContain("LOADED SKILLS");
    expect(turn.invokedSkill).toBeNull();
  });
});

describe("a skill that has been loaded", () => {
  it("stays in the instructions for the turns after it", async () => {
    const turn = await prepareTurn(
      input("", {
        messages: [
          { id: "u1", role: "user", content: "/docx a packing list" },
          { id: "a1", role: "assistant", content: "Saved packing-list.docx." },
          { id: "u2", role: "user", content: "Add a section for food." },
        ],
      }),
    );

    expect(turn.wire[0].content).toContain("How to do the docx job.");
    expect(lastUser(turn)).not.toContain("/docx");
    expect(turn.invokedSkill).toBeNull();
  });

  it("stays when it was the model that loaded it", async () => {
    const turn = await prepareTurn(
      input("", {
        messages: [
          { id: "u1", role: "user", content: "Make me a Word document." },
          {
            id: "a1",
            role: "assistant",
            content: "Done.",
            steps: [{ id: "s1", type: "skill", content: "Used **docx**", isComplete: true, skill: "docx" }],
          },
          { id: "u2", role: "user", content: "Shorter, please." },
        ],
      }),
    );

    expect(turn.wire[0].content).toContain("How to do the docx job.");
  });

  it("is counted apart from the skill list and the tools, by name", async () => {
    const turn = await prepareTurn(input("/docx a packing list"));

    expect(turn.promptParts.loadedSkills).toEqual([
      { id: "docx", name: "docx", chars: expect.any(Number) },
    ]);
    expect(turn.promptParts.loadedSkillChars).toBeGreaterThan(turn.promptParts.loadedSkills![0].chars);
    expect(turn.promptParts.skillCount).toBe(1);
    expect(turn.promptParts.toolCount).toBeGreaterThanOrEqual(0);
    expect(turn.promptParts.systemChars).toBeLessThan(turn.wire[0].content.length - turn.promptParts.loadedSkillChars!);
  });
});

describe("the list the model is offered", () => {
  it("names only the skills switched on for Chat when the turn is in Chat", async () => {
    const turn = await prepareTurn(input("hello"));
    const system = turn.wire[0].content;

    expect(system).toContain("- docx: Creates Word documents.");
    expect(system).not.toContain("code-review");
    expect(system).not.toContain("dockerfile");
  });

  it("names Code's skills in a project", async () => {
    const turn = await prepareTurn(
      input("hello", {
        environment: { webMode: "off", codeExecution: false, libraryReady: false, hasSkills: true, hasFolder: true },
      }),
    );
    const system = turn.wire[0].content;

    expect(system).toContain("- code-review: Reviews code changes.");
    expect(system).not.toContain("- docx:");
  });
});
