// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHookRunner, hookRunOptions } from "../agent/hookRunner";
import type { HookEntry } from "../agent/hooks";

type RunResult = { success: boolean; exitCode?: number | null; stdout?: string; stderr?: string; timedOut?: boolean; error?: string };

const entry = (event: HookEntry["event"], command: string, matcher = ""): HookEntry => ({ event, matcher, command, timeout: 30, enabled: true });

function mockRun(results: RunResult[]) {
  const run = vi.fn(async (..._args: unknown[]) => results.shift() ?? { success: true, exitCode: 0, stdout: "", stderr: "" });
  (window as unknown as { draggy: unknown }).draggy = { hooks: { run } };
  return run;
}

const notify = vi.fn();

const base = { workspaceId: "/p", chatId: "c1", cwd: "/p", permissionMode: "ask" };

afterEach(() => {
  notify.mockClear();
  delete (window as unknown as { draggy?: unknown }).draggy;
});

describe("hook runner", () => {
  it("maps run options to the permission mode", () => {
    expect(hookRunOptions("auto")).toEqual({ sandbox: false, outsideSandbox: true, writable: false, network: false });
    expect(hookRunOptions("ask")).toEqual({ sandbox: true, outsideSandbox: false, writable: false, network: false });
    expect(hookRunOptions("turbo")).toMatchObject({ network: true, writable: true });
  });

  it("denies a tool call when a hook exits 2 and skips later hooks", async () => {
    const run = mockRun([{ success: false, exitCode: 2, stderr: "no writes" }]);
    const runner = createHookRunner({ ...base, entries: [entry("PreToolUse", "a", "write_file"), entry("PreToolUse", "b")] });
    const decision = await runner.runHooks("PreToolUse", "write_file", { path: "x" });
    expect(decision).toEqual({ action: "deny", message: "no writes" });
    expect(run).toHaveBeenCalledTimes(1);
    const options = run.mock.calls[0][3] as { payload: string; timeoutMs: number; chatFolder: boolean };
    expect(JSON.parse(options.payload).hook_event_name).toBe("PreToolUse");
    expect(options.timeoutMs).toBe(30000);
    expect(options.chatFolder).toBe(false);
  });

  it("skips hooks whose matcher does not fit the tool", async () => {
    const run = mockRun([]);
    const runner = createHookRunner({ ...base, entries: [entry("PreToolUse", "a", "edit_file")] });
    expect(await runner.runHooks("PreToolUse", "write_file", {})).toEqual({ action: "continue" });
    expect(run).not.toHaveBeenCalled();
  });

  it("reports a refused run as an error that does not block", async () => {
    mockRun([{ success: false, error: "The sandbox could not start." }]);
    const runner = createHookRunner({ ...base, entries: [entry("PostToolUse", "a")] });
    expect(await runner.runHooks("PostToolUse", "read_file", {}, "out")).toEqual({
      action: "error",
      message: "The sandbox could not start.",
    });
  });

  it("joins SessionStart output as context", async () => {
    mockRun([{ success: true, exitCode: 0, stdout: "branch main" }]);
    const runner = createHookRunner({ ...base, entries: [entry("SessionStart", "a")] });
    expect(await runner.runLifecycleHook("SessionStart", false)).toEqual({ action: "continue", context: "branch main" });
  });

  it("passes stop_hook_active on a Stop repeat", async () => {
    const run = mockRun([{ success: false, exitCode: 2, stderr: "tests fail" }]);
    const runner = createHookRunner({ ...base, entries: [entry("Stop", "a")] });
    expect(await runner.runLifecycleHook("Stop", true)).toEqual({ action: "deny", message: "tests fail" });
    const payload = JSON.parse((run.mock.calls[0][3] as { payload: string }).payload);
    expect(payload.stop_hook_active).toBe(true);
  });

  it("reports a timed out hook as an error", async () => {
    mockRun([{ success: false, timedOut: true, exitCode: null }]);
    const runner = createHookRunner({ ...base, entries: [entry("Stop", "a")] });
    expect(await runner.runLifecycleHook("Stop", false)).toEqual({ action: "error", message: "hook timed out" });
  });

  it("tells the chat once when project hooks are untrusted", async () => {
    const runner = createHookRunner({
      ...base,
      entries: [],
      loadProject: async () => ({ entries: [], untrusted: true }),
      onNotice: notify,
    });
    await runner.runHooks("PreToolUse", "write_file", {});
    await runner.runHooks("PostToolUse", "write_file", {}, "ok");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({ kind: "untrusted" });
  });

  it("shows each hook error in the chat and still lets the call go on", async () => {
    mockRun([{ success: false, timedOut: true, exitCode: null }]);
    const runner = createHookRunner({ ...base, entries: [entry("PreToolUse", "a")], onNotice: notify });
    expect(await runner.runHooks("PreToolUse", "write_file", {})).toEqual({ action: "error", message: "hook timed out" });
    expect(notify).toHaveBeenCalledWith({ kind: "error", event: "PreToolUse", message: "hook timed out" });
  });

  it("runs no project hook that the loader did not return", async () => {
    const run = mockRun([]);
    const runner = createHookRunner({ ...base, entries: [], loadProject: async () => ({ entries: [], untrusted: true }) });
    expect(await runner.runHooks("PreToolUse", "write_file", {})).toEqual({ action: "continue" });
    expect(run).not.toHaveBeenCalled();
  });

  it("lets the tool run when loading project hooks throws", async () => {
    const run = mockRun([]);
    const runner = createHookRunner({
      ...base,
      entries: [],
      loadProject: async () => {
        throw new Error("bad digest");
      },
      onNotice: notify,
    });
    const decision = await runner.runHooks("PreToolUse", "write_file", { path: "x" });
    expect(decision).toEqual({ action: "continue" });
    expect(run).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith({ kind: "error", event: "SessionStart", message: "bad digest" });
  });

  it("cancels the running hook by its run id when the chat is stopped", async () => {
    let finish: (value: RunResult) => void = () => {};
    const run = vi.fn((..._args: unknown[]) => new Promise<RunResult>((resolve) => (finish = resolve)));
    const cancel = vi.fn(async () => ({ cancelled: true }));
    (window as unknown as { draggy: unknown }).draggy = { hooks: { run, cancel } };
    const controller = new AbortController();
    const runner = createHookRunner({ ...base, entries: [entry("Stop", "sleep 600")], signal: controller.signal });
    const pending = runner.runLifecycleHook("Stop", false);
    await vi.waitFor(() => expect(run).toHaveBeenCalled());
    controller.abort();
    expect(cancel).toHaveBeenCalledWith(run.mock.calls[0][1]);
    finish({ success: true, exitCode: 0 });
    expect(await pending).toEqual({ action: "continue" });
  });

  it("starts no Stop hook once the chat is stopped", async () => {
    const run = mockRun([]);
    const controller = new AbortController();
    controller.abort();
    const runner = createHookRunner({ ...base, entries: [entry("Stop", "x")], signal: controller.signal });
    expect(await runner.runLifecycleHook("Stop", false)).toEqual({ action: "continue" });
    expect(run).not.toHaveBeenCalled();
  });

  it("skips tool hooks for a call with no readable name", async () => {
    const run = mockRun([]);
    const runner = createHookRunner({ ...base, entries: [entry("PreToolUse", "x")] });
    expect(await runner.runHooks("PreToolUse", "", {})).toEqual({ action: "continue" });
    expect(run).not.toHaveBeenCalled();
  });
});
