import { registerTools } from "./registry";
import type { ToolEnvironment, ToolSpec } from "./registry";
import type { BackgroundTask, TaskInboxItem } from "../types";

/** The tools for commands that keep running in the background: read their output, wait for them, end
 * them, and type into one. A task belongs to the chat that started it. */

const MAX_WAIT_SECONDS = 120;

const available = (environment: ToolEnvironment) =>
  Boolean(environment.hasFolder && environment.canRunCommands) && !environment.readOnlyTools;

const KEYS: Record<string, string> = {
  enter: "\r",
  tab: "\t",
  esc: "\u001b",
  escape: "\u001b",
  "ctrl+c": "\u0003",
  "ctrl+d": "\u0004",
  "ctrl+z": "\u001a",
  up: "\u001b[A",
  down: "\u001b[B",
  right: "\u001b[C",
  left: "\u001b[D",
  space: " ",
  backspace: "\u007f",
};

/** What task_input would type: the text, then Enter unless told otherwise, or one named key. */
export function inputFor(args: Record<string, unknown>): string | null {
  const key = typeof args.key === "string" ? KEYS[args.key.trim().toLowerCase()] : undefined;
  const text = typeof args.text === "string" ? args.text : "";
  if (typeof args.key === "string" && key === undefined) return null;
  if (!text && key === undefined) return null;
  if (key !== undefined && !text) return key;
  return text + (args.enter === false ? "" : "\r");
}

/** An answer to a prompt that cannot do anything on its own: yes, no, or a key. The user is not asked
 * about these; any other text typed into a task is a command in all but name. */
export function isHarmlessInput(args: Record<string, unknown>): boolean {
  const text = typeof args.text === "string" ? args.text.trim().toLowerCase() : "";
  if (text) return /^(y|n|yes|no)$/.test(text) && args.enter !== false;
  return typeof args.key === "string" && args.key.trim().toLowerCase() in KEYS;
}

