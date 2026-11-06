/** What the research library screen decides from saved runs and the chats on hand. */
import type { ChatSession } from "../types";
import type { RunSummary } from "./library";

export type FollowUp = { kind: "chat"; id: string } | { kind: "new"; draft: string };

/** A run's own chat when it still exists, else a new chat seeded with the question. */
export function followUpTarget(run: Pick<RunSummary, "chatId" | "question">, sessions: Pick<ChatSession, "id">[]): FollowUp {
  if (run.chatId && sessions.some((session) => session.id === run.chatId)) return { kind: "chat", id: run.chatId };
  return { kind: "new", draft: run.question };
}

/** The report the model wrote for a run: the reply in its chat that holds the run's block. */
export function reportOf(run: Pick<RunSummary, "id" | "chatId">, sessions: Pick<ChatSession, "id" | "messages">[]): string | null {
  const chat = sessions.find((session) => session.id === run.chatId);
  const reply = chat?.messages.find(
    (message) =>
      message.role === "assistant" &&
      (message.steps ?? []).some((step) => step.type === "research_run" && step.researchRun?.id === run.id),
  );
  return reply?.content?.trim() ? reply.content : null;
}

/** Keeps the runs that matched a search, in the order the search ranked them. */
export function runsMatching<T extends { id: string }>(runs: T[], hits: { runId: string }[]): T[] {
  const order = new Map<string, number>();
  for (const hit of hits) if (!order.has(hit.runId)) order.set(hit.runId, order.size);
  return runs.filter((run) => order.has(run.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}
