import type { InstalledSkill } from "../types";

/** The slash commands. `label` is a translation key, so the menu reads in the user's language while
 * "/new" stays "/new" whatever the interface is set to. */
export interface SlashCommand {
  id: string;
  label: string;
  /** The side it belongs to. Missing means both Chat and Code offer it. */
  only?: "chat" | "code";
  /** Written with a value after it, like "/compact-limit 20k". Picking it from the menu fills in
   * the command and leaves the value to be typed. */
  takesArgument?: boolean;
  /** Set for a skill, whose description stands in for a translated label. */
  description?: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: "new", label: "newDiscussion" },
  { id: "model", label: "model" },
  { id: "web", label: "webSearch" },
  { id: "think", label: "thinkingMode" },
  { id: "voice", label: "voiceInput" },
  { id: "files", label: "addFiles" },
  { id: "compact", label: "compactConversation" },
  { id: "compact-limit", label: "compactLimitCommand", takesArgument: true },
  { id: "settings", label: "settings" },
  { id: "permissions", label: "permissionMode", only: "code" },
  { id: "memory", label: "projectMemory", only: "code" },
  { id: "init", label: "initProject", only: "code" },
];

/** What the composer is asking for. A space closes the menu: "/dev/null is not a file" is a
 * sentence, and Enter must send it rather than run a command. */
export function slashQueryFor(input: string): string | null {
  if (!input.startsWith("/")) return null;
  if (/\s/.test(input)) return null;
  return input.slice(1).toLowerCase();
}

/** Skills as commands, after the built-in ones. A skill named like a built-in command is left out,
 * since typing it runs the command. */
export function skillCommands(skills: InstalledSkill[]): SlashCommand[] {
  const taken = new Set(SLASH_COMMANDS.map((command) => command.id));

  return skills
    .filter((skill) => !taken.has(skill.id.toLowerCase()))
    .map((skill) => ({
      id: skill.id,
      label: "",
      description: skill.description,
      takesArgument: true,
    }));
}

export function matchSlashCommands(
  input: string,
  options: { surface?: "chat" | "code"; skills?: InstalledSkill[] } = {},
): SlashCommand[] {
  const query = slashQueryFor(input);
  if (query === null) return [];

  const surface = options.surface ?? "chat";

  const builtIn = SLASH_COMMANDS.filter(
    (command) => (!command.only || command.only === surface) && command.id.startsWith(query),
  );
  const skills = skillCommands(options.skills ?? []).filter((command) =>
    command.id.toLowerCase().startsWith(query),
  );

  return [...builtIn, ...skills];
}

/** A command typed with a value, like "/compact-limit 20k", read after the space closed the menu.
 * Other text starting with a slash is a message. */
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
