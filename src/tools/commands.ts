import { registerTools } from "./registry";
import type { ToolSpec } from "./registry";

/** Commands in the project folder, the way a developer uses a terminal: git, gh, package managers,
 * tests and builds. Every call goes through the permission engine as a command. */

const SHELLS = ["pwsh", "powershell", "cmd", "bash", "sh"];
const MAX_TIMEOUT_SECONDS = 600;

const runCommand: ToolSpec = {
  name: "run_command",
  group: "shell",
  description:
    "Run a command in the project folder, the way a developer types it in a terminal: git, gh, npm, pnpm, cargo, python, tests, builds and linters. Returns what it printed and its exit code. Nothing can be typed into it while it runs, so pass flags that avoid prompts.",
  parameters: {
    command: { type: "string", description: "The command line to run, as it would be typed." },
    shell: {
      type: "string",
      description:
        'Optional. One of "pwsh", "powershell", "cmd", "bash" or "sh". Leave it out to use this computer\'s default shell.',
    },
    timeout_seconds: {
      type: "integer",
      description: "Optional. How long it may run before it is stopped, up to 600. Defaults to 120.",
    },
  },
  required: ["command"],
  usage: '{"command": "npm test"} → runs the tests in the project and returns what they printed',
  annotations: { executes: true, openWorld: true },
  available: (environment) =>
    Boolean(environment.hasFolder && environment.canRunCommands) && !environment.readOnlyTools,
  run: async (args, ctx) => {
    const command = String(args.command).trim();
    const shell = SHELLS.includes(String(args.shell)) ? String(args.shell) : undefined;
    const seconds = Math.min(Math.max(Number(args.timeout_seconds) || 120, 1), MAX_TIMEOUT_SECONDS);
    const stepId = ctx.newId();
    const api = window.electronAPI?.commands;

    ctx.pushStep({
      id: stepId,
      type: "command",
      content: `${ctx.t("runningCommand")} \`${command}\``,
      isComplete: false,
      fileContent: command,
      language: shell,
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

    const result = await api
      .run(ctx.workspaceId, runId, command, { shell, timeoutMs: seconds * 1000 })
      .finally(() => ctx.signal.removeEventListener("abort", stop));

    if (result.error && result.exitCode === undefined) {
      ctx.patchStep(stepId, {
        isComplete: true,
        type: "error",
        content: `${ctx.t("commandFailed")} \`${command}\`: ${result.error}`,
      });
      ctx.syncSteps();
      return `TOOL RESULT (run_command): Could not run the command. ${result.error}`;
    }

    const output = result.output ?? "";
    const verb = result.cancelled
      ? ctx.t("commandStopped")
      : result.timedOut
        ? ctx.t("commandTimedOut")
        : result.success
          ? ctx.t("ranCommand")
          : ctx.t("commandFailed");

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

    return `TOOL RESULT (run_command): ${status}${result.truncated ? " The middle of the output was cut." : ""}\n\n${output || "(no output)"}`;
  },
};

export function registerCommandTools(): void {
  registerTools([runCommand]);
}
