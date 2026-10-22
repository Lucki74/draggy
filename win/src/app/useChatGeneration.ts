import { useEffect, useRef } from "react";
import { allowedEfforts, isEffortLevel } from "../ai/effort";
import type { AppMode } from "./modes";
import type { ChatSession, EffortLevel } from "../types";

export type Generation = NonNullable<ChatSession["generation"]>;

export function sameGeneration(a: ChatSession["generation"], b: ChatSession["generation"]): boolean {
  return (a?.model ?? "") === (b?.model ?? "") && (a?.effort ?? "") === (b?.effort ?? "");
}

/** The effort a chat starts on: the default level, or wherever the last chat was left. */
export function startingEffort(rule: "defaults" | "last", current: EffortLevel, fallback: EffortLevel): EffortLevel {
  return rule === "last" ? current : fallback;
}

interface Options {
  ready: boolean;
  chatId: string | null;
  session: ChatSession | undefined;
  mode: AppMode;
  allowMaxInChat: boolean;
  effort: EffortLevel;
  model: string | null;
  canUseModel: (model: string) => Promise<boolean>;
  applyEffort: (effort: EffortLevel) => void;
  applyModel: (model: string) => void;
  save: (chatId: string, generation: Generation) => void;
}

/** Opening a chat puts back the model and thinking level it was left on; a chat that never had any
 * takes the ones in use. Changes made while it is open are saved by the caller through `save`. */
export function useChatGeneration(options: Options): void {
  const handled = useRef<string | null>(null);
  const { ready, chatId, session, mode, allowMaxInChat, effort, model } = options;
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const hasSession = Boolean(session);

  useEffect(() => {
    if (!ready || !chatId || !hasSession || handled.current === chatId) return;
    handled.current = chatId;

    const { session: current, canUseModel, applyEffort, applyModel, save } = latest.current;
    const saved = current?.generation;
    if (!saved) {
      save(chatId, { ...(model ? { model } : {}), effort });
      return;
    }
    if (isEffortLevel(saved.effort) && allowedEfforts(mode, allowMaxInChat).includes(saved.effort) && saved.effort !== effort) {
      applyEffort(saved.effort);
    }
    if (saved.model && saved.model !== model) {
      // A model deleted since is skipped, and so is an answer that came after another chat opened.
      void canUseModel(saved.model).then((usable) => {
        if (usable && handled.current === chatId) applyModel(saved.model as string);
      });
    }
  }, [ready, chatId, hasSession, mode, allowMaxInChat, effort, model]);
}
