import { registerTools } from "./registry";
import type { ToolContext, ToolSpec } from "./registry";

/**
 * The file tools. Everything here names a path and hands it to the main
 * process, which is the only side that knows which folders this conversation
 * was given. Nothing in the renderer decides what is in reach.
 */

const api = () => window.electronAPI?.files;

const NO_BRIDGE = "The file tools are not available in this build.";

/** What the timeline shows: the file, not the whole path to it. */
function nameOf(filePath: string): string {
  const parts = String(filePath).split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || filePath;
}

function workspaceOf(ctx: ToolContext): string {
  return ctx.workspaceId || "default";
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
  annotations: { readOnly: true, idempotent: true },
  available: (environment) => Boolean(environment.hasFolder),
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

    ctx.patchStep(stepId, { isComplete: true, filepath: result.path });
    ctx.syncSteps();

    return `TOOL RESULT (read_file) ${result.path}:\n${result.text}`;
  },
};

const listDirectory: ToolSpec = {
  name: "list_directory",
  group: "files",
  description:
    "List what is in a folder of the project. Use it to find your way around before reading files.",
  parameters: {
    path: {
      type: "string",
      description:
        "Folder to list, relative to the project folder. Leave empty for the project folder itself.",
    },
  },
  required: [],
  usage: '{"path": "src"} → the files and folders in it',
  annotations: { readOnly: true, idempotent: true },
  available: (environment) => Boolean(environment.hasFolder),
  run: async (args, ctx) => {
    const target = String(args.path || ".");
    const stepId = ctx.newId();

    ctx.pushStep({
      id: stepId,
      type: "reading",
      content: `${ctx.t("readingFile")} **${nameOf(target)}**`,
      isComplete: false,
    });

    const result = await api()?.list(workspaceOf(ctx), target);

    if (!result?.success || !result.entries) {
      ctx.patchStep(stepId, { isComplete: true, type: "error" });
      ctx.syncSteps();
      return `TOOL RESULT (list_directory): ${result?.error || NO_BRIDGE}`;
    }

    ctx.patchStep(stepId, { isComplete: true, filepath: result.path });
    ctx.syncSteps();

    const lines = result.entries.map((entry) =>
      entry.isDirectory ? `${entry.name}/` : `${entry.name} (${entry.size} bytes)`,
    );

    const tail = result.truncated ? "\n... and more, not listed." : "";

    return `TOOL RESULT (list_directory) ${result.path}:\n${lines.join("\n")}${tail}`;
  },
};

const searchFiles: ToolSpec = {
  name: "search_files",
  group: "files",
  description:
    "Find files in the project by name, by the text inside them, or both. Generated folders such as node_modules are skipped.",
  parameters: {
    name: {
      type: "string",
      description: "Part of a file name to match, for example .tsx or Button.",
    },
    text: {
      type: "string",
      description: "Exact text to find inside files.",
    },
  },
  required: [],
  usage: '{"text": "createTaskManager"} → the files and lines it appears on',
  annotations: { readOnly: true, idempotent: true },
  available: (environment) => Boolean(environment.hasFolder),
  run: async (args, ctx) => {
    const name = args.name ? String(args.name) : "";
    const text = args.text ? String(args.text) : "";
    const stepId = ctx.newId();

    ctx.pushStep({
      id: stepId,
      type: "searching",
      content: `${ctx.t("searchingFiles")} **${text || name}**`,
      isComplete: false,
    });

    const result = await api()?.search(workspaceOf(ctx), { name, text });

    if (!result?.success || !result.hits) {
      ctx.patchStep(stepId, { isComplete: true, type: "error" });
      ctx.syncSteps();
      return `TOOL RESULT (search_files): ${result?.error || NO_BRIDGE}`;
    }

    ctx.patchStep(stepId, {
      isComplete: true,
      content: `${ctx.t("fileMatches")} **${result.hits.length}**`,
    });
    ctx.syncSteps();

    if (result.hits.length === 0) {
      return "TOOL RESULT (search_files): Nothing matched. Try a shorter piece of text, or look at the folder listing.";
    }

    const lines = result.hits.map((hit) =>
      hit.line ? `${hit.path}:${hit.line}: ${hit.text}` : hit.path,
    );

    return `TOOL RESULT (search_files):\n${lines.join("\n")}`;
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
  annotations: {},
  available: (environment) => Boolean(environment.hasFolder),
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

    return `TOOL RESULT (edit_file): Replaced ${result.replaced} occurrence(s) in ${result.path}.`;
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
  annotations: {},
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
      content: `${ctx.t("wroteFile")} **${nameOf(target)}**`,
      filepath: result.path,
      checkpointId: result.checkpointId,
    });
    ctx.syncSteps();

    return `TOOL RESULT (write_file): ${result.created ? "Created" : "Replaced"} ${result.path}.`;
  },
};

