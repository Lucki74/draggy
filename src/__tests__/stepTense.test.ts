import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerBuiltinTools } from "../tools/builtin";
import { registerFileTools } from "../tools/files";
import { registerSkillTools } from "../tools/skills";
import { describeMcpTool } from "../tools/mcp";
import { resetRegistry, runTool } from "../tools/registry";
import type { ToolContext, ToolEnvironment } from "../tools/registry";
import type { SearchStep } from "../types";

/**
 * A step reads as something happening while it happens and as something done
 * once it is: "Reading notes.md", then "Read notes.md". A timeline that still
 * says "Searching" after the search came back looks stuck.
 */

const EVERYTHING: ToolEnvironment = {
  webMode: "on",
  codeExecution: true,
  libraryReady: true,
  hasFolder: true,
  hasSkills: true,
  projectRoot: "C:\\projects\\thing",
};

function harness() {
  const steps: SearchStep[] = [];
  /** What each step said the moment it appeared. */
  const firstSaid = new Map<string, string>();

  const context: ToolContext = {
    // The key comes back as the text, so a step's wording is the key it used.
    t: (key) => key,
    settings: {} as never,
    workspaceId: "project-7",
    chatId: "chat-1",
    pushStep: (step) => {
      steps.push(step);
      firstSaid.set(step.id, step.content);
    },
    patchStep: (id, patch) => {
      const index = steps.findIndex((entry) => entry.id === id);
      if (index !== -1) steps[index] = { ...steps[index], ...patch };
    },
    syncSteps: () => {},
    newId: () => `step-${steps.length}`,
    signal: new AbortController().signal,
    memo: new Map<string, unknown>(),
  };

  /** The first step, as it began and as it ended. */
  const lifecycle = () => ({
    began: firstSaid.get(steps[0].id) ?? "",
    ended: steps[0].content,
    complete: steps[0].isComplete,
  });

  return { context, steps, lifecycle };
}

beforeEach(() => {
  resetRegistry();
  registerBuiltinTools();
  registerFileTools();
  registerSkillTools();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the file tools", () => {
  const stub = (files: Record<string, unknown>) =>
    vi.stubGlobal("window", {
      electronAPI: {
        files: Object.fromEntries(
          Object.entries(files).map(([name, value]) => [name, async () => value]),
        ),
      },
    });

  it("read a file", async () => {
    stub({ read: { success: true, path: "C:\\projects\\thing\\notes.md", text: "hi" } });
    const { context, lifecycle } = harness();

    await runTool("read_file", { path: "notes.md" }, context, EVERYTHING);

    expect(lifecycle().began).toMatch(/^readingFile /);
    expect(lifecycle().ended).toMatch(/^readFile /);
  });

  it("list a folder", async () => {
    stub({ list: { success: true, path: "C:\\projects\\thing", entries: [] } });
    const { context, lifecycle } = harness();

    await runTool("list_directory", { path: "." }, context, EVERYTHING);

    expect(lifecycle().began).toMatch(/^listingFolder /);
    expect(lifecycle().ended).toMatch(/^listedFolder /);
  });

  it("move a file", async () => {
    stub({ move: { success: true, path: "C:\\projects\\thing\\docs\\a.md", checkpointId: 1 } });
    const { context, lifecycle } = harness();

    await runTool("move_file", { from: "a.md", to: "docs/a.md" }, context, EVERYTHING);

    expect(lifecycle().began).toMatch(/^movingFile /);
    expect(lifecycle().ended).toMatch(/^movedFile /);
  });

  it("delete a file", async () => {
    stub({ remove: { success: true, path: "C:\\projects\\thing\\a.md", checkpointId: 2 } });
    const { context, lifecycle } = harness();

    await runTool("delete_file", { path: "a.md" }, context, EVERYTHING);

    expect(lifecycle().began).toMatch(/^deletingFile /);
    expect(lifecycle().ended).toMatch(/^deletedFile /);
  });

  it("keep their wording when they fail, and are marked as failed instead", async () => {
    stub({ read: { success: false, error: "No such file." } });
    const { context, steps, lifecycle } = harness();

    await runTool("read_file", { path: "gone.md" }, context, EVERYTHING);

    expect(lifecycle().ended).toMatch(/^readingFile /);
    expect(steps[0].type).toBe("error");
  });
});

