/** True when an earlier reply in the chat holds a finished research run. */
export function holdsFinishedRun(messages: { steps?: { type: string; researchRun?: { endedAt?: number } }[] }[]): boolean {
  return messages.some((message) =>
    (message.steps ?? []).some((step) => step.type === "research_run" && step.researchRun?.endedAt !== undefined),
  );
}

export function followUpInstruction(): string {
  return "This chat holds a finished research run. For a follow-up question, call search_notes first: it looks through that run's notes and saved pages. Search the web only when the notes do not cover it.";
}
