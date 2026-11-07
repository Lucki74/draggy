// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ResearchPlanCard from "../chat/ResearchPlanCard";
import { AnswerQuestionContext } from "../chat/questionContext";
import type { SearchStep } from "../types";

const t = (key: string) => key;

const step = (patch: Partial<SearchStep> = {}): SearchStep =>
  ({
    id: "r1",
    type: "research_plan",
    content: "",
    isComplete: false,
    question: { id: "r1", text: "", options: ["approve"], multiple: false },
    researchPlan: { question: "How fast is X?", subQuestions: ["Speed", "Cost"], depth: "standard", sources: ["web"] },
    ...patch,
  }) as SearchStep;

function show(one: SearchStep) {
  const answer = vi.fn();
  render(
    <AnswerQuestionContext.Provider value={answer}>
      <ResearchPlanCard step={one} t={t} />
    </AnswerQuestionContext.Provider>,
  );
  return answer;
}

const sent = (answer: ReturnType<typeof vi.fn>) => JSON.parse(answer.mock.calls[0][1].text);

afterEach(cleanup);

describe("ResearchPlanCard", () => {
  it("sends the edited plan when approved", () => {
    const answer = show(step());
    fireEvent.change(screen.getByLabelText("researchSubQuestions 2"), { target: { value: "Price" } });
    fireEvent.click(screen.getByRole("radio", { name: /researchDepthDeep/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "researchSourcePapers" }));
    fireEvent.click(screen.getByRole("button", { name: "researchApprove" }));
    expect(answer.mock.calls[0][1].choices).toEqual(["approve"]);
    expect(sent(answer)).toEqual({ question: "How fast is X?", subQuestions: ["Speed", "Price"], depth: "deep", sources: ["web", "papers"] });
  });

  it("removes and adds sub-questions and drops blank ones", () => {
    const answer = show(step());
    fireEvent.click(screen.getAllByRole("button", { name: "researchRemoveQuestion" })[0]);
    fireEvent.click(screen.getByRole("button", { name: /researchAddQuestion/ }));
    fireEvent.click(screen.getByRole("button", { name: "researchApprove" }));
    expect(sent(answer).subQuestions).toEqual(["Cost"]);
  });

  it("keeps at least one source", () => {
    const answer = show(step());
    fireEvent.click(screen.getByRole("checkbox", { name: "researchSourceWeb" }));
    fireEvent.click(screen.getByRole("button", { name: "researchApprove" }));
    expect(sent(answer).sources).toEqual(["web"]);
  });

  it("cancels with a null answer", () => {
    const answer = show(step());
    fireEvent.click(screen.getByRole("button", { name: "researchCancel" }));
    expect(answer).toHaveBeenCalledWith("r1", null);
  });

  it("shows a one-line summary once answered", () => {
    show(step({ reply: { choices: ["approve"], text: "" }, isComplete: true }));
    expect(screen.getByText(/researchApproved/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "researchApprove" })).toBeNull();
  });
});
