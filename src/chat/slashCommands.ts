/**
 * The slash commands. `label` is a translation key, so the menu reads in the
 * user's language while "/new" stays "/new" whatever the interface is set to.
 */
export interface SlashCommand {
  id: string;
  label: string;
  /** Only offered in a workspace with a folder of its own. */
  requiresProject?: boolean;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: "new", label: "newDiscussion" },
  { id: "model", label: "model" },
  { id: "web", label: "webSearch" },
  { id: "think", label: "thinkingMode" },
  { id: "voice", label: "voiceInput" },
  { id: "code", label: "runCode" },
  { id: "files", label: "addFiles" },
  { id: "settings", label: "settings" },
  { id: "memory", label: "projectMemory", requiresProject: true },
  { id: "init", label: "initProject", requiresProject: true },
];

/**
 * What the composer is asking for. A space closes the menu: "/dev/null is not a
 * file" is a sentence, and Enter must send it rather than run a command.
 */
export function slashQueryFor(input: string): string | null {
  if (!input.startsWith("/")) return null;
  if (/\s/.test(input)) return null;
  return input.slice(1).toLowerCase();
}

export function matchSlashCommands(
  input: string,
  options: { project?: boolean } = {},
): SlashCommand[] {
  const query = slashQueryFor(input);
  if (query === null) return [];

  return SLASH_COMMANDS.filter(
    (command) =>
      (options.project || !command.requiresProject) &&
      command.id.startsWith(query),
  );
}

/** Keeps a highlighted row inside the list as the list shrinks under it. */
export function clampSlashIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(index, 0), count - 1);
}