function seconds(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  return minutes < 60 ? `${minutes}m ${total % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function describeTask(task: BackgroundTask, now = Date.now()): string {
  const age = seconds((task.endedAt ?? now) - task.startedAt);
  const state =
    task.status === "running"
      ? `running for ${age}`
      : task.status === "stopped"
        ? `stopped after ${age}`
        : task.status === "exited"
          ? `exited with code 0 after ${age}`
          : `failed${task.exitCode !== null ? ` with code ${task.exitCode}` : ""} after ${age}`;
  return `${task.id}: ${task.command} (${task.shell}, ${state})`;
}

/** The note the model reads when background tasks ended while it was busy or the user was away. */
export function describeEnded(items: TaskInboxItem[]): string {
  const lines = items.map((item) => {
    const state =
      item.status === "stopped"
        ? "was stopped"
        : item.status === "exited"
          ? "finished with exit code 0"
          : `failed${item.exitCode !== null ? ` with exit code ${item.exitCode}` : ""}`;
    const tail = item.tail.trim();
    return `Task ${item.id} (${item.command}) ${state} after ${seconds(item.durationMs)}.${tail ? `\nLast output:\n${tail}` : ""}`;
  });
  return `[Background tasks ended]\n${lines.join("\n\n")}\nRead more with task_output if you need it.`;
}

const missing = (tool: string, message: string) => `TOOL RESULT (${tool}): ${message}`;

function api() {
  return typeof window === "undefined" ? undefined : window.electronAPI?.tasks;
}

const taskId = { type: "string" as const, description: 'The task id from run_command or task_list, like "t1".' };

const taskOutput: ToolSpec = {
  name: "task_output",
  group: "shell",
  description:
    "Read the output of a background task. By default it returns what the task printed since you last read it. Use tail for the last lines, grep for the lines that match a pattern, or since with the next value from an earlier read.",
  parameters: {
    task_id: taskId,
    tail: { type: "integer", description: "Optional. Return only the last this many lines of the whole output." },
    grep: { type: "string", description: "Optional. Return only the lines of the whole output that match this regular expression, with their line numbers." },
    since: { type: "integer", description: "Optional. Return the output after this character offset, the next value an earlier read gave." },
    max_chars: { type: "integer", description: "Optional. Return at most this many characters, the latest ones." },
  },
  required: ["task_id"],
  usage: '{"task_id": "t1", "tail": 40} → the last 40 lines the task has printed',
  annotations: { readOnly: true, readOnlyHint: true, idempotent: false, idempotentHint: false, destructive: false, destructiveHint: false, openWorld: false, openWorldHint: false },
  available,
  run: async (args, ctx) => {
    const tasks = api();
    if (!tasks || !ctx.chatId) return missing("task_output", "Tasks are not available here.");
    const result = await tasks.output(ctx.chatId, String(args.task_id ?? ""), {
      tail: args.tail === undefined ? undefined : Number(args.tail),
      grep: typeof args.grep === "string" ? args.grep : undefined,
      since: args.since === undefined ? undefined : Number(args.since),
      max_chars: args.max_chars === undefined ? undefined : Number(args.max_chars),
    });
    if (!result.success || !result.task) return missing("task_output", result.error ?? "That task could not be read.");
    return `TOOL RESULT (task_output): ${describeTask(result.task)}. Next offset ${result.next ?? 0}.${result.truncated ? " The middle was cut." : ""}\n\n${result.output || "(no new output)"}`;
  },
};

const taskList: ToolSpec = {
  name: "task_list",
  group: "shell",
  description: "List the background tasks of this chat, running or ended, with their state.",
  parameters: {},
  required: [],
  usage: "{} → every background task in this chat",
  annotations: { readOnly: true, readOnlyHint: true, idempotent: true, idempotentHint: true, destructive: false, destructiveHint: false, openWorld: false, openWorldHint: false },
  available,
  run: async (_args, ctx) => {
    const tasks = api();
    if (!tasks || !ctx.chatId) return missing("task_list", "Tasks are not available here.");
    const result = await tasks.list(ctx.chatId);
    const list = result.tasks ?? [];
    if (list.length === 0) return missing("task_list", "There are no background tasks in this chat.");
    return `TOOL RESULT (task_list): ${list.length} task${list.length === 1 ? "" : "s"}.\n\n${list.map((task) => describeTask(task)).join("\n")}`;
  },
};

const taskStop: ToolSpec = {
  name: "task_stop",
  group: "shell",
  description: "End a background task and everything it started. Use it for a server or watcher you no longer need.",
  parameters: { task_id: taskId },
  required: ["task_id"],
  usage: '{"task_id": "t1"} → stops that task',
  annotations: { sandboxed: true, destructive: false, destructiveHint: false, idempotent: true, idempotentHint: true, readOnly: false, readOnlyHint: false, openWorld: false, openWorldHint: false },
  available,
  run: async (args, ctx) => {
    const tasks = api();
    if (!tasks || !ctx.chatId) return missing("task_stop", "Tasks are not available here.");
    const id = String(args.task_id ?? "");
    const result = await tasks.stop(ctx.chatId, id);
    if (!result.success || !result.task) return missing("task_stop", result.error ?? "That task could not be stopped.");
    const stepId = ctx.newId();
    ctx.pushStep({ id: stepId, type: "command", content: `${ctx.t("stoppedTask")} \`${result.task.command}\``, isComplete: true, taskId: result.task.id });
    ctx.syncSteps();
    return missing(
      "task_stop",
      result.alreadyEnded ? `Task ${result.task.id} had already ended. ${describeTask(result.task)}` : `Task ${result.task.id} is being stopped.`,
    );
  },
};

