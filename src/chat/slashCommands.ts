/**
 * The slash commands. `label` is a translation key, so the menu reads in the
 * user's language while "/new" stays "/new" whatever the interface is set to.
 */
export interface SlashCommand {
  id: string;
  label: string;
  /** Only offered in a workspace with a folder of its own. */
  requiresProject?: boolean;
  /**
   * Written with a value after it, like "/compact-limit 20k". Picking it from
   * the menu fills in the command and leaves the value to be typed.
   */
  takesArgument?: boolean;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: "new", label: "newDiscussion" },
  { id: "model", label: "model" },
  { id: "web", label: "webSearch" },
  { id: "think", label: "thinkingMode" },
  { id: "voice", label: "voiceInput" },
  { id: "code", label: "runCode" },
  { id: "files", label: "addFiles" },
  { id: "compact", label: "compactConversation" },
  { id: "compact-limit", label: "compactLimitCommand", takesArgument: true },
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

/**
 * A command typed with its value, like "/compact-limit 20k", which the menu
 * has already closed on because of the space. Only commands that take a value
 * are read this way; anything else starting with a slash is a message.
 */
export function parseSlashArgument(
  input: string,
): { id: string; argument: string } | null {
  const match = /^\/([a-z-]+)\s+(.+)$/i.exec(String(input || "").trim());
  if (!match) return null;

  const id = match[1].toLowerCase();
  const command = SLASH_COMMANDS.find((one) => one.id === id);
  if (!command?.takesArgument) return null;

  return { id, argument: match[2].trim() };
}

/** Keeps a highlighted row inside the list as the list shrinks under it. */
export function clampSlashIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(index, 0), count - 1);
}