const moveFile: ToolSpec = {
  name: "move_file",
  group: "files",
  description:
    "Move or rename a file inside the project folder. The destination must not already exist.",
  parameters: {
    from: { type: "string", description: "The file as it is now." },
    to: { type: "string", description: "Where it should be instead." },
  },
  required: ["from", "to"],
  usage: '{"from": "notes.md", "to": "docs/notes.md"} → moves the file',
  annotations: { destructive: true },
  available: (environment) => Boolean(environment.hasFolder),
  run: async (args, ctx) => {
    const from = String(args.from);
    const to = String(args.to);
    const stepId = ctx.newId();

    ctx.pushStep({
      id: stepId,
      type: "edit_file",
      content: `${ctx.t("movedFile")} **${nameOf(from)}** → **${nameOf(to)}**`,
      isComplete: false,
      filename: nameOf(to),
    });

    const result = await api()?.move(workspaceOf(ctx), from, to, ctx.chatId);

    if (!result?.success) {
      ctx.patchStep(stepId, { isComplete: true, type: "error" });
      ctx.syncSteps();
      return `TOOL RESULT (move_file): ${result?.error || NO_BRIDGE}`;
    }

    ctx.patchStep(stepId, {
      isComplete: true,
      filepath: result.path,
      checkpointId: result.checkpointId,
    });
    ctx.syncSteps();

    return `TOOL RESULT (move_file): Moved to ${result.path}.`;
  },
};

const deleteFile: ToolSpec = {
  name: "delete_file",
  group: "files",
  description:
    "Delete a file from the project folder. It goes to the recycle bin, and the user can undo it.",
  parameters: {
    path: { type: "string", description: "Path to the file." },
  },
  required: ["path"],
  usage: '{"path": "old-notes.md"} → moves the file to the recycle bin',
  annotations: { destructive: true },
  available: (environment) => Boolean(environment.hasFolder),
  run: async (args, ctx) => {
    const target = String(args.path);
    const stepId = ctx.newId();

    ctx.pushStep({
      id: stepId,
      type: "edit_file",
      content: `${ctx.t("deletedFile")} **${nameOf(target)}**`,
      isComplete: false,
      filename: nameOf(target),
    });

    const result = await api()?.remove(workspaceOf(ctx), target, ctx.chatId);

    if (!result?.success) {
      ctx.patchStep(stepId, { isComplete: true, type: "error" });
      ctx.syncSteps();
      return `TOOL RESULT (delete_file): ${result?.error || NO_BRIDGE}`;
    }

    ctx.patchStep(stepId, {
      isComplete: true,
      filepath: result.path,
      checkpointId: result.checkpointId,
    });
    ctx.syncSteps();

    return `TOOL RESULT (delete_file): ${result.path} is in the recycle bin. Tell the user, in case it was not what they meant.`;
  },
};

export const FILE_TOOLS: ToolSpec[] = [
  readFile,
  listDirectory,
  searchFiles,
  editFile,
  writeFile,
  moveFile,
  deleteFile,
];

export function registerFileTools(): void {
  registerTools(FILE_TOOLS);
}
