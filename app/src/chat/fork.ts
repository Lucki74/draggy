import type { ChatSession, Message } from "../types";
import { shownMessage } from "../agent/turnHistory";

export interface Fork {
  session: ChatSession;
  /** Wording of the user message the fork started from, for the new chat's composer. */
  draft?: string;
}

/** A new chat holding the conversation as shown up to `index`, branches flattened. A fork from a user
 * message ends before it and hands its wording back as a draft. Null when nothing would remain. */
export function forkAt(session: ChatSession, index: number, id: string, title: string, newId: () => string): Fork | null {
  const target = session.messages[index];
  if (!target || target.notice) return null;

  const isUser = target.role === "user";
  const end = isUser ? index : index + 1;
  if (end <= 0) return null;

  const messages = session.messages.slice(0, end).map((message): Message => {
    const shown = shownMessage(message);
    // A provider thread id belongs to one chat on the server, so the copy starts without it.
    const { versions: _v, currentVersionIndex: _c, tail: _t, provider_state: _p, ...rest } = shown;
    return { ...rest, id: newId() };
  });

  // A summary written on another branch no longer describes the flattened conversation.
  const branched = session.messages.slice(0, end).some((message) => (message.versions?.length ?? 0) > 0);
  const state = session.compaction;
  const compaction = state && !branched && state.throughIndex <= messages.length ? state : null;
  const forked: ChatSession = {
    id,
    title,
    messages,
    updatedAt: Date.now(),
    isGenerating: false,
    ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
    ...(session.generation ? { generation: session.generation } : {}),
    ...(compaction ? { compaction } : {}),
  };
  return isUser ? { session: forked, draft: shownMessage(target).content } : { session: forked };
}
