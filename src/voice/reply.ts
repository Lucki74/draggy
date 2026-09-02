import { OLLAMA_HOST, readNdjsonStream } from "../ollama";
import { VOICE_SEARCH_MARKER } from "../prompts";
import {
  KEEP_ALIVE,
  VOICE_CONTEXT,
  VOICE_NUM_PREDICT,
  VOICE_REPEAT_PENALTY,
  VOICE_TEMPERATURE,
  VOICE_TOP_P,
} from "./constants";

/**
 * Turns a question into words to say, handing text on the instant it can. Only
 * the first seven characters wait, in case they become a "SEARCH:" marker.
 */

export interface VoiceTurn {
  role: "user" | "assistant";
  content: string;
}

const MARKER_PROBE = "SEARCH:";

/** Everything that is not a letter or a colon, so "SEARCH :" still matches. */
function probe(head: string): string {
  return head.replace(/\s+/g, "").toUpperCase();
}

/**
 * Whether the reply could still be a search request. True holds the text back;
 * false sends every character straight to the synthesiser.
 */
export function markerPending(head: string): boolean {
  const seen = probe(head);
  if (seen.length === 0) return true;
  if (seen.length >= MARKER_PROBE.length) return false;
  return MARKER_PROBE.startsWith(seen);
}

export function isMarker(head: string): boolean {
  return probe(head).startsWith(MARKER_PROBE);
}

/** The keywords out of a "SEARCH: ..." line, or null if it is not one. */
export function searchQuery(line: string): string | null {
  const match = line.split("\n")[0].match(VOICE_SEARCH_MARKER);
  const query = match?.[1]?.trim();
  return query ? query : null;
}

/** The part of a marker line after the colon, however it was spaced. */
function queryTail(head: string): string {
  const colon = head.indexOf(":");
  return colon === -1 ? "" : head.slice(colon + 1);
}

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

/**
 * Drops private reasoning out of speech. A template that writes `<think>` into
 * the reply would otherwise have every word of it read out loud.
 */
export function createThinkFilter(): (delta: string) => string {
  let buffer = "";
  let thinking = false;

  /** How much of the tail could be the beginning of `tag`. */
  const partial = (text: string, tag: string): number => {
    const most = Math.min(text.length, tag.length - 1);
    for (let length = most; length > 0; length--) {
      if (tag.startsWith(text.slice(text.length - length))) return length;
    }
    return 0;
  };

  return (delta) => {
    buffer += delta;
    let out = "";

    for (;;) {
      if (thinking) {
        const close = buffer.indexOf(THINK_CLOSE);
        if (close === -1) {
          // Keep only what could be part of the closing tag.
          buffer = buffer.slice(buffer.length - partial(buffer, THINK_CLOSE));
          return out;
        }
        buffer = buffer.slice(close + THINK_CLOSE.length);
        thinking = false;
        continue;
      }

      const open = buffer.indexOf(THINK_OPEN);
      if (open === -1) break;

      out += buffer.slice(0, open);
      buffer = buffer.slice(open + THINK_OPEN.length);
      thinking = true;
    }

    const held = partial(buffer, THINK_OPEN);
    out += buffer.slice(0, buffer.length - held);
    buffer = buffer.slice(buffer.length - held);
    return out;
  };
}

export interface StreamOptions {
  model: string;
  messages: { role: string; content: string }[];
  signal?: AbortSignal;
  /** Returning false ends the stream early. */
  onDelta: (delta: string) => boolean | void;
}

export async function streamVoiceChat(options: StreamOptions): Promise<void> {
  const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      stream: true,
      // `think` is deliberately unset. False stops Ollama parsing reasoning,
      // not producing it, so deliberation arrives in `content` and is spoken.
      keep_alive: KEEP_ALIVE,
      options: {
        num_ctx: VOICE_CONTEXT,
        num_predict: VOICE_NUM_PREDICT,
        temperature: VOICE_TEMPERATURE,
        top_p: VOICE_TOP_P,
        repeat_penalty: VOICE_REPEAT_PENALTY,
      },
      messages: options.messages,
    }),
    signal: options.signal,
  });

  if (!response.ok) throw new Error(`Ollama returned ${response.status}`);

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Ollama sent no response stream");

  await readNdjsonStream(reader, (chunk) => {
    const message = chunk.message as { content?: string } | undefined;
    const delta = message?.content;
    if (!delta) return;
    return options.onDelta(delta);
  });
}

