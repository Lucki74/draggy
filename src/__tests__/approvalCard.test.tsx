// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ApprovalCard from "../chat/ApprovalCard";
import { translations } from "../translations";
import type { ApprovalAnswer, SearchStep } from "../types";

/**
 * The card a turn parks on. Everything about it is a promise to the user: the
 * buttons say how far the permission goes, and once it is answered it stops
 * being a question.
 */

const t = (key: string) => translations.en[key] || key;

const waiting: SearchStep = {
  id: "step-1",
  type: "approval",
  content: "Needs your approval",
  isComplete: false,
  approval: {
    id: "step-1",
    tool: "write_file",
    target: "C:\\projects\\thing\\notes.md",
    reason: "This changes something outside Draggy.",
  },
};

afterEach(cleanup);

describe("a call waiting on the user", () => {
  it("says what is being asked for and where", () => {
    render(<ApprovalCard step={waiting} t={t} />);

    expect(screen.getByText("write_file")).toBeTruthy();
    expect(screen.getByText("C:\\projects\\thing\\notes.md")).toBeTruthy();
    expect(screen.getByText("Needs your approval")).toBeTruthy();
  });

  it("offers the three ways to allow it and one to refuse", () => {
    render(<ApprovalCard step={waiting} t={t} />);

    for (const label of [
      "Allow once",
      "Allow for this task",
      "Always allow here",
      "Don't",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("passes on how far the permission goes", () => {
    const onAnswer = vi.fn();
    render(<ApprovalCard step={waiting} t={t} onAnswer={onAnswer} />);

    screen.getByRole("button", { name: "Always allow here" }).click();

    expect(onAnswer).toHaveBeenCalledWith("step-1", "workspace");
  });

  it("refuses through the same handler", () => {
    const onAnswer = vi.fn();
    render(<ApprovalCard step={waiting} t={t} onAnswer={onAnswer} />);

    screen.getByRole("button", { name: "Don't" }).click();

    expect(onAnswer).toHaveBeenCalledWith("step-1", "no");
  });

  it("stops being a question once it is answered", () => {
    const answered: SearchStep = { ...waiting, answer: "once", isComplete: true };
    render(<ApprovalCard step={answered} t={t} />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Allowed/)).toBeTruthy();
  });

  it("shows a refusal as a refusal", () => {
    const refused: SearchStep = { ...waiting, answer: "no", isComplete: true };
    render(<ApprovalCard step={refused} t={t} />);

    expect(screen.getByText(/Declined/)).toBeTruthy();
  });

  it("says nothing at all without a call to ask about", () => {
    const { container } = render(
      <ApprovalCard step={{ ...waiting, approval: undefined }} t={t} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("reads in the user's language", () => {
    const french = (key: string) => translations.fr[key] || key;
    render(<ApprovalCard step={waiting} t={french} />);

    expect(screen.getByText("Demande votre accord")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Autoriser une fois" }),
    ).toBeTruthy();
  });

  it("survives a call about nothing in particular", () => {
    const noTarget: SearchStep = {
      ...waiting,
      approval: { ...waiting.approval!, target: null },
    };
    render(<ApprovalCard step={noTarget} t={t} />);

    expect(screen.getByText("write_file")).toBeTruthy();
  });
});

describe("the answers it can give", () => {
  it("covers every one the permission engine understands", () => {
    const onAnswer = vi.fn();
    render(<ApprovalCard step={waiting} t={t} onAnswer={onAnswer} />);

    for (const label of [
      "Allow once",
      "Allow for this task",
      "Always allow here",
      "Don't",
    ]) {
      screen.getByRole("button", { name: label }).click();
    }

    const given = onAnswer.mock.calls.map((call) => call[1] as ApprovalAnswer);
    expect(given).toEqual(["once", "task", "workspace", "no"]);
  });
});
