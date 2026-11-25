/** Keeps an automatic window's prompt inside the window it was loaded at, so a long chat or a long
 * run of tool calls shrinks its oldest parts instead of failing as context-too-long. */

interface FitMessage {
  role: string;
  content: string;
  thinking?: string;
  images?: string[];
}

/** The ratio the engine's last real count gives, held between 1.5 and 4. Four is the old guess, and
 * code, JSON and non-English text run well under it. */
export function charsPerToken(checkpoint: { tokens: number; chars: number } | null | undefined): number {
  if (!checkpoint || checkpoint.tokens <= 0 || checkpoint.chars <= 0) return 4;
  return Math.min(4, Math.max(1.5, checkpoint.chars / checkpoint.tokens));
}

/** A llama-server refusal of a prompt longer than the loaded window. */
export class ContextOverflowError extends Error {
  readonly promptTokens: number | null;
  /** A bigger window was tried and would not start, so growing again is pointless. */
  readonly memory: boolean;

  constructor(message: string, promptTokens: number | null = null, memory = false) {
    super(message);
    this.name = "ContextOverflowError";
    this.promptTokens = promptTokens;
    this.memory = memory;
  }
}

const OVERFLOW = /exceeds? the available context size|exceed_context_size|context size has been exceeded/i;

/** The prompt's token count when `text` is the engine refusing it as too long, else null. Zero when
 * it was refused without a count. */
export function readOverflow(text: string): number | null {
  if (!OVERFLOW.test(text)) return null;
  const count = /"?n_prompt_tokens"?\s*[:=]\s*(\d+)/.exec(text);
  return count ? Number(count[1]) : 0;
}

const size = (message: FitMessage, toolChars = 0) =>
  toolChars + message.content.length + (message.thinking?.length ?? 0) + (message.images?.length ?? 0) * 4000;

const total = (wire: FitMessage[], toolChars: number) =>
  wire.reduce((sum, message) => sum + size(message), toolChars);

/** Keeps the head and tail of a long text and says how much was left out between them. */
export function shrinkText(text: string, keep: number): string {
  if (text.length <= keep + 200) return text;
  const head = Math.ceil(keep * 0.7);
  const tail = keep - head;
  const cut = text.length - head - tail;
  return `${text.slice(0, head)}\n[… ${cut} characters left out to fit the context window …]\n${text.slice(text.length - tail)}`;
}

/** Characters of tool output one reply keeps for later turns, and the most any one result keeps. */
const KEPT_RESULTS_CHARS = 16000;
const KEPT_RESULT_CHARS = 4000;

/** A turn's tool output as it is stored on the reply: each result cut to fit with a marker that says
 * so, the whole held under one budget so a long research turn cannot crowd out the chat. */
export function keepToolResults(results: string[]): string[] {
  const kept = results.filter((result) => result.trim());
  if (kept.length === 0) return [];
  const each = Math.max(400, Math.min(KEPT_RESULT_CHARS, Math.floor(KEPT_RESULTS_CHARS / kept.length)));
  return kept.map((result) => shrinkText(result, each));
}

const DROPPED_NOTE = "[Earlier messages were left out to fit the context window.]\n\n";

export interface FitResult {
  fits: boolean;
  /** History messages taken out, all from before `turnStart`. */
  dropped: number;
  changed: boolean;
}

/** Shrinks `wire` in place until it is at most `budget` characters with the tool definitions.
 * Messages from `turnStart` on are this turn's work; the one before it is the user's request,
 * which stays whole along with the system prompt. Oldest and least needed goes first: earlier
 * reasoning, then old tool output, then whole earlier exchanges, then everything long. */
export function fitWire(wire: FitMessage[], budget: number, toolChars: number, turnStart: number): FitResult {
  const result: FitResult = { fits: total(wire, toolChars) <= budget, dropped: 0, changed: false };
  if (result.fits) return result;
  const over = () => total(wire, toolChars) > budget;
  const replace = (at: number, next: FitMessage) => {
    wire[at] = next;
    result.changed = true;
  };

  let request = -1;
  for (let at = Math.min(turnStart, wire.length) - 1; at >= 0; at -= 1) {
    if (wire[at].role === "user") {
      request = at;
      break;
    }
  }
  const firstMovable = wire.findIndex((message) => message.role !== "system");
  const results = () => {
    const found: number[] = [];
    for (let at = Math.max(turnStart, request + 1); at < wire.length; at += 1) {
      if (wire[at].role === "tool" || wire[at].role === "user") found.push(at);
    }
    return found;
  };

  // 1. Reasoning sent back with older replies; the last reply keeps its own.
  const lastAssistant = wire.map((message) => message.role).lastIndexOf("assistant");
  for (let at = 0; at < wire.length && over(); at += 1) {
    if (at !== lastAssistant && wire[at].thinking) {
      const { thinking: _thinking, ...rest } = wire[at];
      replace(at, rest);
    }
  }

  // 2. This turn's older tool output, keeping the two newest whole.
  for (const at of results().slice(0, -2)) {
    if (!over()) break;
    const shrunk = shrinkText(wire[at].content, 1200);
    if (shrunk !== wire[at].content) replace(at, { ...wire[at], content: shrunk });
  }

  // 3. Whole earlier exchanges, oldest first, each up to the next user message.
  while (over() && firstMovable !== -1 && firstMovable < request) {
    let end = firstMovable + 1;
    while (end < request && wire[end].role !== "user") end += 1;
    wire.splice(firstMovable, end - firstMovable);
    result.dropped += end - firstMovable;
    result.changed = true;
    request -= end - firstMovable;
    turnStart -= end - firstMovable;
  }
  if (result.dropped > 0 && request >= 0 && !wire[request].content.startsWith(DROPPED_NOTE)) {
    wire[request] = { ...wire[request], content: DROPPED_NOTE + wire[request].content };
  }

  // 4. Anything long, newest results included; the request and the system prompt stay whole.
  const newestReply = wire.map((message) => message.role).lastIndexOf("assistant");
  for (const keep of [600, 200]) {
    for (let at = 0; at < wire.length && over(); at += 1) {
      if (at === request || wire[at].role === "system") continue;
      const shrunk = shrinkText(wire[at].content, keep);
      if (shrunk !== wire[at].content) replace(at, { ...wire[at], content: shrunk });
      if (wire[at].thinking && at === newestReply) {
        const { thinking: _thinking, ...rest } = wire[at];
        replace(at, rest);
      }
    }
  }

  result.fits = !over();
  return result;
}
