import { describe, expect, it } from "vitest";
import { toWireMessage } from "../agent/agentLoop";
import type { Message, SearchStep } from "../types";

/** B6: what an earlier turn knew has to still be in the prompt on a later one. Each fact below is
 * distinctive, so a miss names the part of the history that dropped it. */

const FACTS = {
  said: "violet-otter-4471",
  attached: "orange-heron-2290",
  output: "788454-quartz",
  file: "C:/out/budget-ledger-9921.xlsx",
  page: "https://example.test/harbour-tides-7710",
  reasoning: "teal-badger-5503",
};

function step(partial: Partial<SearchStep> & Pick<SearchStep, "type">): SearchStep {
  return { id: partial.type, content: "", isComplete: true, ...partial };
}

const history: Message[] = [
  {
    id: "u1",
    role: "user",
    content: `my code word is ${FACTS.said}`,
    attachments: [{ name: "notes.txt", type: "text/plain", content: `the secret is ${FACTS.attached}` }],
  },
  {
    id: "a1",
    role: "assistant",
    content: "Done, see the file.",
    textContent: "Done, see the file.",
    steps: [
      step({ type: "thinking", content: `I will remember ${FACTS.reasoning}` }),
      step({ type: "run_code", content: "Code ran", language: "python", stdout: FACTS.output }),
      step({ type: "create_file", content: "Created **ledger.xlsx**", filename: "ledger.xlsx", filepath: FACTS.file }),
      step({ type: "results", content: "Searched", results: [{ title: "Tides", url: FACTS.page, snippet: "" }] }),
    ],
  },
  { id: "u2", role: "user", content: "what did you do?" },
];

const wire = () => history.map((message) => toWireMessage(message, false, true));
const sent = () => wire().map((message) => `${message.content}\n${message.thinking ?? ""}`).join("\n");

describe("what a later turn still sees of the earlier ones", () => {
  it.each(Object.entries(FACTS))("keeps %s", (_name, fact) => {
    expect(sent()).toContain(fact);
  });

  it("is the same text on every turn, so the engine's cache prefix holds", () => {
    expect(JSON.stringify(wire())).toBe(JSON.stringify(wire()));
  });
});
