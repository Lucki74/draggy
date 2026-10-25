import { registerTools } from "./registry";
import type { ToolContext, ToolSpec } from "./registry";
import type { GitChange, GitStatus } from "../types";

/** Git for the model. Status, diffs and history only look. Stage, unstage, commit and switching
 * branch change the repository, so they are executes-class and wait for the user's approval. Nothing
 * here fetches or pushes. */

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
    "See the project's git state: the branch, how far it is from its upstream, and which files changed. Read-only. Staging, committing and switching branches are separate tools.",
  parameters: {},
  required: [],
  usage: "{} → branch and changed files",
  annotations: {
    readOnly: true,
    readOnlyHint: true,
    destructive: false,
    destructiveHint: false,
    idempotent: true,
    idempotentHint: true,
    openWorld: false,
    openWorldHint: false,
  },
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
    untracked: {
      type: "boolean",
      description: "Also show new files git does not track yet, as additions.",
    },
  },
  required: [],
  usage: '{"path": "src/App.tsx"} → the changes to that file',
  annotations: {
    readOnly: true,
    readOnlyHint: true,
    destructive: false,
    destructiveHint: false,
    idempotent: true,
    idempotentHint: true,
    openWorld: false,
    openWorldHint: false,
  },
  available: (environment) => Boolean(environment.hasFolder && environment.hasGit),
  run: async (args, ctx) => {
    const target = typeof args.path === "string" && args.path.trim() ? args.path.trim() : "";
    const staged = args.staged === true || args.staged === "true";
    const untracked = args.untracked === true || args.untracked === "true";
    const label = target || ctx.t("gitWholeProject");
    const stepId = ctx.newId();

    ctx.pushStep({
      id: stepId,
      type: "git",
      content: `${ctx.t("gitReadingDiff")} **${label}**`,
      isComplete: false,
    });

    const result = await api()?.diff(workspaceOf(ctx), target || undefined, staged, untracked);

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

const WRITE_ANNOTATIONS = {
  executes: true,
  readOnly: false,
  readOnlyHint: false,
  destructive: false,
  destructiveHint: false,
  idempotent: false,
  idempotentHint: false,
  openWorld: false,
  openWorldHint: false,
} as const;

const canWrite = (environment: Parameters<NonNullable<ToolSpec["available"]>>[0]) =>
  Boolean(environment.hasFolder && environment.hasGit) && !environment.readOnlyTools;

const pathsOf = (args: Record<string, unknown>): string[] => {
  const raw = args.paths;
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/\r?\n/) : [];
  return list.map((item) => String(item).trim()).filter(Boolean);
};

const gitLog: ToolSpec = {
  name: "git_log",
  group: "git",
  description: "List the latest commits on the current branch: short hash, author, date and subject. Read-only.",
  parameters: {
    limit: { type: "integer", description: "How many commits, up to 200. Defaults to 20." },
  },
  required: [],
  usage: '{"limit": 10} → the ten latest commits',
  annotations: {
    readOnly: true,
    readOnlyHint: true,
    destructive: false,
    destructiveHint: false,
    idempotent: true,
    idempotentHint: true,
    openWorld: false,
    openWorldHint: false,
  },
  available: (environment) => Boolean(environment.hasFolder && environment.hasGit),
  run: async (args, ctx) => {
    const result = await api()?.log(workspaceOf(ctx), Number(args.limit) || 20);
    if (!result?.success) return `TOOL RESULT (git_log): ${result?.error || NO_BRIDGE}`;
    const commits = result.commits ?? [];
    if (commits.length === 0) return "TOOL RESULT (git_log): No commits yet.";
    const lines = commits.map((c) => `${c.short} ${c.date.slice(0, 10)} ${c.author}: ${c.subject}`);
    return `TOOL RESULT (git_log):\n${lines.join("\n")}`;
  },
};

