import { registerTools } from "./registry";
import { registerTaskTools } from "./tasks";
import type { ToolSpec } from "./registry";
import { SHELL_IDS } from "../terminal/shells";
import { markForeground, unmarkForeground } from "../tasks/taskStore";
import { appendAgentBlock, finishAgentBlock, startAgentBlock } from "../terminal/terminalBus";

/** Commands in the project folder, the way a developer uses a terminal: git, gh, package managers,
 * tests and builds. Every call goes through the permission engine as a command. */

const MAX_TIMEOUT_SECONDS = 600;
/** How much of a running command's output the step holds before it ends. */
const LIVE_OUTPUT_CHARS = 20000;

const OUTSIDE_NOTE =
  " Use this only when the command failed inside the sandbox for lack of access, or needs the network, a folder outside the project or the rest of the computer. The user is asked first.";

const runCommand: ToolSpec = {
  name: "run_command",
  group: "shell",
  description:
    "Run a command in a sandbox that can reach the project folder and nothing else on this computer, the way a developer types it in a terminal: git, gh, npm, pnpm, cargo, python, tests, builds and linters. Returns what it printed and its exit code. The folder and environment variables it ends with carry over to the next command. A command that outlasts its time limit keeps running as a background task instead of being stopped. Pass flags that avoid prompts. In a chat with no project the sandbox has no network, so pip and npm installs fail there: write code that needs only the standard library, or ask with request_outside_sandbox for the install.",
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
    Boolean((environment.hasFolder && environment.canRunCommands) || environment.chatFolder) &&
    !environment.readOnlyTools,
  run: (args, ctx) => runInBox(args, ctx, false),
};

const requestOutsideSandbox: ToolSpec = {
  name: "request_outside_sandbox",
  group: "shell",
  description:
    "Ask the user to let one command run outside the sandbox, with access to the whole computer and the network." + OUTSIDE_NOTE,
  parameters: {
    command: { type: "string", description: "The command line to run, as it would be typed." },
    reason: { type: "string", description: "One line telling the user why the sandbox is not enough." },
    shell: runCommand.parameters.shell,
    timeout_seconds: runCommand.parameters.timeout_seconds,
    background: runCommand.parameters.background,
  },
  required: ["command", "reason"],
  usage: '{"command": "npm install", "reason": "needs the network"} → asks, then runs it outside the sandbox',
  annotations: { ...runCommand.annotations, outsideSandbox: true },
  available: (environment) =>
    Boolean((environment.hasFolder && environment.canRunCommands) || environment.chatFolder) &&
    !environment.readOnlyTools,
  run: (args, ctx) => runInBox(args, ctx, true),
};

const runAsAdmin: ToolSpec = {
  name: "run_as_admin",
  group: "shell",
  description:
    "Run one command as administrator, for something that needs it, like installing a service or editing a protected setting. Windows shows its own prompt and the user can decline. Use run_command for everything else.",
  parameters: {
    command: { type: "string", description: "The command line to run, as it would be typed in cmd." },
    reason: { type: "string", description: "One line telling the user why administrator rights are needed." },
    timeout_seconds: runCommand.parameters.timeout_seconds,
  },
  required: ["command", "reason"],
  usage: '{"command": "sc query spooler", "reason": "reads a protected service"} → Windows asks, then it runs as administrator',
  annotations: { ...runCommand.annotations, outsideSandbox: true },
  available: (environment) =>
    Boolean(environment.hasFolder && environment.canRunCommands && environment.canElevate) && !environment.readOnlyTools,
  run: (args, ctx) => runInBox({ ...args, background: false }, ctx, true, true),
};

async function runInBox(
  args: Record<string, unknown>,
  ctx: Parameters<ToolSpec["run"]>[1],
  outside: boolean,
  elevated = false,
): Promise<string> {
  {
    const command = String(args.command).trim();
    const shell = (SHELL_IDS as readonly string[]).includes(String(args.shell)) ? String(args.shell) : undefined;
    const seconds = Math.min(Math.max(Number(args.timeout_seconds) || 120, 1), MAX_TIMEOUT_SECONDS);
    const background = args.background === true;
    const stepId = ctx.newId();
    const api = window.draggy?.commands;

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
    markForeground(runId);

    // The pane shows output as it arrives; the step keeps the whole of it when the command ends.
    let live = "";
    let redraw: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = api.onOutput?.((event) => {
      if (event.runId !== runId) return;
      live = (live + event.chunk).slice(-LIVE_OUTPUT_CHARS);
      appendAgentBlock(runId, event.chunk);
      ctx.patchStep(stepId, { stdout: live });
      // The transcript redraws a few times a second, not on every chunk.
      redraw ??= setTimeout(() => {
        redraw = undefined;
        ctx.syncSteps();
      }, 150);
    });

    const result = await api
      .run(ctx.workspaceId, runId, command, {
        shell,
        timeoutMs: seconds * 1000,
        chatId: ctx.chatId,
        background,
        ...sandboxOptions(ctx.permissionMode, outside),
        ...(elevated ? { elevated: true } : {}),
        chatFolder: Boolean(ctx.environment?.chatFolder),
      })
      .finally(() => {
        ctx.signal.removeEventListener("abort", stop);
        unmarkForeground(runId);
        unsubscribe?.();
        clearTimeout(redraw);
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
      ...(result.success || result.cancelled ? {} : { failed: true }),
      stdout: output,
      language: result.shell ?? shell,
    });
    ctx.syncSteps();

    if (result.cancelled) return "TOOL RESULT (run_command): The user stopped the command.";

    const status = result.timedOut
      ? `The command was still running after ${seconds} seconds and was stopped.`
      : `Exit code ${result.exitCode}.`;
    const outsideNote = result.outside
      ? `\nIt ended in ${result.outside}, outside the project, so the next command starts in the project folder.`
      : "";
    const shellNote = result.notice ? `
${result.notice}` : "";

    return `TOOL RESULT (run_command): ${status}${result.truncated ? " The middle of the output was cut." : ""}${shellNote}${outsideNote}\n\n${output || "(no output)"}`;
  }
}

/** Ask first and Accept edits mount the project read only with no network; Turbo writes and has
 * the network; YOLO and an approved request run outside the sandbox. */
function sandboxOptions(mode: string | undefined, outside: boolean) {
  if (outside || mode === "auto") return { outsideSandbox: true as const };
  const open = mode === "turbo";
  return { sandbox: true as const, writable: open, network: open };
}

export function registerCommandTools(): void {
  registerTools([runCommand, requestOutsideSandbox, runAsAdmin]);
  registerTaskTools();
}
