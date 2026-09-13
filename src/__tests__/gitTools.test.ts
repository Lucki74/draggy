import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeChange, describeStatus, registerGitTools } from "../tools/git";
import { annotationsFor, availableTools, resetRegistry, runTool } from "../tools/registry";
import type { ToolContext, ToolEnvironment } from "../tools/registry";
import type { GitStatus, SearchStep } from "../types";
import { changePath, classifyDiff, diffStats, shouldShowStrip } from "../project/gitView";

/**
 * Git as the model meets it: two tools that only look, offered only where
 * there is a repository to look at.
 */

const REPO: ToolEnvironment = {
  webMode: "off",
  codeExecution: false,
  libraryReady: false,
  hasFolder: true,
  hasGit: true,
  projectRoot: "C:\\projects\\thing",
};

const STATUS: GitStatus = {
  success: true,
  available: true,
  isRepo: true,
  branch: "main",
  upstream: "origin/main",
  ahead: 2,
  behind: 0,
  files: [
    { path: "src/app.ts", kind: "modified", staged: false, unstaged: true },
    { path: "src/new.ts", kind: "added", staged: true, unstaged: false },
    { path: "notes.md", kind: "untracked", staged: false, unstaged: true },
  ],
};

function harness() {
  const steps: SearchStep[] = [];

  const context: ToolContext = {
    t: (key) => key,
    settings: {} as never,
    workspaceId: "project-7",
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
  registerGitTools();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("when the tools are offered", () => {
  it("offers both in a project that is a repository", () => {
    expect(availableTools(REPO).map((tool) => tool.name).sort()).toEqual(["git_diff", "git_status"]);
  });

  it("offers neither without a repository, or without a folder", () => {
    expect(availableTools({ ...REPO, hasGit: false })).toEqual([]);
    expect(availableTools({ ...REPO, hasFolder: false })).toEqual([]);
  });

  it("marks both as only looking, so no mode ever asks about them", () => {
    expect(annotationsFor("git_status").readOnly).toBe(true);
    expect(annotationsFor("git_diff").readOnly).toBe(true);
  });

  it("stays available to a read-only exploration", () => {
    expect(availableTools({ ...REPO, readOnlyTools: true }).map((tool) => tool.name)).toHaveLength(2);
  });
});

describe("git_status", () => {
  it("asks about the conversation's workspace and describes what it found", async () => {
    const status = vi.fn(async () => STATUS);
    vi.stubGlobal("window", { electronAPI: { git: { status } } });
    const { context, steps } = harness();

    const result = await runTool("git_status", {}, context, REPO);

    expect(status).toHaveBeenCalledWith("project-7");
    expect(result).toContain("On branch main.");
    expect(result).toContain("Tracking origin/main: 2 ahead, 0 behind.");
    expect(result).toContain("M src/app.ts (modified, not staged)");
    expect(result).toContain("A src/new.ts (added, staged)");
    expect(steps[0].content).toMatch(/^gitCheckedStatus \*\*main\*\*/);
  });

  it("says plainly when the folder is not a repository", async () => {
    vi.stubGlobal("window", {
      electronAPI: { git: { status: async () => ({ success: true, available: true, isRepo: false }) } },
    });
    const { context, steps } = harness();

    const result = await runTool("git_status", {}, context, REPO);

    expect(result).toContain("not a git repository");
    expect(steps[0].type).toBe("error");
  });
});

describe("git_diff", () => {
  it("passes the path and whether to look at staged changes", async () => {
    const diff = vi.fn(async () => ({ success: true, diff: "@@ -1 +1 @@\n-a\n+b\n", files: 1, skipped: 0 }));
    vi.stubGlobal("window", { electronAPI: { git: { diff } } });
    const { context, steps } = harness();

    const result = await runTool("git_diff", { path: "src/app.ts", staged: true }, context, REPO);

    expect(diff).toHaveBeenCalledWith("project-7", "src/app.ts", true);
    expect(result).toContain("+b");
    expect(steps[0]).toMatchObject({ content: "gitReadDiff **src/app.ts**", fileContent: "@@ -1 +1 @@\n-a\n+b\n" });
  });

  it("tells the model a credentials file was left out, and not to go around it", async () => {
    vi.stubGlobal("window", {
      electronAPI: { git: { diff: async () => ({ success: true, diff: "+x\n", skipped: 1 }) } },
    });
    const { context } = harness();

    const result = await runTool("git_diff", {}, context, REPO);

    expect(result).toContain("1 changed file(s) were left out because they hold credentials");
  });

  it("says there is nothing to show when nothing changed", async () => {
    vi.stubGlobal("window", {
      electronAPI: { git: { diff: async () => ({ success: true, diff: "", skipped: 0 }) } },
    });
    const { context } = harness();

    expect(await runTool("git_diff", {}, context, REPO)).toContain("No changes.");
  });

  it("passes a refusal from the guard straight back", async () => {
    vi.stubGlobal("window", {
      electronAPI: {
        git: { diff: async () => ({ success: false, error: "That path is outside the folder this conversation can reach." }) },
      },
    });
    const { context, steps } = harness();

    const result = await runTool("git_diff", { path: "../../secrets" }, context, REPO);

    expect(result).toContain("outside the folder");
    expect(steps[0].type).toBe("error");
  });
});

describe("describing git state", () => {
  it("names a rename with where it came from", () => {
    expect(
      describeChange({ path: "docs/a.md", from: "a.md", kind: "renamed", staged: true, unstaged: true }),
    ).toBe("R a.md -> docs/a.md (renamed, staged, with more changes not staged)");
  });

  it("says a clean tree is clean", () => {
    expect(describeStatus({ ...STATUS, files: [] })).toContain("The working tree is clean.");
  });

  it("says git is missing when it is", () => {
    expect(describeStatus({ success: true, available: false, isRepo: false })).toContain("not installed");
  });
});

describe("reading a diff for display", () => {
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 111..222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,2 +1,2 @@",
    " same",
    "-old",
    "+new",
    "",
  ].join("\n");

  it("sorts every line into what it is", () => {
    expect(classifyDiff(diff).map((line) => line.kind)).toEqual([
      "meta",
      "meta",
      "meta",
      "meta",
      "hunk",
      "context",
      "remove",
      "add",
    ]);
  });

  it("counts lines in and out, not the file headers", () => {
    expect(diffStats(diff)).toEqual({ added: 1, removed: 1 });
  });

  it("hides the strip unless there is a repository to show", () => {
    expect(shouldShowStrip(null)).toBe(false);
    expect(shouldShowStrip({ success: true, available: false, isRepo: false })).toBe(false);
    expect(shouldShowStrip({ success: true, available: true, isRepo: false })).toBe(false);
    expect(shouldShowStrip(STATUS)).toBe(true);
  });

  it("joins a changed file onto the project folder in the folder's own style", () => {
    expect(changePath("C:\\projects\\thing", "src/app.ts")).toBe("C:\\projects\\thing\\src\\app.ts");
    expect(changePath("/home/me/thing/", "src/app.ts")).toBe("/home/me/thing/src/app.ts");
  });
});
