import { useEffect, useState } from "react";
import type { ChatSearchHit } from "../storage";

export const RECALL_DEBOUNCE_MS = 200;

/** One hit per chat, in rank order, keeping only chats the sidebar currently lists. */
export function recallResults(hits: ChatSearchHit[], visibleIds: Set<string>): ChatSearchHit[] {
  const seen = new Set<string>();
  const out: ChatSearchHit[] = [];
  for (const hit of hits) {
    if (!visibleIds.has(hit.chatId) || seen.has(hit.chatId)) continue;
    seen.add(hit.chatId);
    out.push(hit);
  }
  return out;
}

/** Full-text search over past chats, debounced. An empty query yields null: show the normal list. */
export function useChatRecall(query: string): ChatSearchHit[] | null {
  const [hits, setHits] = useState<ChatSearchHit[] | null>(null);
  const term = query.trim();

  useEffect(() => {
    if (!term) return;
    let stale = false;
    const timer = window.setTimeout(() => {
      void import("../storage")
        .then(({ storageBackend }) => storageBackend().searchSessions(term))
        .then((found) => {
          if (!stale) setHits(found);
        })
        .catch(() => {
          if (!stale) setHits([]);
        });
    }, RECALL_DEBOUNCE_MS);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [term]);

  return term ? hits : null;
}
