import { beginLlamaWork } from "../llama";
import { ggufModelName } from "../ai/engineAdapter";
import { chatEndpoint } from "../ai/providers";
import { loggedFetch } from "../logger";
import { safeJsonParse } from "../utils";
import type { AppSettings, Message, SearchStep, SkillDraftSource } from "../types";

/** A turn this long is worth offering to write down. */
export const SKILL_DRAFT_MIN_TOOL_CALLS = 5;
const MAX_TOOL_LINES = 40;
const MAX_ASK_CHARS = 1500;
const DRAFT_TOKENS = 1200;
export const SKILL_NAME_MAX = 64;

/** Fired on window by the skill card when its offer is finished with. Detail: { chatId, messageId }. */
export const SKILL_DRAFT_DONE_EVENT = "draggy:skill-draft-done";

export interface SkillDraft {
  name: string;
  description: string;
  body: string;
}

export interface OfferInput {
  settings: Pick<AppSettings, "skillSuggestions">;
  /** True when the turn ran in a project folder, which is what Code mode is. */
  codeMode: boolean;
  aborted: boolean;
  failed: boolean;
  toolCalls: Record<string, number> | undefined;
}

export function totalToolCalls(toolCalls: Record<string, number> | undefined): number {
  return Object.values(toolCalls ?? {}).reduce((sum, count) => sum + Number(count), 0);
}

/** Whether a finished turn earns the offer: it worked, in Code, through enough tool calls, and the user has not turned it off. */
export function shouldOfferSkillDraft(input: OfferInput): boolean {
  if (input.settings.skillSuggestions === false) return false;
  if (!input.codeMode || input.aborted || input.failed) return false;
  return totalToolCalls(input.toolCalls) >= SKILL_DRAFT_MIN_TOOL_CALLS;
}

/** The user's last real message, which is what the turn answered. */
export function lastAsk(messages: Message[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "user" && !message.notice) return (message.textContent ?? message.content ?? "").trim();
  }
  return "";
}

/** One line per tool step, in the order they ran. */
export function toolSequence(steps: SearchStep[] | undefined): string[] {
  const lines: string[] = [];
  for (const step of steps ?? []) {
    if (!step.tool || step.type === "tool_call") continue;
    const detail = (step.content ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
    lines.push(detail ? `${step.tool}: ${detail}` : step.tool);
    if (lines.length >= MAX_TOOL_LINES) break;
  }
  return lines;
}

export function buildDraftSource(chatId: string, model: string, messages: Message[], steps: SearchStep[] | undefined): SkillDraftSource {
  return { chatId, model, ask: lastAsk(messages).slice(0, MAX_ASK_CHARS), tools: toolSequence(steps) };
}

export function draftMessages(source: SkillDraftSource): { role: "system" | "user"; content: string }[] {
  return [
    {
      role: "system",
      content:
        "You write reusable skills for a coding assistant. A skill is a SKILL.md file. Reply with the file only, no code fence and no commentary.\n" +
        "Format:\n---\nname: short-lowercase-hyphenated-name\ndescription: One sentence saying what it does and when to use it.\n---\n\n## When to use\n...\n\n## Steps\n1. ...\n\n" +
        "Generalise: describe the method, not this one task's file names or values.",
    },
    {
      role: "user",
      content: `The user asked:\n${source.ask || "(unknown)"}\n\nThe assistant then used these tools, in order:\n${source.tools.join("\n") || "(none recorded)"}\n\nWrite the skill that would let it do this kind of task again.`,
    },
  ];
}

/** A folder name from whatever the model called the skill. */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SKILL_NAME_MAX)
    .replace(/-+$/g, "");
  return slug;
}

/** Reads the model's reply as a draft. Tolerates a code fence and a think block; returns null without a name, description and body. */
export function parseSkillDraft(raw: string): SkillDraft | null {
  let text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .replace(/\r\n/g, "\n")
    .trim();
  const fence = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(text);
  if (fence) text = fence[1].trim();

  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) return null;

  const field = (key: string) => {
    const line = new RegExp(`^${key}:[ \\t]*(.*)$`, "im").exec(match[1]);
    return (line?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
  };
  const name = slugify(field("name"));
  const description = field("description").replace(/\s+/g, " ");
  const body = match[2].trim();
  if (!name || !description || !body) return null;
  return { name, description, body };
}

/** Asks the model for the draft in one reply, with no tools. Null when it fails or writes something unusable. */
export async function requestSkillDraft(model: string, source: SkillDraftSource, signal?: AbortSignal): Promise<SkillDraft | null> {
  const end = beginLlamaWork(model);
  try {
    const response = await loggedFetch(chatEndpoint(model), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ggufModelName(model),
        stream: false,
        temperature: 0.3,
        max_tokens: DRAFT_TOKENS,
        messages: draftMessages(source),
        chat_template_kwargs: { enable_thinking: false },
        think: false,
      }),
      signal,
    });
    if (!response.ok) return null;
    const parsed = safeJsonParse<{ choices?: [{ message?: { content?: string; reasoning_content?: string } }] }>(await response.text());
    const choice = parsed?.choices?.[0]?.message;
    return parseSkillDraft(choice?.content?.trim() || choice?.reasoning_content?.trim() || "");
  } finally {
    end();
  }
}
