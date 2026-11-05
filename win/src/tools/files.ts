import { registerTools } from "./registry";
import type { ToolContext, ToolSpec } from "./registry";
import { loadProjectMemory } from "../project/load";
import { renderFolderRules } from "../project/memory";

/** The file tools. Each hands a path to the main process, the only side that knows which folders
 * this conversation was given. */

const api = () => window.electronAPI?.files;

const NO_BRIDGE = "The file tools are not available in this build.";

/** What the timeline shows: the file, not the whole path to it. */
function nameOf(filePath: string): string {
  const parts = String(filePath).split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || filePath;
}

/** A chat with no project reaches its own folder, which the main process names `chat:<id>`. */
function workspaceOf(ctx: ToolContext): string {
  if (ctx.environment?.chatFolder && ctx.chatId) return `chat:${ctx.chatId}`;
  return ctx.workspaceId || "default";
}

/** A deeper folder's rules, given the first time something in it is touched. The root file is
 * already in the prompt, so only closer ones, once per turn. */
async function folderRules(ctx: ToolContext, target: string): Promise<string> {
  if (!ctx.projectRoot) return "";

  const folder = target.replace(/[^\\/]*$/, "");
  const key = `rules:${folder.toLowerCase()}`;
  if (ctx.memo.has(key)) return "";
  ctx.memo.set(key, true);

  const memory = await loadProjectMemory(
    workspaceOf(ctx),
    ctx.projectRoot,
    target,
  );

  // A path with no separator in it is the root file, already in the prompt.
  if (!memory || !memory.path.includes("/")) return "";

  return renderFolderRules(memory);
}

const readFile: ToolSpec = {
  name: "read_file",
  group: "files",
  description:
    "Read a text file from the project folder. Use it before changing anything, and copy from what it returns when you edit.",
  parameters: {
    path: {
      type: "string",
      description:
        "Path to the file, relative to the project folder, for example src/App.tsx.",
    },
  },
  required: ["path"],
  usage: '{"path": "src/App.tsx"} → the text of the file',
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
  available: (environment) => Boolean(environment.hasFolder || environment.chatFolder),
  run: async (args, ctx) => {
    const target = String(args.path);
    const stepId = ctx.newId();

    ctx.pushStep({
      id: stepId,
      type: "reading",
      content: `${ctx.t("readingFile")} **${nameOf(target)}**`,
      isComplete: false,
      filename: nameOf(target),
    });

    const result = await api()?.read(workspaceOf(ctx), target);

    if (!result?.success) {
      ctx.patchStep(stepId, { isComplete: true, type: "error" });
      ctx.syncSteps();
      return `TOOL RESULT (read_file): ${result?.error || NO_BRIDGE}`;
    }

    ctx.patchStep(stepId, {
      isComplete: true,
      filepath: result.path,
      content: `${ctx.t("readFile")} **${nameOf(target)}**`,
    });
    ctx.syncSteps();

    const rules = await folderRules(ctx, result.path || target);

    return `TOOL RESULT (read_file) ${result.path}:\n${result.text}${rules}`;
  },
};

