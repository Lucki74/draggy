import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCommandTools } from "../tools/commands";
import { availableTools, resetRegistry, runTool } from "../tools/registry";
import type { ToolContext, ToolEnvironment } from "../tools/registry";
import type { CommandResult, SearchStep } from "../types";

/** The command tool: Code only, in the conversation's own project, reported as it went, and stopped
 * with the turn. */

const CODE: ToolEnvironment = {
  webMode: "on",
  codeExecution: true,
  libraryReady: false,
  hasFolder: true,
  canRunCommands: true,
  projectRoot: "C:\\projects\\thing",
};

function harness(signal = new AbortController().signal) {
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
    signal,
    memo: new Map<string, unknown>(),
  };
  return { context, steps };
}

function stubCommands(answer: (command: string, emit: (runId: string, chunk: string) => void) => Promise<CommandResult>) {
  const listeners = new Set<(event: { runId: string; chunk: string }) => void>();
  const emit = (runId: string, chunk: string) => listeners.forEach((listener) => listener({ runId, chunk }));
  const calls: { workspaceId: string; runId: string; command: string; options: unknown }[] = [];
  const cancel = vi.fn(async () => ({ success: true }));

  vi.stubGlobal("window", {
    electronAPI: {
      commands: {
        run: async (workspaceId: string, runId: string, command: string, options: unknown) => {
          calls.push({ workspaceId, runId, command, options });
          return answer(command, emit);
        },
        cancel,
        onOutput: (callback: (event: { runId: string; chunk: string }) => void) => {
          listeners.add(callback);
          return () => void listeners.delete(callback);
        },
      },
    },
  });

  return { calls, cancel };
}

beforeEach(() => {
  resetRegistry();
  registerCommandTools();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("where the command tool is offered", () => {
  const names = (environment: ToolEnvironment) => availableTools(environment).map((tool) => tool.name);

  it("is there in a project that can run commands", () => {
    expect(names(CODE)).toContain("run_command");
  });

  it("is not there in a chat, or for a read-only exploration", () => {
    expect(names({ ...CODE, hasFolder: false, canRunCommands: false })).not.toContain("run_command");
    expect(names({ ...CODE, readOnlyTools: true })).not.toContain("run_command");
  });
});

describe("running one", () => {
  it("runs in the conversation's workspace and hands the model the output", async () => {
    const { calls } = stubCommands(async () => ({
      success: true,
      exitCode: 0,
      output: "12 passed",
      shell: "pwsh",
    }));
    const { context, steps } = harness();

    const result = await runTool("run_command", { command: "npm test", timeout_seconds: 30 }, context, CODE);

    expect(calls[0]).toMatchObject({
      workspaceId: "project-7",
      command: "npm test",
      options: { timeoutMs: 30_000 },
    });
    expect(result).toContain("Exit code 0.");
    expect(result).toContain("12 passed");
    expect(steps[0]).toMatchObject({ type: "command", isComplete: true, stdout: "12 passed" });
    expect(steps[0].content).toBe("ranCommand `npm test`");
  });

  it("shows output on the step while the command runs, then lets go of the stream", async () => {
    let during = "";
    const { context, steps } = harness();
    const { calls } = stubCommands(async (_command, emit) => {
      emit(`${context.chatId}-step-0`, "building...");
      emit("another-run", "not ours");
      during = String(steps[0].stdout);
      return { success: true, exitCode: 0, output: "done" };
    });

    await runTool("run_command", { command: "npm run build" }, context, CODE);

    expect(calls).toHaveLength(1);
    expect(during).toBe("building...");
    expect(steps[0].stdout).toBe("done");
  });

  it("says a failed command failed, with its exit code", async () => {
    stubCommands(async () => ({ success: false, exitCode: 1, output: "1 failed" }));
    const { context, steps } = harness();

    const result = await runTool("run_command", { command: "npm test" }, context, CODE);

    expect(result).toContain("Exit code 1.");
    expect(steps[0].content).toBe("commandFailed `npm test` (exit 1)");
  });

  it("stops the command when the turn is stopped", async () => {
    const controller = new AbortController();
    let finish: (result: CommandResult) => void = () => {};
    const { cancel, calls } = stubCommands(
      () => new Promise<CommandResult>((resolve) => (finish = resolve)),
    );
    const { context } = harness(controller.signal);

    const running = runTool("run_command", { command: "npm run dev" }, context, CODE);
    await Promise.resolve();

    controller.abort();
    expect(cancel).toHaveBeenCalledWith(calls[0].runId);

    finish({ success: false, cancelled: true, exitCode: null, output: "" });
    expect(await running).toContain("stopped the command");
  });

  it("reports a command that could not start", async () => {
    stubCommands(async () => ({ success: false, error: "bash is not installed on this computer." }));
    const { context, steps } = harness();

    const result = await runTool("run_command", { command: "ls", shell: "bash" }, context, CODE);

    expect(result).toContain("bash is not installed");
    expect(steps[0].type).toBe("error");
  });
});
