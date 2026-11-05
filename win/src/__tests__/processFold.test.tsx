// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ProcessFold from "../chat/ProcessFold";
import { processFoldLength } from "../chat/workSummary";
import type { SearchStep } from "../types";

const step = (id: string, type: SearchStep["type"], extra: Partial<SearchStep> = {}): SearchStep => ({
  id,
  type,
  content: id,
  isComplete: true,
  ...extra,
});

describe("processFoldLength", () => {
  it("folds reasoning, work and earlier prose but not the last prose block", () => {
    const segments = [[step("a", "thinking")], [step("b", "reading"), step("c", "searching")], [step("d", "text")], [step("e", "command")], [step("f", "text")]];
    expect(processFoldLength(segments)).toBe(4);
  });

  it("stops at an unanswered approval, an error or a question", () => {
    const work = [step("a", "reading"), step("b", "searching")];
    expect(processFoldLength([work, [step("p", "approval")], work])).toBe(1);
    expect(processFoldLength([work, [step("e", "error")], work])).toBe(1);
    expect(processFoldLength([[step("q", "question")], work])).toBe(0);
  });

  it("leaves a turn with no steps alone", () => {
    expect(processFoldLength([])).toBe(0);
  });

  it("folds every step of a turn that has no final prose", () => {
    expect(processFoldLength([[step("a", "reading")], [step("b", "thinking")]])).toBe(2);
  });
});

describe("ProcessFold", () => {
  const t = (key: string) => (key === "workProcess_one" ? "Process ({n} step)" : "Process ({n} steps)");

  it("starts closed, shows the count and reopens on click", () => {
    const steps = [step("a", "reading"), step("b", "searching")];
    render(
      <ProcessFold steps={steps} t={t}>
        <p>inner</p>
      </ProcessFold>,
    );
    expect(screen.getByText("Process (2 steps)")).toBeTruthy();
    expect(screen.queryByText("inner")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("inner")).toBeTruthy();
  });
});
