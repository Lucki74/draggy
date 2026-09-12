import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerFileTools } from "../tools/files";
import {
  annotationsFor,
  availableTools,
  resetRegistry,
  runTool,
} from "../tools/registry";
import type { ToolContext, ToolEnvironment } from "../tools/registry";
import type { SearchStep } from "../types";

/**
 * The file tools as the model meets them. What is allowed lives in the main
 * process; what these check is that a call carries the workspace with it, that
 * a refusal comes back as something a model can read, and that every change is
 * offered back to the user with a way to undo it.
 */

const WITH_FOLDER: ToolEnvironment = {
  webMode: "auto",
  codeExecution: false,
  libraryReady: false,
  hasFolder: true,
  projectRoot: "C:\\projects\\thing",
};

const WITHOUT_FOLDER: ToolEnvironment = {
  webMode: "auto",
  codeExecution: false,
  libraryReady: false,
};

function harness() {
  const steps: SearchStep[] = [];

  const context: ToolContext = {
    t: (key) => key,
    settings: {} as never,
    workspaceId: "project-7",
    chatId: "chat-1",
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

type Call = { method: string; args: unknown[] };

function stubFiles(responses: Record<string, unknown>) {
  const calls: Call[] = [];

  const record =
    (method: string) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return responses[method];
    };

  vi.stubGlobal("window", {
    electronAPI: {
      files: {
        list: record("list"),
        read: record("read"),
        write: record("write"),
        edit: record("edit"),
        move: record("move"),
        remove: record("remove"),
        search: record("search"),
        checkpoints: record("checkpoints"),
        revert: record("revert"),
      },
    },
  });

  return calls;
}

beforeEach(() => {
  resetRegistry();
  registerFileTools();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("when a conversation has no folder", () => {
  it("offers no file tools at all", () => {
    const names = availableTools(WITHOUT_FOLDER).map((tool) => tool.name);

    expect(names).toEqual([]);
  });

  it("offers all of them once there is one", () => {
    const names = availableTools(WITH_FOLDER).map((tool) => tool.name).sort();

    expect(names).toEqual([
      "delete_file",
      "edit_file",
      "list_directory",
      "move_file",
      "read_file",
      "search_files",
      "write_file",
    ]);
  });
});

describe("what each tool says it does", () => {
  it("marks the ones that only look", () => {
    for (const name of ["read_file", "list_directory", "search_files"]) {
      expect(annotationsFor(name).readOnly, name).toBe(true);
    }
  });

  it("marks the ones that can lose something", () => {
    expect(annotationsFor("delete_file").destructive).toBe(true);
    expect(annotationsFor("move_file").destructive).toBe(true);
  });

  it("leaves an edit as neither, since every one is checkpointed", () => {
    expect(annotationsFor("edit_file").readOnly).toBeFalsy();
    expect(annotationsFor("edit_file").destructive).toBeFalsy();
  });
});

describe("reading", () => {
  it("asks about the workspace the conversation is in", async () => {
    const calls = stubFiles({
      read: { success: true, path: "C:\\projects\\thing\\notes.md", text: "hello" },
    });

    const { context } = harness();
    const result = await runTool(
      "read_file",
      { path: "notes.md" },
      context,
      WITH_FOLDER,
    );

    expect(calls[0]).toEqual({ method: "read", args: ["project-7", "notes.md"] });
    expect(result).toContain("hello");
  });

  it("hands a refusal back as a tool result the model can read", async () => {
    stubFiles({
      read: {
        success: false,
        error: "That path is outside the folder this conversation can reach.",
      },
    });

    const { context, steps } = harness();
    const result = await runTool(
      "read_file",
      { path: "../../secrets.txt" },
      context,
      WITH_FOLDER,
    );

    expect(result).toMatch(/outside the folder/);
    expect(steps[0].type).toBe("error");
  });
});

describe("listing and searching", () => {
  it("shows folders apart from files", async () => {
    stubFiles({
      list: {
        success: true,
        path: "C:\\projects\\thing",
        entries: [
          { name: "src", path: "x", isDirectory: true, size: 0, modified: 0 },
          { name: "notes.md", path: "y", isDirectory: false, size: 12, modified: 0 },
        ],
      },
    });

    const { context } = harness();
    const result = await runTool("list_directory", {}, context, WITH_FOLDER);

    expect(result).toContain("src/");
    expect(result).toContain("notes.md (12 bytes)");
  });

  it("gives a line number with every text match", async () => {
    stubFiles({
      search: {
        success: true,
        hits: [
          {
            path: "C:\\projects\\thing\\src\\App.tsx",
            name: "App.tsx",
            line: 42,
            text: "const answer = 1;",
          },
        ],
      },
    });

    const { context } = harness();
    const result = await runTool(
      "search_files",
      { text: "answer" },
      context,
      WITH_FOLDER,
    );

    expect(result).toContain("App.tsx:42: const answer = 1;");
  });

  it("says plainly when nothing matched", async () => {
    stubFiles({ search: { success: true, hits: [] } });

    const { context } = harness();
    const result = await runTool(
      "search_files",
      { text: "nothing" },
      context,
      WITH_FOLDER,
    );

    expect(result).toMatch(/Nothing matched/);
  });
});

describe("editing", () => {
  it("expects the text once unless told otherwise", async () => {
    const calls = stubFiles({
      edit: { success: true, path: "p", checkpointId: 3, replaced: 1 },
    });

    const { context } = harness();
    await runTool(
      "edit_file",
      { path: "src/App.tsx", find: "a", replace: "b" },
      context,
      WITH_FOLDER,
    );

    expect(calls[0].args).toEqual([
      "project-7",
      "src/App.tsx",
      "a",
      "b",
      1,
      "chat-1",
    ]);
  });

  it("passes on a count the model asked for", async () => {
    const calls = stubFiles({ edit: { success: true, path: "p", checkpointId: 4 } });

    const { context } = harness();
    await runTool(
      "edit_file",
      { path: "x", find: "a", replace: "b", expected: 3 },
      context,
      WITH_FOLDER,
    );

    expect(calls[0].args[4]).toBe(3);
  });

  it("leaves the timeline something to undo", async () => {
    stubFiles({
      edit: {
        success: true,
        path: "C:\\projects\\thing\\src\\App.tsx",
        checkpointId: 7,
        replaced: 1,
        before: "old",
        after: "new",
      },
    });

    const { context, steps } = harness();
    await runTool(
      "edit_file",
      { path: "src/App.tsx", find: "old", replace: "new" },
      context,
      WITH_FOLDER,
    );

    expect(steps[0].type).toBe("edit_file");
    expect(steps[0].checkpointId).toBe(7);
    expect(steps[0].before).toBe("old");
    expect(steps[0].after).toBe("new");
    expect(steps[0].isComplete).toBe(true);
  });

  it("tells the model what to do about text it could not find", async () => {
    stubFiles({
      edit: {
        success: false,
        error:
          "That text is not in the file. Read it again and copy the lines exactly, whitespace included.",
      },
    });

    const { context } = harness();
    const result = await runTool(
      "edit_file",
      { path: "x", find: "a", replace: "b" },
      context,
      WITH_FOLDER,
    );

    expect(result).toMatch(/copy the lines exactly/);
  });
});

describe("writing, moving and deleting", () => {
  it("writes the whole file and keeps the checkpoint", async () => {
    const calls = stubFiles({
      write: { success: true, path: "p", checkpointId: 9, created: true },
    });

    const { context, steps } = harness();
    const result = await runTool(
      "write_file",
      { path: "new.ts", content: "export const x = 1;" },
      context,
      WITH_FOLDER,
    );

    expect(calls[0].args).toEqual([
      "project-7",
      "new.ts",
      "export const x = 1;",
      "chat-1",
    ]);
    expect(steps[0].checkpointId).toBe(9);
    expect(result).toMatch(/Created/);
  });

  it("moves a file and says where it went", async () => {
    stubFiles({ move: { success: true, path: "docs/notes.md", checkpointId: 2 } });

    const { context } = harness();
    const result = await runTool(
      "move_file",
      { from: "notes.md", to: "docs/notes.md" },
      context,
      WITH_FOLDER,
    );

    expect(result).toContain("docs/notes.md");
  });

  it("says a deletion went to the bin, and to mention it", async () => {
    stubFiles({ remove: { success: true, path: "old.md", checkpointId: 5 } });

    const { context } = harness();
    const result = await runTool(
      "delete_file",
      { path: "old.md" },
      context,
      WITH_FOLDER,
    );

    expect(result).toMatch(/recycle bin/);
    expect(result).toMatch(/Tell the user/);
  });

  it("survives a build with no file bridge at all", async () => {
    vi.stubGlobal("window", { electronAPI: {} });

    const { context } = harness();
    const result = await runTool(
      "read_file",
      { path: "notes.md" },
      context,
      WITH_FOLDER,
    );

    expect(result).toMatch(/not available/);
  });
});
