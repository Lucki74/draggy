import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Element, Root } from "hast";
import { VOID_TAGS } from "./rehypeVoid";

/** How a streamed reply is shown: a word at a time, at a pace set by how much is waiting.
 * The timing lives here, apart from React, so it can be tested. */

/** How far behind the stream the reveal runs: enough to even out bursts, too little to feel slow. */
const TARGET_LAG_MS = 320;

/** Once the stream has ended, what is left is shown within this long. */
const FINISH_MS = 260;

const MIN_CHARS_PER_SECOND = 30;

/** The slowest the rest goes once the stream has ended, so the end never trails off. */
const MIN_FINISH_CHARS_PER_SECOND = 900;

/** The longest a run without spaces is revealed as one piece, as in CJK text or a long URL. */
export const MAX_WORD_CHARS = 24;

const isSpace = (code: number) =>
  code === 32 || code === 10 || code === 9 || code === 13 || code === 12 || code === 0xa0;

/** Where the next word ends, trailing spaces included, or `from` itself when none is ready yet. A
 * word still arriving at the end of a live stream waits for the rest of it. */
export function nextWordEnd(text: string, from: number, streaming: boolean): number {
  let index = from;
  while (index < text.length && isSpace(text.charCodeAt(index))) index++;

  const start = index;
  while (index < text.length && !isSpace(text.charCodeAt(index)) && index - start < MAX_WORD_CHARS) {
    index++;
  }
  if (index >= text.length) return streaming && index > start ? from : text.length;
  if (!isSpace(text.charCodeAt(index))) return index;

  while (index < text.length && isSpace(text.charCodeAt(index))) index++;
  return index;
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

/** The caret stays out of these: code keeps its layout and maths its own markup. Void elements
 * are here too, since they cannot hold children (see rehypeVoidGuard). */
const UNWRAPPED_TAGS = new Set(["pre", "code", "svg", "math", "script", "style", ...VOID_TAGS]);

const classesOf = (element: Element): string[] => {
  const value = element.properties?.className;
  return Array.isArray(value) ? value.map(String) : typeof value === "string" ? value.split(" ") : [];
};

/** Puts the ember caret after the last word written, inside the innermost block holding it, so it
 * sits on the line being written rather than under it. Code and maths are left alone. */
export function rehypeCaret() {
  return (tree: Root) => {
    let node: Root | Element = tree;
    for (;;) {
      const last: (typeof node.children)[number] | undefined = [...node.children]
        .reverse()
        .find((child) => !(child.type === "text" && !child.value.trim()));
      if (
        last?.type !== "element" ||
        UNWRAPPED_TAGS.has(last.tagName) ||
        classesOf(last).some((name) => name.startsWith("katex"))
      ) {
        break;
      }
      node = last;
    }
    node.children.push({
      type: "element",
      tagName: "span",
      properties: { className: ["ember-caret"], ariaHidden: "true" },
      children: [],
    });
  };
}

/** Wraps each word in a span that fades in when it is added. A word already on screen keeps its
 * place in the tree, so its fade never starts over. Code and maths keep their own markup. */
export function rehypeWordFade() {
  const wrap = (parent: Root | Element) => {
    const children: (typeof parent.children)[number][] = [];
    for (const child of parent.children) {
      if (child.type === "text") {
        for (const piece of child.value.split(/(\s+)/)) {
          if (!piece) continue;
          children.push(
            /^\s+$/.test(piece)
              ? { type: "text", value: piece }
              : {
                  type: "element",
                  tagName: "span",
                  properties: { className: ["stream-word"] },
                  children: [{ type: "text", value: piece }],
                },
          );
        }
        continue;
      }
      if (
        child.type === "element" &&
        !UNWRAPPED_TAGS.has(child.tagName) &&
        !classesOf(child).some((name) => name.startsWith("katex"))
      ) {
        wrap(child);
      }
      children.push(child);
    }
    parent.children = children;
  };
  return (tree: Root) => wrap(tree);
}