const editFile: ToolSpec = {
  name: "edit_file",
  group: "files",
  description:
    "Replace an exact piece of text in a file. Read the file first and copy the lines you are replacing, whitespace included. The text has to appear exactly once unless you say how many times.",
  parameters: {
    path: { type: "string", description: "Path to the file." },
    find: {
      type: "string",
      description:
        "The text to replace, copied exactly from the file, with enough of the surrounding lines to appear only once.",
    },
    replace: { type: "string", description: "What to put in its place." },
    expected: {
      type: "integer",
      description:
        "How many times the text should appear. Defaults to one; the edit is refused if the count does not match.",
    },
  },
  required: ["path", "find", "replace"],
  usage:
    '{"path": "src/App.tsx", "find": "const x = 1;", "replace": "const x = 2;"} → edits the file in place',
  annotations: {
    readOnly: false,
    readOnlyHint: false,
    destructive: false,
    destructiveHint: false,
    idempotent: false,
    idempotentHint: false,
    openWorld: false,
    openWorldHint: false,
  },
  available: (environment) => Boolean(environment.hasFolder || environment.chatFolder),
  run: async (args, ctx) => {
    const target = String(args.path);
    const stepId = ctx.newId();

    ctx.pushStep({
      id: stepId,
      type: "edit_file",
      content: `${ctx.t("savingFile")} **${nameOf(target)}**...`,
      isComplete: false,
      filename: nameOf(target),
    });

    const result = await api()?.edit(
      workspaceOf(ctx),
      target,
      String(args.find),
      String(args.replace ?? ""),
      Number(args.expected) || 1,
      ctx.chatId,
    );

    if (!result?.success) {
      ctx.patchStep(stepId, {
        isComplete: true,
        type: "error",
        content: `${ctx.t("savingFile")} **${nameOf(target)}**`,
      });
      ctx.syncSteps();
      return `TOOL RESULT (edit_file): ${result?.error || NO_BRIDGE}`;
    }

    ctx.patchStep(stepId, {
      isComplete: true,
      content: `${ctx.t("wroteFile")} **${nameOf(target)}**`,
      filepath: result.path,
      checkpointId: result.checkpointId,
      before: result.before,
      after: result.after,
    });
    ctx.syncSteps();

    const rules = await folderRules(ctx, result.path || target);

    return `TOOL RESULT (edit_file): Replaced ${result.replaced} occurrence(s) in ${result.path}.${rules}`;
  },
};

const writeFile: ToolSpec = {
  name: "write_file",
  group: "files",
  description:
    "Write a file in the project folder, replacing everything in it. Use edit_file for a change to part of a file; this one is for new files and for rewrites.",
  parameters: {
    path: { type: "string", description: "Path to the file." },
    content: { type: "string", description: "The whole contents of the file." },
  },
  required: ["path", "content"],
  usage: '{"path": "src/new.ts", "content": "export const x = 1;\\n"} → writes the file',
  annotations: {
    readOnly: false,
    readOnlyHint: false,
    destructive: false,
    destructiveHint: false,
    idempotent: true,
    idempotentHint: true,
    openWorld: false,
    openWorldHint: false,
  },
  available: (environment) => Boolean(environment.hasFolder),
  run: async (args, ctx) => {
    const target = String(args.path);
    const contents = String(args.content ?? "");
    const stepId = ctx.newId();
    ctx.pushStep({
      id: stepId,
      type: "edit_file",
      content: `${ctx.t("savingFile")} **${nameOf(target)}**...`,
      isComplete: false,
      filename: nameOf(target),
      fileContent: contents,
    });

    const result = await api()?.write(
      workspaceOf(ctx),
      target,
      contents,
      ctx.chatId,
    );

    if (!result?.success) {
      ctx.patchStep(stepId, { isComplete: true, type: "error" });
      ctx.syncSteps();
      return `TOOL RESULT (write_file): ${result?.error || NO_BRIDGE}`;
    }

    ctx.patchStep(stepId, {
      isComplete: true,
      content: `${ctx.t(result.created ? "createdFile" : "wroteFile")} **${nameOf(target)}**`,
      filepath: result.path,
      checkpointId: result.checkpointId,
      change: result.created ? "created" : undefined,
      before: result.before,
      after: result.after,
    });
    ctx.syncSteps();

    const rules = await folderRules(ctx, result.path || target);

    return `TOOL RESULT (write_file): ${result.created ? "Created" : "Replaced"} ${result.path}.${rules}`;
  },
};

export const FILE_TOOLS: ToolSpec[] = [
  readFile,
  editFile,
  writeFile,
];

export function registerFileTools(): void {
  registerTools(FILE_TOOLS);
}
