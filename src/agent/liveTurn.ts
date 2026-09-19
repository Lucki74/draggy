import { useCallback, useSyncExternalStore } from "react";

/** A turn as it runs, for the speed line and the context meter. Kept out of the conversation, so
 * figures that change every quarter second are neither saved nor re-render the whole chat. */
export interface LiveTurn {
  /** Tokens written so far. Counted from the stream while it runs, so an estimate until each pass
   * ends, when the engine gives the real figure. */
  responseTokens: number;
  tokensPerSecond: number;
  /** What the context holds now, and whether that came from the model or is an estimate. */
  contextTokens: number;
  contextExact: boolean;
  contextWindow: number;
}

const turns = new Map<string, LiveTurn>();
const listeners = new Set<() => void>();

export function setLiveTurn(chatId: string, live: LiveTurn | null): void {
  if (live) turns.set(chatId, live);
  else if (!turns.delete(chatId)) return;
  for (const listener of listeners) listener();
}

export function getLiveTurn(chatId: string): LiveTurn | null {
  return turns.get(chatId) ?? null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLiveTurn(chatId: string): LiveTurn | null {
  const read = useCallback(() => getLiveTurn(chatId), [chatId]);
  return useSyncExternalStore(subscribe, read, read);
}
