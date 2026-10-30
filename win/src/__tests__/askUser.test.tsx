// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import QuestionCard from "../chat/QuestionCard";
import { AnswerQuestionContext } from "../chat/questionContext";
import { PLAN_TOOLS } from "../tools/plan";
import type { ToolContext } from "../tools/registry";
import type { SearchStep, UserQuestion, UserReply } from "../types";

const ask = PLAN_TOOLS.find((tool) => tool.name === "ask_user")!;
const t = (key: string) => key;

function context(askUser?: (question: UserQuestion) => Promise<UserReply | null>) {
  const steps: SearchStep[] = [];
  const ctx = {
    t,
    newId: () => "q1",
    askUser,
    pushStep: (step: SearchStep) => steps.push(step),
    patchStep: (id: string, patch: Partial<SearchStep>) => {
      const at = steps.findIndex((step) => step.id === id);
      steps[at] = { ...steps[at], ...patch };
    },
    syncSteps: () => {},
  } as unknown as ToolContext;
  return { ctx, steps };
}

describe("the ask_user tool", () => {
  it("is there in a plain chat and in a folder, for small models too", () => {
    expect(ask.extended).toBeFalsy();
    expect(ask.available).toBeUndefined();
  });

  it("asks follow-ups in the same card and numbers the answers", async () => {
    const asked = vi.fn(async () => ({ choices: ["SQLite"], text: "", more: [{ choices: [], text: "none" }] }));
    const { ctx } = context(asked);
    const more = JSON.stringify([{ question: "Any limits?", options: "", multiple: false }, { question: " " }, 3]);

    const result = await ask.run({ question: "Which database?", options: "SQLite\nPostgres", more }, ctx);

    expect(asked).toHaveBeenCalledWith({
      id: "q1",
      text: "Which database?",
      options: ["SQLite", "Postgres"],
      multiple: false,
      more: [{ text: "Any limits?", options: [], multiple: false }],
    });
    expect(result).toBe("TOOL RESULT (ask_user): The user answered:\n1. Which database? → SQLite\n2. Any limits? → none");
  });

  it("ignores follow-ups that are not a JSON list", async () => {
    const asked = vi.fn(async () => ({ choices: ["A"], text: "" }));
    const { ctx } = context(asked);

    await ask.run({ question: "Which?", options: "A\nB", more: "not json" }, ctx);

    expect(asked).toHaveBeenCalledWith({ id: "q1", text: "Which?", options: ["A", "B"], multiple: false });
  });

  it("puts the question and its options to the user and returns the pick", async () => {
    const asked = vi.fn(async () => ({ choices: ["Postgres"], text: "" }));
    const { ctx, steps } = context(asked);

    const result = await ask.run({ question: "Which database?", options: "1. SQLite\n- Postgres\n\n" }, ctx);

    expect(asked).toHaveBeenCalledWith({ id: "q1", text: "Which database?", options: ["SQLite", "Postgres"], multiple: false });
    expect(result).toBe("TOOL RESULT (ask_user): The user answered: Postgres");
    expect(steps[0]).toMatchObject({ type: "question", isComplete: true, reply: { choices: ["Postgres"], text: "" } });
  });

  it("joins picks and a written note, and allows several picks only with options", async () => {
    const asked = vi.fn(async () => ({ choices: ["A", "B"], text: "but quickly" }));
    const { ctx } = context(asked);

    expect(await ask.run({ question: "Which?", options: "A\nB", multiple: true }, ctx)).toContain("A; B; but quickly");
    expect(asked).toHaveBeenCalledWith(expect.objectContaining({ multiple: true }));

    await ask.run({ question: "Why?", multiple: true }, ctx);
    expect(asked).toHaveBeenLastCalledWith(expect.objectContaining({ options: [], multiple: false }));
  });

  it("tells the model when the user dismissed it, and marks the step", async () => {
    const { ctx, steps } = context(async () => null);

    expect(await ask.run({ question: "Sure?" }, ctx)).toContain("dismissed");
    expect(steps[0].reply).toBe("cancelled");
  });

  it("tells the model when no one is there, without a step", async () => {
    const { ctx, steps } = context(undefined);

    expect(await ask.run({ question: "Sure?" }, ctx)).toContain("No one is there");
    expect(steps).toEqual([]);
  });

  it("refuses an empty question", async () => {
    const { ctx } = context(async () => null);
    expect(await ask.run({ question: "  " }, ctx)).toContain("no question");
  });
});