describe("the web and browser tools", () => {
  it("search the web", async () => {
    vi.stubGlobal("window", {
      electronAPI: {
        searchWebDetailed: async () => ({
          results: [{ title: "A", url: "https://a.example", snippet: "a" }],
          status: "ok",
          tried: ["duckduckgo"],
        }),
      },
    });
    const { context, lifecycle } = harness();

    await runTool("search_web", { query: "draggy" }, context, EVERYTHING);

    expect(lifecycle().began).toMatch(/^searchingFor /);
    expect(lifecycle().ended).toMatch(/^searchedFor /);
  });

  it("open a page", async () => {
    vi.stubGlobal("window", {
      electronAPI: {
        readUrl: async () => ({ title: "A", text: "line one\nline two" }),
      },
    });
    const { context, lifecycle } = harness();

    await runTool("read_url", { url: "https://a.example" }, context, EVERYTHING);

    expect(lifecycle().began).toMatch(/^openingPage /);
    expect(lifecycle().ended).toMatch(/^openedPage /);
  });

  it("navigate", async () => {
    vi.stubGlobal("window", {
      electronAPI: {
        browserNavigate: async () => ({ success: true, title: "A", url: "https://a.example" }),
      },
    });
    const { context, steps, lifecycle } = harness();

    await runTool("browser_navigate", { url: "https://a.example" }, context, EVERYTHING);

    expect(lifecycle().began).toMatch(/^navigatingTo /);
    expect(lifecycle().ended).toMatch(/^navigatedTo /);
    expect(steps[1].content).toMatch(/^loadedPage /);
  });

  it("mark a navigation that failed as failed rather than done", async () => {
    vi.stubGlobal("window", {
      electronAPI: { browserNavigate: async () => ({ success: false, error: "Nope" }) },
    });
    const { context, steps } = harness();

    await runTool("browser_navigate", { url: "https://a.example" }, context, EVERYTHING);

    expect(steps[0].type).toBe("error");
    expect(steps[0].isComplete).toBe(true);
  });

  it("type into a page", async () => {
    vi.stubGlobal("window", {
      electronAPI: { browserType: async () => ({ success: true }) },
    });
    const { context, lifecycle } = harness();

    await runTool("browser_type", { index: 3, text: "hello" }, context, EVERYTHING);

    expect(lifecycle().began).toMatch(/^typingInto /);
    expect(lifecycle().ended).toMatch(/^typedInto /);
  });

  it("read a page", async () => {
    vi.stubGlobal("window", {
      electronAPI: {
        browserGetText: async () => ({ success: true, title: "A", url: "https://a.example", text: "hi" }),
      },
    });
    const { context, lifecycle } = harness();

    await runTool("browser_get_text", {}, context, EVERYTHING);

    expect(lifecycle().began).toBe("readingPage");
    expect(lifecycle().ended).toMatch(/^readPage /);
  });
});

describe("skills and extensions", () => {
  it("use a skill", async () => {
    vi.stubGlobal("window", {
      electronAPI: {
        skills: {
          read: async () => ({
            success: true,
            skill: { id: "tidy", name: "tidy", description: "d", body: "b", path: "p", source: "user" },
          }),
        },
      },
    });
    const { context, lifecycle } = harness();

    await runTool("use_skill", { id: "tidy" }, context, EVERYTHING);

    expect(lifecycle().began).toMatch(/^usingSkill /);
    expect(lifecycle().ended).toMatch(/^usedSkill /);
  });

  it("call a server's tool", async () => {
    const { context, lifecycle } = harness();
    const spec = describeMcpTool(
      "github",
      {
        name: "list_issues",
        qualifiedName: "github__list_issues",
        description: "List issues.",
        inputSchema: { type: "object", properties: {} },
      },
      async () => ({ success: true, text: "none" }),
    );

    await spec.run({}, context);

    expect(lifecycle().began).toMatch(/^callingTool /);
    expect(lifecycle().ended).toMatch(/^calledTool /);
    expect(lifecycle().complete).toBe(true);
  });
});
