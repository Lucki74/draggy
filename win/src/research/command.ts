/** "/research <question>" asks for a research run. The message goes to the model as typed, and the
 * system prompt gains one line telling it to start with start_research. */
const COMMAND = /^\/research(?:\s+([\s\S]*))?$/i;

export function researchRequest(text: string): string | null {
  const match = COMMAND.exec(String(text ?? "").trim());
  if (!match) return null;
  return (match[1] ?? "").trim();
}

export function researchInstruction(question: string): string {
  const asked = question
    ? `The user asked for a research run on: ${question}`
    : "The user asked for a research run but gave no question. Ask what to research before anything else.";
  return question
    ? `${asked}\nStart with start_research: draft the sub-questions, pick a depth and wait for the user to approve the plan. Do not answer from memory first.`
    : asked;
}
