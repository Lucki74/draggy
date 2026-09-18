import { registerTools } from "./registry";
import type { ToolContext, ToolSpec } from "./registry";
import type { GitChange, GitStatus } from "../types";

/** Git for the model: status and diffs, look only. The descriptions say it cannot commit, so a
 * model asked to commit tells the user how. */

const api = () => window.electronAPI?.git;

const NO_BRIDGE = "Git is not available in this build.";

const workspaceOf = (ctx: ToolContext) => ctx.workspaceId || "default";

const LETTERS: Record<GitChange["kind"], string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "?",
  conflicted: "U",
};

/** One line per changed file, the way `git status --short` would put it. */
export function describeChange(change: GitChange): string {
  const where = change.from ? `${change.from} -> ${change.path}` : change.path;
  const state =
    change.kind === "untracked"
      ? "untracked"
      : change.staged && change.unstaged
        ? "staged, with more changes not staged"
        : change.staged
          ? "staged"
          : "not staged";

  return `${LETTERS[change.kind]} ${where} (${change.kind}, ${state})`;
}

/** The status as text a model can reason about. */
export function describeStatus(status: GitStatus): string {
  if (!status.available) return "Git is not installed on this computer.";
  if (!status.isRepo) return "This project folder is not a git repository.";
  if (!status.success) return `Git could not read the repository: ${status.error || "unknown error"}`;

  const where = status.detached
    ? "Not on a branch (detached HEAD)."
    : `On branch ${status.branch ?? "(unknown)"}.`;

  const tracking = status.upstream
    ? ` Tracking ${status.upstream}: ${status.ahead ?? 0} ahead, ${status.behind ?? 0} behind.`
    : " No upstream branch.";

  const files = status.files ?? [];
  if (files.length === 0) return `${where}${tracking}\nThe working tree is clean.`;

  const listed = files.map(describeChange).join("\n");
  const more = status.truncated ? "\n(More files changed than are listed here.)" : "";

  return `${where}${tracking}\n${files.length} changed:\n${listed}${more}`;
}

const gitStatus: ToolSpec = {
  name: "git_status",
  group: "git",
  description:
    "See the project's git state: the branch, how far it is from its upstream, and which files changed. Read-only. Draggy cannot commit, stage or switch branches; those are for the user to do.",
  parameters: {},
  required: [],
  usage: "{} → branch and changed files",
  annotations: { readOnly: true, idempotent: true },
  available: (environment) => Boolean(environment.hasFolder && environment.hasGit),
  run: async (_args, ctx) => {
    const stepId = ctx.newId();

    ctx.pushStep({
      id: stepId,
      type: "git",
      content: ctx.t("gitCheckingStatus"),
      isComplete: false,
    });

    const status = await api()?.status(workspaceOf(ctx));

    if (!status?.success || !status.isRepo) {
      ctx.patchStep(stepId, { isComplete: true, type: "error" });
      ctx.syncSteps();
      return `TOOL RESULT (git_status): ${status ? describeStatus(status) : NO_BRIDGE}`;
    }

    const changed = status.files?.length ?? 0;

    ctx.patchStep(stepId, {
      isComplete: true,
      content: `${ctx.t("gitCheckedStatus")} **${status.branch ?? "HEAD"}** · ${ctx
        .t("gitChangedFiles")
        .replace("{count}", String(changed))}`,
    });
    ctx.syncSteps();

    return `TOOL RESULT (git_status):\n${describeStatus(status)}`;
  },
};

const gitDiff: ToolSpec = {
  name: "git_diff",
  group: "git",
  description:
    "Show what changed in the project since the last commit, as a unified diff. Give a path for one file, or leave it out for everything. Set staged to see what is staged instead of the working tree. Read-only.",
  parameters: {
    path: {
      type: "string",
      description: "A file or folder in the project. Leave out for the whole project.",
    },
    staged: {
      type: "boolean",
      description: "Show staged changes instead of unstaged ones.",
    },
  },
  required: [],
  usage: '{"path": "src/App.tsx"} → the changes to that file',
  annotations: { readOnly: true, idempotent: true },
  available: (environment) => Boolean(environment.hasFolder && environment.hasGit),
  run: async (args, ctx) => {
    const target = typeof args.path === "string" && args.path.trim() ? args.path.trim() : "";
    const staged = args.staged === true || args.staged === "true";
    const label = target || ctx.t("gitWholeProject");
    const stepId = ctx.newId();

    ctx.pushStep({
      id: stepId,
      type: "git",
      content: `${ctx.t("gitReadingDiff")} **${label}**`,
      isComplete: false,
    });

    const result = await api()?.diff(workspaceOf(ctx), target || undefined, staged);

    if (!result?.success) {
      ctx.patchStep(stepId, { isComplete: true, type: "error" });
      ctx.syncSteps();
      return `TOOL RESULT (git_diff): ${result?.error || NO_BRIDGE}`;
    }

    ctx.patchStep(stepId, {
      isComplete: true,
      content: `${ctx.t("gitReadDiff")} **${label}**`,
      ...(result.diff ? { fileContent: result.diff, language: "diff" } : {}),
    });
    ctx.syncSteps();

    const notes = [
      result.truncated ? "The diff was too long and has been cut short; ask for one file at a time." : "",
      result.skipped
        ? `${result.skipped} changed file(s) were left out because they hold credentials. Do not try to read them another way.`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    if (!result.diff) {
      return `TOOL RESULT (git_diff): No ${staged ? "staged " : ""}changes${target ? ` in ${target}` : ""}.${notes ? `\n${notes}` : ""}`;
    }

    return `TOOL RESULT (git_diff):\n${result.diff}${notes ? `\n\n${notes}` : ""}`;
  },
};

export const GIT_TOOLS: ToolSpec[] = [gitStatus, gitDiff];

export function registerGitTools(): void {
  registerTools(GIT_TOOLS);
}
