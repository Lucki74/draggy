import { registerTools } from "./registry";
import { swallowed } from "../logger";
import type { ToolSpec } from "./registry";
import {
  applyChange,
  isFolderTrusted,
  renderNotes,
  loadProjectNotes,
  loadUserNotes,
  saveProjectNotes,
  saveUserNotes,
  type MemoryChange,
  type MemoryScope,
} from "../project/autoMemory";

/** Runs memory writes one at a time per scope, so two calls cannot read the same list and lose a note. */
const queues = new Map<string, Promise<unknown>>();
export function serialized<T>(key: string, job: () => Promise<T>): Promise<T> {
  const next = (queues.get(key) ?? Promise.resolve()).then(job, job);
  queues.set(key, next.catch(swallowed("memory", "the queue moves on after a failed save")));
  return next;
}

/** The save_memory tool: keeps a short note across chats, in the user's or the project's scope. */

function parseChange(args: Record<string, unknown>): { change?: MemoryChange; error?: string } {
  const action = String(args.action ?? "");
  const id = String(args.id ?? "").trim();
  const text = String(args.text ?? "");

  if (action === "add") return { change: { action, text } };
  if (action === "replace" && id) return { change: { action, id, text } };
  if (action === "remove" && id) return { change: { action, id } };
  return { error: "Use action add with text, or replace and remove with an id." };
}

const saveMemory: ToolSpec = {
  name: "save_memory",
  group: "memory",
  description:
    "Keep a short note the user would want in later chats: a preference, a convention, a fact about the project. Scope user is about the person, project is about the folder open now. Never store secrets. Keep one fact per note.",
  parameters: {
    scope: {
      type: "string",
      description: 'Where the note goes: "user" or "project".',
    },
    action: {
      type: "string",
      description: 'What to do: "list" every note in the scope, "add" a new note, "replace" an existing one by id, or "remove" one by id.',
    },
    id: {
      type: "string",
      description: 'The note id shown in brackets, such as "m2". Needed for replace and remove.',
    },
    text: {
      type: "string",
      description: "The note itself, one line. Needed for add and replace.",
    },
  },
  required: ["scope", "action"],
  usage: '{"scope": "user", "action": "add", "text": "Prefers short answers with code first"}',
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
  run: async (args, ctx) => {
    if (ctx.permissionMode === "plan") return "TOOL RESULT (save_memory): Plan mode does not save notes. Say what to save instead.";

    const scope = String(args.scope ?? "") as MemoryScope;
    if (scope !== "user" && scope !== "project") {
      return 'TOOL RESULT (save_memory): Scope must be "user" or "project".';
    }

    if (scope === "project" && !(ctx.workspaceId && ctx.projectRoot)) {
      return "TOOL RESULT (save_memory): Project notes need an open folder. Save a user note instead.";
    }
    if (scope === "project" && !isFolderTrusted(ctx.workspaceId)) {
      return "TOOL RESULT (save_memory): This folder is not trusted for notes yet. Save a user note, or ask the user to trust the folder in the memory editor.";
    }

    if (String(args.action ?? "") === "list") {
      const notes = scope === "user" ? loadUserNotes() : await loadProjectNotes(ctx.workspaceId as string);
      return notes.length
        ? `TOOL RESULT (save_memory): All ${scope} notes, including any the prompt did not show:
${renderNotes(notes)}`
        : `TOOL RESULT (save_memory): No ${scope} notes yet.`;
    }

    const parsed = parseChange(args);
    if (!parsed.change) return `TOOL RESULT (save_memory): ${parsed.error}`;
    const change: MemoryChange = parsed.change;
    const workspaceId = ctx.workspaceId as string;

    ctx.pushStep({
      id: ctx.newId(),
      type: "memory",
      content: `${ctx.t("savingMemory")} **${scope}**: ${change.action === "remove" ? change.id : String(args.text ?? "")}`,
      isComplete: true,
    });

    return serialized(scope === "user" ? "user" : `project:${workspaceId}`, async () => {
      const current = scope === "user" ? loadUserNotes() : await loadProjectNotes(workspaceId);
      const next = applyChange(current, change);
      if (next.error) return `TOOL RESULT (save_memory): ${next.error}`;

      const saved =
        scope === "user"
          ? saveUserNotes(next.notes)
          : await saveProjectNotes(workspaceId, next.notes, ctx.chatId);
      if (!saved) return "TOOL RESULT (save_memory): The note could not be saved. Tell the user.";

      return `TOOL RESULT (save_memory): Saved to ${scope} notes. The user can see and edit them.`;
    });
  },
};

export const MEMORY_TOOLS: ToolSpec[] = [saveMemory];

export function registerMemoryTools(): void {
  registerTools(MEMORY_TOOLS);
}