describe("the question card", () => {
  afterEach(cleanup);

  const step = (question: Partial<UserQuestion>, reply?: SearchStep["reply"]): SearchStep => ({
    id: "q1",
    type: "question",
    content: "Question",
    isComplete: Boolean(reply),
    question: { id: "q1", text: "Which database?", options: ["SQLite", "Postgres"], multiple: false, ...question },
    reply,
  });

  const show = (one: SearchStep) => {
    const answer = vi.fn();
    render(
      <AnswerQuestionContext.Provider value={answer}>
        <QuestionCard step={one} t={t} />
      </AnswerQuestionContext.Provider>,
    );
    return answer;
  };

  it("answers a single choice at once", () => {
    const answer = show(step({}));
    fireEvent.click(screen.getByRole("radio", { name: /Postgres/ }));
    expect(answer).toHaveBeenCalledWith("q1", { choices: ["Postgres"], text: "" });
  });

  it("picks with the number keys", () => {
    const answer = show(step({}));
    fireEvent.keyDown(window, { key: "1" });
    expect(answer).toHaveBeenCalledWith("q1", { choices: ["SQLite"], text: "" });
  });

  it("collects several picks and sends them with Enter", () => {
    const answer = show(step({ multiple: true }));
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "2" });
    expect(answer).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(answer).toHaveBeenCalledWith("q1", { choices: ["SQLite", "Postgres"], text: "" });
  });

  it("sends a written answer, and does not take digits typed into the box as picks", () => {
    const answer = show(step({ options: [] }));
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "port 5432" } });
    fireEvent.keyDown(box, { key: "1" });
    expect(answer).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(answer).toHaveBeenCalledWith("q1", { choices: [], text: "port 5432" });
  });

  it("skips with Escape or the button, sending null", () => {
    const answer = show(step({}));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /questionSkip/ }));
    expect(answer).toHaveBeenNthCalledWith(1, "q1", null);
    expect(answer).toHaveBeenNthCalledWith(2, "q1", null);
  });

  it("steps through follow-ups and sends every answer together", () => {
    const answer = show(
      step({ more: [{ text: "Which port?", options: [], multiple: false }, { text: "Which tools?", options: ["a", "b"], multiple: true }] }),
    );
    fireEvent.click(screen.getByRole("radio", { name: /Postgres/ }));
    expect(answer).not.toHaveBeenCalled();
    expect(screen.getByText("questionProgress")).toBeTruthy();

    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "5432" } });
    fireEvent.click(screen.getByRole("button", { name: /questionNext/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /a/ }));
    fireEvent.click(screen.getByRole("button", { name: /questionSend/ }));

    expect(answer).toHaveBeenCalledWith("q1", {
      choices: ["Postgres"],
      text: "",
      more: [
        { choices: [], text: "5432" },
        { choices: ["a"], text: "" },
      ],
    });
  });

  it("goes back to change an earlier answer", () => {
    const answer = show(step({ more: [{ text: "Sure?", options: ["yes"], multiple: false }] }));
    fireEvent.click(screen.getByRole("radio", { name: /SQLite/ }));
    fireEvent.click(screen.getByRole("button", { name: /questionBack/ }));
    expect(screen.getByRole("radio", { name: /SQLite/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: /Postgres/ }));
    fireEvent.click(screen.getByRole("radio", { name: /yes/ }));
    expect(answer).toHaveBeenCalledWith("q1", { choices: ["Postgres"], text: "", more: [{ choices: ["yes"], text: "" }] });
  });

  it("skipping every question dismisses the card", () => {
    const answer = show(step({ more: [{ text: "Sure?", options: [], multiple: false }] }));
    fireEvent.click(screen.getByRole("button", { name: /questionSkip/ }));
    fireEvent.click(screen.getByRole("button", { name: /questionSkip/ }));
    expect(answer).toHaveBeenCalledWith("q1", null);
  });

  it("shows the reply once answered, with no form", () => {
    show(step({}, { choices: ["Postgres"], text: "" }));
    expect(screen.getByText(/Postgres/).textContent).toContain("questionYouAnswered");
    expect(screen.queryByRole("radio")).toBeNull();
    act(() => {
      fireEvent.keyDown(window, { key: "1" });
    });
  });

  it("shows a dismissed question as skipped", () => {
    show(step({}, "cancelled"));
    expect(screen.getByText("questionSkipped")).toBeTruthy();
  });
});