const gitBranches: ToolSpec = {
  name: "git_branches",
  group: "git",
  description: "List the local branches and mark the current one. Read-only.",
  parameters: {},
  required: [],
  usage: "{} → the local branches",
  annotations: {
    readOnly: true,
    readOnlyHint: true,
    destructive: false,
    destructiveHint: false,
    idempotent: true,
    idempotentHint: true,
    openWorld: false,
    openWorldHint: false,
  },
  available: (environment) => Boolean(environment.hasFolder && environment.hasGit),
  run: async (_args, ctx) => {
    const result = await api()?.branches(workspaceOf(ctx));
    if (!result?.success) return `TOOL RESULT (git_branches): ${result?.error || NO_BRIDGE}`;
    const lines = (result.branches ?? []).map((b) => `${b.current ? "*" : " "} ${b.name}${b.upstream ? ` -> ${b.upstream}` : ""}`);
    return `TOOL RESULT (git_branches):\n${lines.join("\n") || "No branches yet."}`;
  },
};

function writeTool(
  name: "git_stage" | "git_unstage",
  verb: "stage" | "unstage",
  description: string,
): ToolSpec {
  return {
    name,
    group: "git",
    description,
    parameters: {
      paths: { type: "string", description: "Files or folders in the project, one per line." },
    },
    required: ["paths"],
    usage: `{"paths": "src/App.tsx"} → ${verb}s that file`,
    annotations: WRITE_ANNOTATIONS,
    available: canWrite,
    run: async (args, ctx) => {
      const paths = pathsOf(args);
      if (paths.length === 0) return `TOOL RESULT (${name}): Name at least one path.`;
      const result = await api()?.[verb](workspaceOf(ctx), paths);
      if (!result?.success) return `TOOL RESULT (${name}): ${result?.error || NO_BRIDGE}`;
      return `TOOL RESULT (${name}): ${verb === "stage" ? "Staged" : "Unstaged"} ${result.files ?? paths.length} path(s).`;
    },
  };
}

const gitStage = writeTool("git_stage", "stage", "Stage files so the next commit includes them. Does not commit, push or touch the files themselves.");
const gitUnstage = writeTool("git_unstage", "unstage", "Take files out of the next commit. The files on disk stay as they are.");

const gitCommit: ToolSpec = {
  name: "git_commit",
  group: "git",
  description:
    "Commit what is staged, with the given message. Hooks do not run and the commit is not signed. Never pushes. Stage first with git_stage.",
  parameters: {
    message: { type: "string", description: "The commit message." },
  },
  required: ["message"],
  usage: '{"message": "Fix the login redirect"} → commits the staged files',
  annotations: WRITE_ANNOTATIONS,
  available: canWrite,
  run: async (args, ctx) => {
    const result = await api()?.commit(workspaceOf(ctx), String(args.message ?? ""));
    if (!result?.success) return `TOOL RESULT (git_commit): ${result?.error || NO_BRIDGE}`;
    return `TOOL RESULT (git_commit): Committed${result.hash ? ` as ${result.hash}` : ""}.`;
  },
};

const gitCheckout: ToolSpec = {
  name: "git_checkout",
  group: "git",
  description:
    "Switch to an existing local branch. Git refuses when uncommitted changes would be lost. Does not create branches.",
  parameters: {
    branch: { type: "string", description: "The branch name." },
  },
  required: ["branch"],
  usage: '{"branch": "main"} → switches to main',
  annotations: WRITE_ANNOTATIONS,
  available: canWrite,
  run: async (args, ctx) => {
    const result = await api()?.checkout(workspaceOf(ctx), String(args.branch ?? ""));
    if (!result?.success) return `TOOL RESULT (git_checkout): ${result?.error || NO_BRIDGE}`;
    return `TOOL RESULT (git_checkout): Now on ${result.branch}.`;
  },
};

export const GIT_TOOLS: ToolSpec[] = [gitStatus, gitDiff, gitLog, gitBranches, gitStage, gitUnstage, gitCommit, gitCheckout];

export function registerGitTools(): void {
  registerTools(GIT_TOOLS);
}
