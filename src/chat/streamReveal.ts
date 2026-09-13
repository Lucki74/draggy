import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Element, Root } from "hast";

/** How a streamed reply is shown: a word at a time, at a pace set by how much is waiting, each word
 * fading in. The timing lives here, apart from React, so it can be tested. */

/** How long a word takes to fade in. Past this it is plain text again. */
export const FADE_MS = 380;

/** How far behind the stream the reveal runs: enough to even out bursts, too little to feel slow. */
const TARGET_LAG_MS = 240;

/** Once the stream has ended, what is left is shown within this long. */
const FINISH_MS = 260;

const MIN_CHARS_PER_SECOND = 40;

/** The slowest the rest goes once the stream has ended, so the end never trails off. */
const MIN_FINISH_CHARS_PER_SECOND = 900;

/** A run with no space in it, a long URL say, is revealed in pieces rather than held back whole. */
const MAX_WORD_CHARS = 24;

const isSpace = (code: number) =>
  code === 32 || code === 10 || code === 9 || code === 13 || code === 12 || code === 0xa0;

/** CJK text has no spaces, so each character counts as a word of its own. */
const isWide = (code: number) =>
  (code >= 0x3000 && code <= 0x9fff) ||
  (code >= 0xac00 && code <= 0xd7af) ||
  (code >= 0xf900 && code <= 0xfaff) ||
  (code >= 0xff00 && code <= 0xffef);

/** Where the next word ends, from `from`, or `from` itself when none is ready yet. A word still
 * arriving at the end of a live stream waits for the rest of it. */
export function nextWordEnd(text: string, from: number, streaming: boolean): number {
  let index = from;
  while (index < text.length && isSpace(text.charCodeAt(index))) index++;
  if (index >= text.length) return streaming ? from : text.length;

  const start = index;
  while (index < text.length && !isSpace(text.charCodeAt(index))) {
    const wide = isWide(text.charCodeAt(index));
    if (wide && index > start) break;
    index++;
    if (wide || index - start >= MAX_WORD_CHARS) return index;
  }

  return index >= text.length && streaming ? from : index;
}

export interface RevealState {
  position: number;
  /** Characters earned but not yet spent on a whole word. */
  budget: number;
}

/** One frame of the reveal. The speed follows the backlog, so bursts spread out evenly and a stall
 * never leaves the reveal far behind. */
export function advanceReveal(
  text: string,
  state: RevealState,
  elapsedMs: number,
  streaming: boolean,
): RevealState {
  const waiting = text.length - state.position;
  if (waiting <= 0) return { position: Math.min(state.position, text.length), budget: 0 };

  const speed = streaming
    ? Math.max(MIN_CHARS_PER_SECOND, (waiting * 1000) / TARGET_LAG_MS)
    : Math.max(MIN_FINISH_CHARS_PER_SECOND, (waiting * 1000) / FINISH_MS);

  let budget = state.budget + (speed * Math.max(0, elapsedMs)) / 1000;
  let position = state.position;

  for (;;) {
    const end = nextWordEnd(text, position, streaming);
    if (end <= position || end - position > budget) break;
    budget -= end - position;
    position = end;
  }

  // With nothing ready the budget is dropped, or it would come out later as a burst.
  if (nextWordEnd(text, position, streaming) <= position) budget = 0;

  return { position, budget };
}

export interface RevealMark {
  at: number;
  position: number;
}

/** How far the reveal had got a whole fade ago: everything before it has finished fading in. */
export function settledPosition(marks: RevealMark[], now: number): number {
  let settled = 0;
  for (const mark of marks) {
    if (mark.at > now - FADE_MS) break;
    settled = mark.position;
  }
  return settled;
}

/** How much two versions of a stream agree on, for a reply rewritten rather than extended. */
export function sharedPrefix(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let index = 0;
  while (index < limit && a.charCodeAt(index) === b.charCodeAt(index)) index++;
  return index;
}

const blockParser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

/** Where each top-level block starts. A finished block never changes, so only the last is rendered
 * again as the stream grows. */
export function blockStarts(source: string, previous?: { source: string; starts: number[] }): number[] {
  // Only the last two blocks can still change shape, so a stream that grew is parsed from there.
  let base = 0;
  let kept: number[] = [];
  if (previous && source.startsWith(previous.source) && previous.starts.length > 2) {
    base = previous.starts[previous.starts.length - 2];
    kept = previous.starts.slice(0, -2);
  }

  const tree = blockParser.parse(source.slice(base));
  const found = tree.children.map((child) => base + (child.position?.start.offset ?? 0));

  const starts = [...kept, ...found];
  if (starts.length === 0 || starts[0] !== 0) starts.unshift(0);
  return starts;
}

/** Inside these a word is not wrapped: code keeps its layout and maths its own markup. */
const UNWRAPPED_TAGS = new Set(["pre", "code", "svg", "math", "script", "style"]);

const classesOf = (element: Element): string[] => {
  const value = element.properties?.className;
  return Array.isArray(value) ? value.map(String) : typeof value === "string" ? value.split(" ") : [];
};

function wrapWords(parent: Root | Element, from: number) {
  const next: (typeof parent.children)[number][] = [];

  for (const child of parent.children) {
    if (child.type === "element") {
      const skipped =
        UNWRAPPED_TAGS.has(child.tagName) || classesOf(child).some((name) => name.startsWith("katex"));
      if (!skipped) wrapWords(child, from);
      next.push(child);
      continue;
    }

    // Maths rendered by KaTeX has no source position, and so no place in the reveal.
    if (child.type !== "text" || !child.position || child.position.start.offset === undefined) {
      next.push(child);
      continue;
    }

    const base = child.position.start.offset;
    let offset = 0;
    let plain = "";

    for (const piece of child.value.split(/(\s+)/)) {
      if (!piece) continue;
      const at = base + offset;
      offset += piece.length;

      if (at < from || /^\s+$/.test(piece)) {
        plain += piece;
        continue;
      }

      if (plain) next.push({ type: "text", value: plain });
      plain = "";
      next.push({
        type: "element",
        tagName: "span",
        properties: { className: ["stream-word"] },
        children: [{ type: "text", value: piece }],
      });
    }

    if (plain) next.push({ type: "text", value: plain });
  }

  parent.children = next as typeof parent.children;
}

/** Wraps each word at or after `from`, a source offset, in a span that fades in. Words before it
 * have finished fading and stay plain text. */
export function rehypeStreamWords(options: { from: number }) {
  return (tree: Root) => wrapWords(tree, options.from);
}
