import { registerTools } from "./registry";
import { registerTaskTools } from "./tasks";
import type { ToolSpec } from "./registry";
import { SHELL_IDS } from "../terminal/shells";
import { appendAgentBlock, finishAgentBlock, startAgentBlock } from "../terminal/terminalBus";

/** Commands in the project folder, the way a developer uses a terminal: git, gh, package managers,
 * tests and builds. Every call goes through the permission engine as a command. */

const MAX_TIMEOUT_SECONDS = 600;
/** How much of a running command's output the step holds before it ends. */
const LIVE_OUTPUT_CHARS = 20000;

const runCommand: ToolSpec = {
  name: "run_command",
  group: "shell",
  description:
    "Run a command in the project folder, the way a developer types it in a terminal: git, gh, npm, pnpm, cargo, python, tests, builds and linters. Returns what it printed and its exit code. The folder and environment variables it ends with carry over to the next command. A command that outlasts its time limit keeps running as a background task instead of being stopped. Pass flags that avoid prompts.",
  parameters: {
    command: { type: "string", description: "The command line to run, as it would be typed." },
    shell: {
      type: "string",
      description:
        'Optional. One of "pwsh", "powershell", "cmd", "bash" or "sh". Leave it out to use this computer\'s default shell.',
    },
    timeout_seconds: {
      type: "integer",
      description:
        "Optional. How long it may run before it moves to the background, up to 600. Defaults to 120.",
    },
    background: {
      type: "boolean",
      description:
        "Optional. Set true for something that keeps running, like a dev server or a watcher, or that takes long: it starts at once and you read it with task_output.",
    },
  },
  required: ["command"],
  usage: '{"command": "npm test"} → runs the tests in the project and returns what they printed',
  annotations: {
    executes: true,
    readOnly: false,
    readOnlyHint: false,
    destructive: true,
    destructiveHint: true,
    idempotent: false,
    idempotentHint: false,
    openWorld: true,
    openWorldHint: true,
  },
  available: (environment) =>
    Boolean(environment.hasFolder && environment.canRunCommands) && !environment.readOnlyTools,
  run: async (args, ctx) => {
    const command = String(args.command).trim();
    const shell = (SHELL_IDS as readonly string[]).includes(String(args.shell)) ? String(args.shell) : undefined;
    const seconds = Math.min(Math.max(Number(args.timeout_seconds) || 120, 1), MAX_TIMEOUT_SECONDS);
    const background = args.background === true;
    const stepId = ctx.newId();
    const api = window.electronAPI?.commands;

    ctx.pushStep({
      id: stepId,
      type: "command",
      content: `${ctx.t("runningCommand")} \`${command}\``,
      isComplete: false,
      fileContent: command,
      language: shell,
      runId: `${ctx.chatId ?? "turn"}-${stepId}`,
    });

    if (!api || !ctx.workspaceId) {
      ctx.patchStep(stepId, { isComplete: true, type: "error" });
      ctx.syncSteps();
      return "TOOL RESULT (run_command): Commands cannot run here.";
    }

    // Stopping the turn stops the command, and whatever it started.
    const runId = `${ctx.chatId ?? "turn"}-${stepId}`;
    const stop = () => void api.cancel(runId);
    ctx.signal.addEventListener("abort", stop, { once: true });
    startAgentBlock({ id: runId, command, shell });

    // The pane shows output as it arrives; the step keeps the whole of it when the command ends.
    let live = "";
    const unsubscribe = api.onOutput?.((event) => {
      if (event.runId !== runId) return;
      live = (live + event.chunk).slice(-LIVE_OUTPUT_CHARS);
      appendAgentBlock(runId, event.chunk);
      ctx.patchStep(stepId, { stdout: live });
    });

    const result = await api
      .run(ctx.workspaceId, runId, command, {
        shell,
        defaultShell: ctx.settings.defaultShell === "auto" ? undefined : ctx.settings.defaultShell,
        timeoutMs: seconds * 1000,
        chatId: ctx.chatId,
        background,
      })
      .finally(() => {
        ctx.signal.removeEventListener("abort", stop);
        unsubscribe?.();
      });

    if (result.error && result.exitCode === undefined) {
      finishAgentBlock(runId, { status: "failed" });
      ctx.patchStep(stepId, {
        isComplete: true,
        type: "error",
        content: `${ctx.t("commandFailed")} \`${command}\`: ${result.error}`,
      });
      ctx.syncSteps();
      return `TOOL RESULT (run_command): Could not run the command. ${result.error}`;
    }

    if (result.background || result.detached) {
      const taskId = result.taskId ?? "";
      finishAgentBlock(runId, { status: "stopped", shell: result.shell ?? shell });
      ctx.patchStep(stepId, {
        isComplete: true,
        content: `${ctx.t("commandBackground")} \`${command}\``,
        stdout: result.output ?? "",
        language: result.shell ?? shell,
        taskId,
      });
      ctx.syncSteps();
      const first = result.detached
        ? `The command is still running: it passed its ${seconds} second limit or the user sent it away. It keeps running as background task ${taskId}.`
        : `Started in the background as task ${taskId}.`;
      const seen = result.output ? `\n\nOutput so far:\n${result.output}` : "";
      return `TOOL RESULT (run_command): ${first} Read it with task_output, wait for it with task_wait, end it with task_stop. You are told when it ends.${seen}`;
    }

    const output = result.output ?? "";
    const verb = result.cancelled
      ? ctx.t("commandStopped")
      : result.timedOut
        ? ctx.t("commandTimedOut")
        : result.success
          ? ctx.t("ranCommand")
          : ctx.t("commandFailed");

    finishAgentBlock(runId, {
      status: result.cancelled || result.timedOut ? "stopped" : result.success ? "done" : "failed",
      exitCode: result.exitCode ?? null,
      shell: result.shell ?? shell,
    });
    ctx.patchStep(stepId, {
      isComplete: true,
      content: `${verb} \`${command}\`${result.success || result.cancelled ? "" : ` (exit ${result.exitCode ?? "?"})`}`,
      stdout: output,
      language: result.shell ?? shell,
    });
    ctx.syncSteps();

    if (result.cancelled) return "TOOL RESULT (run_command): The user stopped the command.";

    const status = result.timedOut
      ? `The command was still running after ${seconds} seconds and was stopped.`
      : `Exit code ${result.exitCode}.`;
    const outside = result.outside
      ? `\nIt ended in ${result.outside}, outside the project, so the next command starts in the project folder.`
      : "";

    return `TOOL RESULT (run_command): ${status}${result.truncated ? " The middle of the output was cut." : ""}${outside}\n\n${output || "(no output)"}`;
  },
};

export function registerCommandTools(): void {
  registerTools([runCommand]);
  registerTaskTools();
}
