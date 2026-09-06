import type { ChatSession, Message } from "../types";

/**
 * A conversation as Markdown. Pure on purpose: the file writing lives in the
 * main process, and everything worth getting right is decided here.
 */

/** Windows refuses these outright, and the rest travel badly. */
// Control characters are exactly what has to go: no filesystem takes them.
// eslint-disable-next-line no-control-regex
const UNSAFE_IN_FILENAME = /[<>:"/\\|?*\u0000-\u001f]/g;

/** What the reader saw, which is the visible text of the shown version. */
export function visibleText(message: Message): string {
  const versions = message.versions;
  const index = message.currentVersionIndex ?? (versions ? versions.length - 1 : 0);
  const shown = versions && index < versions.length ? versions[index] : message;

  return (shown.textContent ?? shown.content ?? "").trim();
}

export function exportFilename(session: ChatSession, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 10);
  const title = (session.title || "Conversation")
    .replace(UNSAFE_IN_FILENAME, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Long titles make a path nothing can open, and the date has to survive.
  const room = 80 - stamp.length;
  const trimmed = title.slice(0, room).trim() || "Conversation";

  return `${trimmed} ${stamp}.md`;
}

function heading(message: Message, assistantName: string): string {
  if (message.role === "user") return "You";
  return assistantName;
}

/**
 * Thinking, tool steps and metrics are left out. They are the workings, not
 * the conversation, and none of it means anything outside the app.
 */
export function chatToMarkdown(
  session: ChatSession,
  options: { assistantName?: string; now?: Date } = {},
): string {
  const assistantName = options.assistantName?.trim() || "Assistant";
  const now = options.now ?? new Date();

  const lines: string[] = [`# ${session.title || "Conversation"}`, ""];
  lines.push(`*Exported from Draggy on ${now.toISOString().slice(0, 10)}*`, "");

  const spoken = session.messages.filter((message) => message.role !== "system");

  if (spoken.length === 0) {
    lines.push("This conversation is empty.", "");
    return lines.join("\n");
  }

  for (const message of spoken) {
    lines.push(`## ${heading(message, assistantName)}`, "");

    const attachments = message.attachments || [];
    if (attachments.length > 0) {
      const names = attachments.map((file) => file.name).join(", ");
      lines.push(`*Attached: ${names}*`, "");
    }

    const text = visibleText(message);
    lines.push(text || "*(no reply)*", "");
  }

  if (session.compaction) {
    // Worth saying: what the model could still see is not what is written here.
    lines.push(
      "---",
      "",
      "*Part of this conversation had been condensed into notes for the model.",
      "The full text is above either way.*",
      "",
    );
  }

  return lines.join("\n");
}
