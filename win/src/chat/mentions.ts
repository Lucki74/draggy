import { useEffect, useState } from "react";
import { relativePath } from "../files/tree";

export interface Mention {
  /** Index of the @ in the text. */
  start: number;
  /** What follows the @ up to the caret. */
  query: string;
}

/** The @word the caret sits at the end of, if any. An @ inside a word (an email address) is not one. */
export function mentionAt(text: string, caret: number): Mention | null {
  const match = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  if (!match) return null;
  return { start: match.index + match[1].length, query: match[2] };
}

/** Replaces the @word with the chosen path and puts the caret after it. */
export function insertMention(text: string, mention: Mention, caret: number, path: string) {
  const written = `@${path} `;
  const after = text.slice(caret).replace(/^\s+/, "");
  return {
    text: text.slice(0, mention.start) + written + after,
    caret: mention.start + written.length,
  };
}

/** Sent by a pane (the file tree's "Attach as context") to add a path to the open composer. */
export const MENTION_EVENT = "draggy:mention";

export function mentionFile(path: string) {
  window.dispatchEvent(new CustomEvent<string>(MENTION_EVENT, { detail: path }));
}

/** Sent by the command palette to put a command's name in the open composer, ready for its value. */
export const FILL_EVENT = "draggy:fill";

export function fillComposer(text: string) {
  window.dispatchEvent(new CustomEvent<string>(FILL_EVENT, { detail: text }));
}

/** The draft with `@path` added at its end, on its own word. */
export function appendMention(text: string, path: string): string {
  const written = `@${path} `;
  if (text.includes(written)) return text;
  return text && !/\s$/.test(text) ? `${text} ${written}` : text + written;
}

const SEARCH_DELAY = 120;
const NO_HITS: string[] = [];

/** Project files matching the query, searched once typing pauses. Empty until one character is typed. */
export function useMentionHits(
  query: string | null,
  search: ((name: string) => Promise<string[]>) | undefined,
): string[] {
  // Hits keep the query they answer, so a stale list is never shown for newer text.
  const [found, setFound] = useState<{ query: string; paths: string[] } | null>(null);

  useEffect(() => {
    if (!search || !query) return;

    let current = true;
    const timer = setTimeout(() => {
      search(query)
        .then((paths) => current && setFound({ query, paths }))
        .catch(() => current && setFound({ query, paths: [] }));
    }, SEARCH_DELAY);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, search]);

  return search && query && found?.query === query ? found.paths : NO_HITS;
}

/** Search hits as paths under the project folder, forward slashes, each once. */
export function relativePaths(root: string, hits: { path: string }[]): string[] {
  return [...new Set(hits.map((hit) => relativePath(root, hit.path)))];
}