export interface ReplyRequest {
  model: string;
  system: string;
  /** The conversation so far, oldest first. */
  turns: VoiceTurn[];
  searchEnabled: boolean;
  signal: AbortSignal;
  /**
   * Runs a web search and returns something the model can read. Injected so
   * this module never reaches for the Electron bridge itself.
   */
  search: (query: string) => Promise<string>;
}

export interface ReplyEvents {
  /** Words the user should hear, as early as they can be said. */
  onSpeech: (piece: string) => void;
  /** The model asked for the web before it would answer. */
  onSearch: (query: string) => void;
}

export interface ReplyResult {
  /** Everything handed to the synthesiser. */
  spoken: string;
  /** The query that was run, if one was. */
  searched: string | null;
}

type Mode = "sniff" | "speak" | "query" | "drop";

/**
 * One spoken answer, with the web round trip if asked. The second pass may not
 * search again: a model handed results will otherwise ask for more of them.
 */
export async function generateReply(
  request: ReplyRequest,
  events: ReplyEvents,
): Promise<ReplyResult> {
  const messages = [
    { role: "system", content: request.system },
    ...request.turns.map((turn) => ({ role: turn.role, content: turn.content })),
  ];

  let spoken = "";

  const speak = (piece: string) => {
    if (!piece) return;
    spoken += piece;
    events.onSpeech(piece);
  };

  const runPass = async (canSearch: boolean): Promise<string | null> => {
    // Widened deliberately: every later change happens inside the stream
    // callback, which control-flow analysis cannot see.
    let mode = (request.searchEnabled ? "sniff" : "speak") as Mode;
    let head = "";
    let query = "";

    const unthink = createThinkFilter();

    await streamVoiceChat({
      model: request.model,
      messages,
      signal: request.signal,
      onDelta: (raw) => {
        const delta = unthink(raw);
        if (!delta) return;
        if (mode === "speak") {
          speak(delta);
          return;
        }

        if (mode === "query" || mode === "drop") {
          const line = delta.indexOf("\n");
          if (mode === "query") query += line === -1 ? delta : delta.slice(0, line);
          if (line === -1) return;

          // The marker line is over: either the query is complete, or the
          // line was swallowed and the answer starts here.
          if (mode === "query") return false;
          mode = "speak";
          speak(delta.slice(line + 1));
          return;
        }

        head += delta;

        if (isMarker(head)) {
          mode = canSearch ? "query" : "drop";
          const tail = queryTail(head);
          const line = tail.indexOf("\n");

          if (mode === "query") {
            query = line === -1 ? tail : tail.slice(0, line);
            if (line !== -1) return false;
            return;
          }

          if (line !== -1) {
            mode = "speak";
            speak(tail.slice(line + 1));
          }
          return;
        }

        if (markerPending(head)) return;

        mode = "speak";
        speak(head);
      },
    });

    // A reply shorter than the marker probe never left the sniffing state, so
    // its few characters are still sitting in the buffer.
    if (mode === "sniff") speak(head);

    return mode === "query" ? query.trim() || null : null;
  };

  const query = await runPass(request.searchEnabled);
  if (!query) return { spoken, searched: null };

  events.onSearch(query);
  const findings = await request.search(query);
  if (request.signal.aborted) return { spoken, searched: query };

  messages.push({
    role: "user",
    content: findings
      ? `Web results for "${query}":\n${findings}\n\nAnswer out loud from these, in one or two spoken sentences.`
      : `The search for "${query}" found nothing. Say so in a few words, then answer from what you already know.`,
  });

  await runPass(false);
  return { spoken, searched: query };
}

/** The handful of results a spoken answer can actually be built from. */
export function summariseResults(
  results: { title: string; snippet: string }[],
  limit = 5,
): string {
  return results
    .slice(0, limit)
    .map((result, index) => `${index + 1}. ${result.title}. ${result.snippet}`)
    .join("\n");
}
