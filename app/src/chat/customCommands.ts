/** Project commands and agents, read from `.draggy/commands` and `.draggy/agents` as Markdown files.
 * A command is a prompt template: `/name args` expands to its body before the message is sent. */

export type CustomKind = "command" | "agent";

export type CustomSource = "project" | "user";

export interface CustomCommand {
  id: string;
  kind: CustomKind;
  /** Project files win a name clash with the user's own files. */
  source: CustomSource;
  description: string;
  body: string;
  /** Read from agent frontmatter. Shown only; not enforced yet. */
  model?: string;
  tools?: string[];
  permissions?: string;
}

export const COMMAND_FOLDER = ".draggy/commands";
export const AGENT_FOLDER = ".draggy/agents";
/** Anything larger is not a prompt anyone meant to send. */
export const MAX_CUSTOM_FILE_BYTES = 64 * 1024;
export const MAX_CUSTOM_ARGS_BYTES = 8 * 1024;

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Splits a leading `---` frontmatter block from the body. Only flat `key: value` lines count. */
function splitFrontmatter(text: string): { fields: Record<string, string>; body: string } {
  const normal = text.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normal);
  if (!match) return { fields: {}, body: normal.trim() };

  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const pair = /^([a-z_]+):\s*(.*)$/i.exec(line.trim());
    if (pair) fields[pair[1].toLowerCase()] = pair[2].trim().replace(/^["']|["']$/g, "");
  }
  return { fields, body: normal.slice(match[0].length).trim() };
}

/** `tools: [read, grep]` or `tools: read, grep` both give a list. */
function parseList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value.replace(/^\[|\]$/g, "").split(",").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/** Returns null for a file name that cannot be typed after a slash, or a file that is empty or too big. */
export function parseCustomFile(
  fileName: string,
  text: string,
  kind: CustomKind,
  source: CustomSource = "project",
): CustomCommand | null {
  const id = fileName.replace(/\.md$/i, "").toLowerCase();
  if (!NAME_PATTERN.test(id)) return null;
  if (new TextEncoder().encode(text).length > MAX_CUSTOM_FILE_BYTES) return null;

  const { fields, body } = splitFrontmatter(text);
  if (!body) return null;

  const command: CustomCommand = {
    id,
    kind,
    source,
    description: fields.description || body.split("\n")[0].slice(0, 80),
    body,
  };
  if (kind === "agent") {
    command.model = fields.model || undefined;
    command.tools = parseList(fields.tools);
    command.permissions = fields.permissions || undefined;
  }
  return command;
}

/** Built-in command ids and skill ids keep their names; a custom command never shadows them. */
export function usableCustomCommands(commands: CustomCommand[], taken: Set<string>): CustomCommand[] {
  const seen = new Set<string>();
  return commands.filter((command) => {
    if (taken.has(command.id) || seen.has(command.id)) return false;
    seen.add(command.id);
    return true;
  });
}

/** The body with the arguments in. `$ARGUMENTS` takes them where it stands; without it they follow the body. */
export function renderCustomBody(body: string, args: string): string {
  if (body.includes("$ARGUMENTS")) return body.split("$ARGUMENTS").join(args);
  return args ? `${body}\n\n${args}` : body;
}

/** A message that is one command line, like "/review the login page", becomes that command's prompt.
 * Agents get their instructions ahead of the task. Anything else is sent unchanged. */
export function expandCustomCommand(input: string, commands: CustomCommand[]): string {
  const match = /^\/([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/i.exec(input.trim());
  if (!match) return input;

  const command = commands.find((one) => one.id === match[1].toLowerCase());
  if (!command) return input;

  const args = (match[2] ?? "").trim();
  if (new TextEncoder().encode(args).length > MAX_CUSTOM_ARGS_BYTES) return input;
  const rendered = renderCustomBody(command.body, args);
  if (command.kind === "agent") {
    return `Work as the agent "${command.id}" for this request. Its instructions follow.\n\n${rendered}`;
  }
  return rendered;
}
