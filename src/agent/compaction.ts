import { KEEP_ALIVE, OLLAMA_HOST, beginOllamaWork } from "../ollama";
import { ggufModelName, isGgufModel } from "../ai/engineAdapter";
import { safeJsonParse } from "../utils";
import type { CompactionState, Message } from "../types";

/** Folds the older part of a chat into notes, so it never hits the context wall. Appends rather
 * than rewrites, triggers off the model's maximum, and runs after a turn. */

/** Roughly how many characters a token is worth, for budget arithmetic. */
export const CHARS_PER_TOKEN = 4;

/** How full the window may get before folding. Higher and the reply stops fitting; lower and the
 * folds cost more than they save. */
export const COMPACT_AT = 0.6;

/** Messages kept verbatim at the end, about three turns. Recency is what "it" and "the second one"
 * refer to, and a summary is the wrong shape for that. */
export const KEEP_RECENT_MESSAGES = 6;

/** The smallest fold worth doing. Folding two messages saves nothing and still invalidates the
 * cached prefix. */
export const MIN_FOLD_MESSAGES = 4;

/** How long a summary may run, so folding cannot itself fill the window. */
export const SUMMARY_CHAR_BUDGET = 3000;

/** Per message, in the transcript handed to the summariser. */
const TRANSCRIPT_MESSAGE_LIMIT = 4000;

/** Tokens the summariser may produce. Bounded so a fold cannot run away. */
const SUMMARY_NUM_PREDICT = 600;

export interface CompactionPlan {
  /** Where this fold starts: the end of whatever was already folded. */
  foldFrom: number;
  /** Exclusive. Messages below this index are represented by the summary. */
  foldThrough: number;
}

export interface PlanOptions {
  existing?: CompactionState | null;
  /** Characters the conversation may occupy before folding is worth it. */
  budgetChars: number;
  keepRecent?: number;
  minFold?: number;
}

/** What one message costs on the wire, near enough for a budget. */
export function messageChars(message: Message): number {
  let total = (message.content || "").length;

  for (const attachment of message.attachments || []) {
    total += attachment.name.length + (attachment.content?.length || 0);
  }

  return total;
}

