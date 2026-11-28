/** Runs the configured hooks through `hooks:run` and turns each result into the loop's decision. */

import { buildHookPayload, decideFromExit, hooksFor, type HookDecision, type HookEntry, type HookEvent } from "./hooks";

/** Shown in the chat, so a skipped or failed hook is never silent. */
export type HookNotice = { kind: "untrusted" } | { kind: "error"; event: HookEvent; message: string };

export interface HookRunContext {
  /** User hooks. Config order is run order. */
  entries: HookEntry[];
  /** Project hooks, read on the first hook call of the turn so the turn starts at once. Untrusted ones are not returned. */
  loadProject?: () => Promise<{ entries: HookEntry[]; untrusted: boolean }>;
  /** Shows a notice in the chat. */
  onNotice?: (notice: HookNotice) => void;
  /** The project folder, or "" for a chat with none. */
  workspaceId: string;
  chatId: string;
  cwd: string;
  permissionMode: string;
  /** Cancelling the chat ends the running hook and skips the hooks that would follow. */
  signal?: AbortSignal;
}

export interface HookRunner {
  runHooks: (event: "PreToolUse" | "PostToolUse", toolName: string, toolInput: unknown, toolResponse?: string) => Promise<HookDecision>;
  runLifecycleHook: (event: "SessionStart" | "Stop", stopHookActive: boolean) => Promise<HookDecision>;
}

/** Same rule as the run_command tool: auto runs outside the sandbox, turbo alone gets the network. */
export function hookRunOptions(mode: string) {
  return { sandbox: mode !== "auto", outsideSandbox: mode === "auto", writable: mode === "turbo", network: mode === "turbo" };
}

let hookRunSeq = 0;

export function createHookRunner(context: HookRunContext): HookRunner {
  const runOne = async (
    entry: HookEntry,
    event: HookEvent,
    input: { toolName?: string; toolInput?: unknown; toolResponse?: unknown; stopHookActive?: boolean },
  ): Promise<HookDecision> => {
    const api = window.draggy?.hooks;
    if (!api) return { action: "continue" };
    const payload = buildHookPayload(event, {
      session_id: context.chatId,
      cwd: context.cwd,
      permission_mode: context.permissionMode,
      tool_name: input.toolName,
      tool_input: input.toolInput,
      tool_response: input.toolResponse,
      stop_hook_active: input.stopHookActive,
    });
    if (context.signal?.aborted) return { action: "continue" };
    const runId = `hook-${Date.now()}-${++hookRunSeq}`;
    const cancel = () => void api.cancel?.(runId);
    context.signal?.addEventListener("abort", cancel, { once: true });
    try {
      const result = await api.run(context.workspaceId, runId, entry.command, {
        chatId: context.chatId,
        chatFolder: !context.workspaceId,
        payload: JSON.stringify(payload),
        timeoutMs: entry.timeout * 1000,
        ...hookRunOptions(context.permissionMode),
      });
      if (result.error) return { action: "error", message: result.error };
      return decideFromExit(event, result.exitCode ?? null, result.stdout ?? "", result.stderr ?? "", result.timedOut === true);
    } catch (error) {
      return { action: "error", message: error instanceof Error ? error.message : String(error) };
    } finally {
      context.signal?.removeEventListener("abort", cancel);
    }
  };

  let allEntries: Promise<HookEntry[]> | null = null;
  const entriesNow = (): Promise<HookEntry[]> => {
    allEntries ??= (async () => {
      let project: { entries: HookEntry[]; untrusted: boolean } = { entries: [], untrusted: false };
      try {
        project = context.loadProject ? await context.loadProject() : project;
      } catch (error) {
        context.onNotice?.({ kind: "error", event: "SessionStart", message: error instanceof Error ? error.message : String(error) });
      }
      if (project.untrusted) context.onNotice?.({ kind: "untrusted" });
      return [...context.entries, ...project.entries];
    })();
    return allEntries;
  };

  /** The first deny wins; errors never block but each one is shown in the chat; SessionStart output is joined. */
  const runAll = async (
    event: HookEvent,
    toolName: string | undefined,
    input: { toolName?: string; toolInput?: unknown; toolResponse?: unknown; stopHookActive?: boolean },
  ): Promise<HookDecision> => {
    const contexts: string[] = [];
    let firstError: HookDecision | null = null;
    // A cancelled chat does not start Stop or Post hooks; a running one was already ended.
    if (context.signal?.aborted && event !== "PreToolUse" && event !== "SessionStart") return { action: "continue" };
    for (const entry of hooksFor(await entriesNow(), event, toolName)) {
      const decision = await runOne(entry, event, input);
      if (decision.action === "deny") return decision;
      if (decision.action === "error") {
        firstError ??= decision;
        context.onNotice?.({ kind: "error", event, message: decision.message });
      }
      if (decision.action === "continue" && decision.context) contexts.push(decision.context);
    }
    if (contexts.length > 0) return { action: "continue", context: contexts.join("\n") };
    return firstError ?? { action: "continue" };
  };

  return {
    runHooks: (event, toolName, toolInput, toolResponse) =>
      // A call with no readable name matches no tool, so tool hooks skip it.
      toolName === "" ? Promise.resolve({ action: "continue" }) : runAll(event, toolName, { toolName, toolInput, toolResponse }),
    runLifecycleHook: (event, stopHookActive) =>
      runAll(event, undefined, { stopHookActive }),
  };
}
