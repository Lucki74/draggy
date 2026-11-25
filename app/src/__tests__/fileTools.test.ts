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

/** File tools as the model meets them: calls carry the workspace, refusals come back readable, and
 * every change is offered back with an undo. */

const WITH_FOLDER: ToolEnvironment = {
  webMode: "on",
  codeExecution: false,
  libraryReady: false,
  hasFolder: true,
  projectRoot: "C:\\projects\\thing",
};

const WITHOUT_FOLDER: ToolEnvironment = {
  webMode: "on",
  codeExecution: false,
  libraryReady: false,
};

const IN_CHAT_FOLDER: ToolEnvironment = { ...WITHOUT_FOLDER, chatFolder: true };

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
    findStep: (predicate) => steps.find(predicate),
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
    draggy: {
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
      "edit_file",
      "read_file",
      "write_file",
    ]);
  });
});

describe("what each tool says it does", () => {
  it("marks the ones that only look", () => {
    for (const name of ["read_file"]) {
      expect(annotationsFor(name).readOnly, name).toBe(true);
    }
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
    // One call is one row, never a read row and a failure row.
    expect(steps).toHaveLength(1);
  });
});

describe("a chat folder", () => {
  it("offers the file tools but not the git tools", () => {
    expect(availableTools(IN_CHAT_FOLDER).map((tool) => tool.name).sort()).toEqual(["edit_file", "read_file", "write_file"]);
  });

  it("names the folder after the chat, not the workspace", async () => {
    const calls = stubFiles({ edit: { success: true, path: "p", checkpointId: 3, replaced: 1 } });

    const { context } = harness();
    context.environment = IN_CHAT_FOLDER;
    await runTool("edit_file", { path: "notes.md", find: "a", replace: "b" }, context, IN_CHAT_FOLDER);

    expect(calls[0].args[0]).toBe("chat:chat-1");
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

  // A project write is one compact row with its diff, never a preview card.
  it("writes a new project file as one created row with its diff", async () => {
    stubFiles({
      write: { success: true, path: "p", checkpointId: 9, created: true, before: "", after: "a\nb" },
    });

    const { context, steps } = harness();
    await runTool("write_file", { path: "new.ts", content: "a\nb" }, context, WITH_FOLDER);

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ type: "edit_file", isComplete: true, change: "created", before: "", after: "a\nb" });
    expect(steps[0].content).toContain("createdFile");
  });

  it("survives a build with no file bridge at all", async () => {
    vi.stubGlobal("window", { draggy: {} });

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