/** Tokens of conversation a fold puts into the notes, near enough to show. */
export function foldedTokens(messages: Message[], plan: CompactionPlan): number {
  let chars = 0;

  for (let index = plan.foldFrom; index < plan.foldThrough; index++) {
    const message = messages[index];
    if (message) chars += messageChars(message);
  }

  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/** The fold the user asked for. Everything but the last exchange goes into the notes, however far
 * under the limit the conversation is. */
export function planManualCompaction(
  messages: Message[],
  existing?: CompactionState | null,
): CompactionPlan | null {
  return planCompaction(messages, {
    existing,
    budgetChars: 1,
    keepRecent: 2,
    minFold: 2,
  });
}

/** What the whole conversation costs, counting a summary already in place. */
export function conversationChars(
  messages: Message[],
  existing?: CompactionState | null,
): number {
  const from = existing?.throughIndex ?? 0;
  let total = existing ? existing.summary.length : 0;

  for (let index = from; index < messages.length; index++) {
    total += messageChars(messages[index]);
  }

  return total;
}

/** Decides whether to fold, and where. Null when it still fits, when there is too little new
 * material, or when there is no clean boundary. */
export function planCompaction(
  messages: Message[],
  options: PlanOptions,
): CompactionPlan | null {
  const {
    existing = null,
    budgetChars,
    keepRecent = KEEP_RECENT_MESSAGES,
    minFold = MIN_FOLD_MESSAGES,
  } = options;

  if (budgetChars <= 0) return null;

  const foldFrom = existing?.throughIndex ?? 0;
  if (foldFrom > messages.length) return null;

  if (conversationChars(messages, existing) <= budgetChars) return null;

  // Never touch the tail, however far over budget the conversation is.
  const ceiling = messages.length - keepRecent;
  if (ceiling - foldFrom < minFold) return null;

  // Fold up to a user message, so what remains starts with someone asking
  // something rather than half of an exchange.
  let foldThrough = -1;
  for (let index = ceiling; index > foldFrom; index--) {
    if (messages[index]?.role === "user") {
      foldThrough = index;
      break;
    }
  }

  if (foldThrough < 0 || foldThrough - foldFrom < minFold) return null;

  return { foldFrom, foldThrough };
}

/** The messages of a fold, for the summariser. Attachments are named but not included: 50 KB of
 * spreadsheet would consume the whole summary. */
export function renderTranscript(messages: Message[]): string {
  return messages
    .map((message) => {
      const who = message.role === "user" ? "User" : "Assistant";
      const body = (message.content || "").slice(0, TRANSCRIPT_MESSAGE_LIMIT).trim();

      const files = (message.attachments || [])
        .map((attachment) => attachment.name)
        .join(", ");

      const noted = files ? `\n[attached: ${files}]` : "";
      return `${who}: ${body || "(no text)"}${noted}`;
    })
    .join("\n\n");
}

const SUMMARY_SYSTEM = `You compress a conversation so it can be carried forward in a smaller space. You are not talking to anyone: you are writing notes that another assistant will rely on as its only record of what came before.

Write facts, not narration. "The user is working on a project and asked several questions" is worthless. "Budget is 4200 GBP; deadline 14 March; user rejected Postgres and chose SQLite" is what this is for.

Keep, in this order of priority: decisions reached and the reasons for them; names, numbers, dates, versions, paths, identifiers and exact quotes that matter; what the user is trying to achieve; anything the user asked for that has not been delivered yet; corrections the user made.

Drop: pleasantries, restatements, your own reasoning, anything already superseded by a later message.

Write plain prose or short dashed lines. No headings, no preamble, no closing remark. Do not address the user. Do not say "the conversation" or "in summary". Start with the first fact.`;

/** Extends a summary rather than rewriting it. A rewrite changes the front of the wire, throwing
 * away the cached prefix on every fold. */
export function buildSummaryMessages(
  previous: string | null,
  slice: Message[],
): { role: "system" | "user"; content: string }[] {
  const transcript = renderTranscript(slice);

  const instruction = previous
    ? `Here are notes already written about the earlier part of this conversation:

${previous}

Below is what happened next. Write ONLY the notes for this new part. Do not repeat, rewrite or refer back to the notes above. What you write will be appended to them.

${transcript}`
    : `Write the notes for this conversation.

${transcript}`;

  return [
    { role: "system", content: SUMMARY_SYSTEM },
    { role: "user", content: instruction },
  ];
}

/** How the summary appears on the wire, framed as a record: a bare block of facts in the user role
 * gets answered rather than absorbed. */
export function renderCompactionBlock(state: CompactionState): string {
  return `[Record of the earlier part of this conversation, condensed to save space. These are established facts, not a new question. Continue from the messages that follow.]

${state.summary}

[End of record. The conversation continues below, in full.]`;
}

/** Joins a new section onto an existing summary without disturbing it. */
export function appendSummary(previous: string | null, addition: string): string {
  const next = addition.trim();
  if (!previous) return next;
  if (!next) return previous;
  return `${previous}\n\n${next}`;
}

/** Trims an oversized summary, oldest first. The one operation that disturbs the prefix, and only
 * when the notes themselves have become the problem. */
export function trimSummary(summary: string, budget = SUMMARY_CHAR_BUDGET): string {
  if (summary.length <= budget) return summary;

  const sections = summary.split("\n\n");
  while (sections.length > 1 && sections.join("\n\n").length > budget) {
    sections.shift();
  }

  return sections.join("\n\n").slice(-budget);
}

export interface CompactionRequest {
  model: string;
  numCtx: number;
  messages: Message[];
  plan: CompactionPlan;
  existing?: CompactionState | null;
  signal?: AbortSignal;
}

/** Runs the fold, the only impure thing here. `numCtx` must pass through unchanged, or Ollama
 * reloads the weights and the fold stops being invisible. */
export async function runCompaction(
  request: CompactionRequest,
): Promise<CompactionState | null> {
  const end = beginOllamaWork();
  try {
    return await fold(request);
  } finally {
    end();
  }
}

async function fold(request: CompactionRequest): Promise<CompactionState | null> {
  const { model, numCtx, messages, plan, existing = null, signal } = request;

  const slice = messages.slice(plan.foldFrom, plan.foldThrough);
  if (slice.length === 0) return null;

  const isGguf = isGgufModel(model);
  const summaryMessages = buildSummaryMessages(existing?.summary ?? null, slice);
  const url = isGguf ? "http://127.0.0.1:11435/v1/chat/completions" : `${OLLAMA_HOST}/api/chat`;
  const body = isGguf
    ? JSON.stringify({
        model: ggufModelName(model),
        stream: false,
        temperature: 0.2,
        max_tokens: SUMMARY_NUM_PREDICT,
        messages: summaryMessages,
      })
    : JSON.stringify({
        model,
        stream: false,
        think: false,
        keep_alive: KEEP_ALIVE,
        options: {
          num_ctx: numCtx,
          num_predict: SUMMARY_NUM_PREDICT,
          temperature: 0.2,
        },
        messages: summaryMessages,
      });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal,
  });

  if (!response.ok) return null;

  const rawText = await response.text();
  const parsed = safeJsonParse<{
    message?: { content?: string };
    choices?: [{ message?: { content?: string } }];
  }>(rawText);
  const written = (isGguf ? parsed?.choices?.[0]?.message?.content : parsed?.message?.content)?.trim();

  // A model that returns nothing has not compacted anything, and recording an
  // empty summary would throw the folded messages away for good.
  if (!written) return null;

  const summary = trimSummary(appendSummary(existing?.summary ?? null, written));

  return {
    throughIndex: plan.foldThrough,
    summary,
    updatedAt: Date.now(),
  };
}

/** Whether a summary still describes this conversation. Editing inside the folded range rewrites
 * what it claims, so it goes and is rebuilt when idle. */
export function compactionSurvives(
  state: CompactionState | null | undefined,
  messages: Message[],
  editedIndex?: number,
): CompactionState | null {
  if (!state) return null;
  if (state.throughIndex > messages.length) return null;
  if (typeof editedIndex === "number" && editedIndex < state.throughIndex) return null;
  return state;
}
