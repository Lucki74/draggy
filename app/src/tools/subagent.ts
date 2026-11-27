import { registerTools } from "./registry";
import type { ToolEnvironment, ToolGroup, ToolSpec } from "./registry";
import type { SearchStep } from "../types";

/** The tool that runs a child agent with a fresh context and a restricted tool set. The child's
 * own reads stay out of this turn: only its final summary comes back. */

const MAX_SUMMARY_CHARS = 4000;

/** Groups a child may be given. Never agent (no nesting), plan, ask, browser or image. */
export const SUBAGENT_GROUPS: ToolGroup[] = ["files", "code", "git", "shell", "library", "skill", "web", "external"];

const DEFAULT_GROUPS: ToolGroup[] = ["files"];

const available = (environment: ToolEnvironment) =>
  !environment.readOnlyTools && (environment.subagentDepth ?? 0) < 1;

/** Reads the group list the model sent. Null when a name is not a group a child may have. */
export function parseSubagentGroups(raw: unknown): ToolGroup[] | null {
  if (typeof raw !== "string" || raw.trim() === "") return DEFAULT_GROUPS;
  const names = raw.split(",").map((name) => name.trim().toLowerCase()).filter(Boolean);
  const groups: ToolGroup[] = [];
  for (const name of names) {
    const group = SUBAGENT_GROUPS.find((entry) => entry === name);
    if (!group) return null;
    if (!groups.includes(group)) groups.push(group);
  }
  return groups;
}

/** The most child runs at once, kept between 1 and 4. Unset means 2. */
export function subagentLimit(raw: unknown): number {
  const value = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : 2;
  return Math.min(4, Math.max(1, value));
}

/** The most child runs one parent turn may start, kept between 4 and 32. Unset means 8. */
export function subagentTurnCap(raw: unknown): number {
  const value = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : 8;
  return Math.min(32, Math.max(4, value));
}

/** Same cut as the live shell output display, so a finished child keeps no more than a live one showed. */
const NESTED_OUTPUT_CHARS = 20000;

/** Keeps the tail of each long output a child step carries, so a saved chat does not hold a whole large read. */
export function capNestedSteps(steps: SearchStep[]): SearchStep[] {
  const cut = <T extends string | undefined>(value: T): T =>
    (value && value.length > NESTED_OUTPUT_CHARS ? value.slice(-NESTED_OUTPUT_CHARS) : value) as T;
  return steps.map((step) => ({
    ...step,
    stdout: cut(step.stdout),
    stderr: cut(step.stderr),
    fileContent: cut(step.fileContent),
    content: cut(step.content),
  }));
}

/** A local model has one llama-server slot, so its children run one at a time whatever the setting says. */
export function subagentSlots(remote: boolean, raw: unknown): number {
  return remote ? subagentLimit(raw) : 1;
}

/** The one-line title for a run: the label, or the start of the task when there is none. */
export function runLabel(label: unknown, task: string): string {
  const flat = (text: string) => text.replace(/\s+/g, " ").trim();
  return flat(String(label ?? "")) || flat(task).slice(0, 60);
}

/** Trims a child's answer to the summary cap, keeping the start. */
export function capSummary(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_SUMMARY_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_SUMMARY_CHARS)}\n[summary cut]`;
}

const runSubagent: ToolSpec = {
  name: "run_subagent",
  group: "agent",
  description:
    "Hand a self-contained task to a child agent with a fresh context and only the tool groups you name. It runs read-only unless allow_edits is true. You get back its final summary, not its steps. Use it for a broad search or a check that would flood this conversation.",
  parameters: {
    task: {
      type: "string",
      description: "The full task for the child, with everything it needs to know. It cannot ask you.",
    },
    label: {
      type: "string",
      description: "A short title for the run, shown to the user.",
    },
    tools: {
      type: "string",
      description: "Comma list of tool groups the child may use: files, code, git, shell, library, skill, web, external. Default files.",
    },
    allow_edits: {
      type: "boolean",
      description: "Set true only when the child must change files. Default false.",
    },
  },
  required: ["task"],
  usage:
    '{"task": "Find every place that reads the config file and list them with line numbers", "label": "Find config readers", "tools": "files,code"} → runs a read-only child and returns its summary',
  annotations: { readOnly: false, destructive: false, idempotent: false },
  available,
  run: async (args, context) => {
    const task = String(args.task ?? "").trim();
    const label = runLabel(args.label, task);
    const groups = parseSubagentGroups(args.tools);
    if (!groups) {
      return `TOOL ERROR (run_subagent): tools must be a comma list of ${SUBAGENT_GROUPS.join(", ")}.`;
    }
    if ((context.environment?.subagentDepth ?? 0) >= 1) {
      return "TOOL ERROR (run_subagent): a subagent cannot start another subagent.";
    }
    if (!context.spawnSubagent) {
      return "TOOL RESULT (run_subagent): Subagents are not available in this turn.";
    }
    if (context.settings.subagents === false) {
      return "TOOL RESULT (run_subagent): Subagents are turned off in settings.";
    }
    const allowEdits = args.allow_edits === true || args.allow_edits === "true";
    const outcome = await context.spawnSubagent({ task, label, groups, allowEdits });
    const header = `Subagent ${outcome.status} after ${outcome.toolCount} tool call${outcome.toolCount === 1 ? "" : "s"}.`;
    return `TOOL RESULT (run_subagent): ${header}\n${outcome.summary}`;
  },
};

export function registerSubagentTools(): void {
  registerTools([runSubagent]);
}
