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
  { id: "think", label: "effort" },
  { id: "voice", label: "voiceInput" },
  { id: "files", label: "addFiles" },
  { id: "compact", label: "compactConversation" },
  { id: "compact-limit", label: "compactLimitCommand", takesArgument: true },
  { id: "image", label: "generateImageCommand", takesArgument: true },
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

/** The /word the caret is in or ends, anywhere in the message. It starts the text or follows a space,
 * holds no second slash (that is a path) and sits outside backticks. `query` is what was typed up to
 * the caret. */
export interface SlashToken {
  start: number;
  end: number;
  query: string;
}

export function slashTokenAt(text: string, caret: number): SlashToken | null {
  const at = Math.min(Math.max(caret, 0), text.length);
  let start = at;
  while (start > 0 && !/\s/.test(text[start - 1])) start -= 1;
  let end = at;
  while (end < text.length && !/\s/.test(text[end])) end += 1;

  if (!/^\/[^/`]*$/.test(text.slice(start, end))) return null;
  if ((text.slice(0, start).match(/`/g) ?? []).length % 2 === 1) return null;

  return { start, end, query: text.slice(start + 1, at).toLowerCase() };
}

/** The token swapped for a command, with a space after it unless one is already there. The caret goes
 * past that space. */
export function replaceSlashToken(text: string, token: SlashToken, id: string): { text: string; caret: number } {
  const spaced = /\s/.test(text[token.end] ?? "");
  const head = `${text.slice(0, token.start)}/${id}`;
  const tail = spaced ? text.slice(token.end) : ` ${text.slice(token.end)}`;

  return { text: head + tail, caret: head.length + 1 };
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
      // The menu has one line per command; the full description is on the Skills page.
      description: skill.summary || skill.description,
      takesArgument: true,
    }));
}

export function matchSlashCommands(
  input: string,
  options: { surface?: "chat" | "code"; skills?: InstalledSkill[]; caret?: number } = {},
): SlashCommand[] {
  const token = slashTokenAt(input, options.caret ?? input.length);
  if (!token) return [];
  const { query } = token;

  const surface = options.surface ?? "chat";

  // Only a skill makes sense inside a sentence; "/new" there would mean nothing.
  const builtIn =
    token.start > 0
      ? []
      : SLASH_COMMANDS.filter((command) => (!command.only || command.only === surface) && command.id.startsWith(query));
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
