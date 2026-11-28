import type { ApprovalAnswer } from "../types";
import type { ApprovalRequest } from "../agent/agentLoop";

/** Telegram refuses a message over 4096 characters; replies are cut a little under that. */
export const TELEGRAM_CHUNK = 4000;

/** A long reply as messages Telegram accepts, cut at a blank line, a line or a space when one is near. */
export function chunkReply(text: string, size = TELEGRAM_CHUNK): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > size) {
    const window = rest.slice(0, size);
    let cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(" "));
    if (cut < size / 2) cut = size;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

/** The answer a button gives. Only one-time approval exists on Telegram: nothing is remembered. */
export function answerFor(allow: boolean): ApprovalAnswer {
  return allow ? "once" : "no";
}

/** The question shown above the Allow once / Don't buttons. */
export function approvalText(approval: ApprovalRequest, labels: { ask: string }): string {
  const target = approval.target ? `\n${approval.target.slice(0, 600)}` : "";
  return `${labels.ask} ${approval.tool}${target}\n${approval.reason}`.slice(0, 1500);
}

/** Which Draggy chat a Telegram chat talks to. Kept so a restart carries on in the same chat. */
export type ChatMap = Record<string, string>;

export function readChatMap(raw: string | null): ChatMap {
  try {
    const value = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== "object") return {};
    const out: ChatMap = {};
    for (const [key, id] of Object.entries(value)) if (typeof id === "string") out[key] = id;
    return out;
  } catch {
    return {};
  }
}

/** The chat for a Telegram chat id: the mapped one, or the new id when there is none yet or `fresh` asks. */
export function resolveChat(map: ChatMap, telegramChatId: string, newId: string, fresh = false): { chatId: string; created: boolean; map: ChatMap } {
  const known = map[telegramChatId];
  if (known && !fresh) return { chatId: known, created: false, map };
  return { chatId: newId, created: true, map: { ...map, [telegramChatId]: newId } };
}

/** The Telegram chat a Draggy chat belongs to, if any. */
export function telegramChatOf(map: ChatMap, chatId: string): string | null {
  return Object.keys(map).find((key) => map[key] === chatId) ?? null;
}