const taskWait: ToolSpec = {
  name: "task_wait",
  group: "shell",
  description: `Wait for a background task to end, or for a pattern to show up in its new output, for up to ${MAX_WAIT_SECONDS} seconds. Use it when nothing else is left to do until the task is ready, such as a server that has to start.`,
  parameters: {
    task_id: taskId,
    seconds: { type: "integer", description: `Optional. How long to wait, up to ${MAX_WAIT_SECONDS}. Defaults to 30.` },
    until: { type: "string", description: "Optional. A regular expression; the wait ends when new output matches it." },
  },
  required: ["task_id"],
  usage: '{"task_id": "t1", "until": "ready on"} → returns once the server prints that, or after 30 seconds',
  annotations: { readOnly: true, readOnlyHint: true, idempotent: false, idempotentHint: false, destructive: false, destructiveHint: false, openWorld: false, openWorldHint: false },
  available,
  run: async (args, ctx) => {
    const tasks = api();
    if (!tasks || !ctx.chatId) return missing("task_wait", "Tasks are not available here.");

    const waitId = `${ctx.chatId}-${ctx.newId()}`;
    const stepId = ctx.newId();
    ctx.pushStep({ id: stepId, type: "command", content: `${ctx.t("waitingForTask")} ${String(args.task_id ?? "")}`, isComplete: false });
    const abort = () => void tasks.abortWait(waitId);
    ctx.signal.addEventListener("abort", abort, { once: true });
    try {
      const result = await tasks.wait(ctx.chatId, String(args.task_id ?? ""), {
        seconds: args.seconds === undefined ? undefined : Number(args.seconds),
        until: typeof args.until === "string" ? args.until : undefined,
        waitId,
      });
      if (!result.success || !result.task) return missing("task_wait", result.error ?? "That task could not be waited for.");
      const why =
        result.reason === "ended"
          ? "The task ended."
          : result.reason === "matched"
            ? "The output matched."
            : result.reason === "aborted"
              ? "The wait was cancelled."
              : "The time ran out and the task is still going.";
      return missing("task_wait", `${why} ${describeTask(result.task)}. Read the output with task_output.`);
    } finally {
      ctx.signal.removeEventListener("abort", abort);
      ctx.patchStep(stepId, { isComplete: true });
      ctx.syncSteps();
    }
  },
};

const taskInput: ToolSpec = {
  name: "task_input",
  group: "shell",
  description:
    "Type into a background task that runs on a terminal, to answer a prompt it is waiting on. Give text (sent with Enter unless enter is false) or a key such as enter, up, down, tab, esc or ctrl+c. Answering y or n is done at once; anything else asks the user first.",
  parameters: {
    task_id: taskId,
    text: { type: "string", description: "Optional. What to type." },
    key: { type: "string", description: "Optional. A key to press: enter, tab, esc, up, down, left, right, space, backspace, ctrl+c, ctrl+d or ctrl+z." },
    enter: { type: "boolean", description: "Optional. Press Enter after the text. Defaults to true." },
  },
  required: ["task_id"],
  usage: '{"task_id": "t2", "text": "y"} → answers the prompt the task is waiting on',
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
  available,
  run: async (args, ctx) => {
    const tasks = api();
    if (!tasks || !ctx.chatId) return missing("task_input", "Tasks are not available here.");
    const data = inputFor(args);
    if (data === null) return missing("task_input", "Give text or a key to type. Keys: enter, tab, esc, up, down, left, right, space, backspace, ctrl+c, ctrl+d, ctrl+z.");

    const id = String(args.task_id ?? "");
    const result = await tasks.write(ctx.chatId, id, data);
    if (!result.success || !result.task) return missing("task_input", result.error ?? "Nothing could be typed into that task.");
    const stepId = ctx.newId();
    ctx.pushStep({ id: stepId, type: "command", content: `${ctx.t("sentToTask")} ${result.task.id}`, isComplete: true, taskId: result.task.id });
    ctx.syncSteps();
    return missing("task_input", `Sent to task ${result.task.id}. Read what it printed next with task_output.`);
  },
};

export function registerTaskTools(): void {
  registerTools([taskOutput, taskList, taskStop, taskWait, taskInput]);
}
