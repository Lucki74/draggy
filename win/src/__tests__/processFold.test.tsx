// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ProcessFold from "../chat/ProcessFold";
import { processFoldLength } from "../chat/workSummary";
import type { SearchStep } from "../types";

afterEach(cleanup);

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

  it("stops at an unanswered approval or a question, and folds an error with the work", () => {
    const work = [step("a", "reading"), step("b", "searching")];
    expect(processFoldLength([work, [step("p", "approval")], work])).toBe(1);
    expect(processFoldLength([work, [step("e", "error")], work])).toBe(3);
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
  const t = (key: string) => (key === "processing" ? "Processing…" : key === "workRead_one" ? "Read {n} file" : key === "workRead_other" ? "Read {n} files" : key);
  const steps = [step("a", "reading"), step("b", "reading")];

  it("is open and reads as working while the turn runs", () => {
    render(
      <ProcessFold steps={steps} live language="en" t={t}>
        <p>inner</p>
      </ProcessFold>,
    );
    expect(screen.getByText("Processing…")).toBeTruthy();
    expect(screen.getByText("inner")).toBeTruthy();
  });

  it("folds under the summary once done and reopens in full on click", () => {
    const { rerender } = render(
      <ProcessFold steps={steps} live language="en" t={t}>
        <p>inner</p>
      </ProcessFold>,
    );
    rerender(
      <ProcessFold steps={steps} live={false} language="en" t={t}>
        <p>inner</p>
      </ProcessFold>,
    );
    expect(screen.getByText("Read 2 files")).toBeTruthy();
    expect(screen.queryByText("inner")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("inner")).toBeTruthy();
  });

  it("shows edit counts in the row only for several edited files", () => {
    const edit = (id: string) => step(id, "edit_file", { before: "a\n", after: "b\n" });
    const render1 = (list: SearchStep[]) =>
      render(
        <ProcessFold steps={list} live={false} language="en" t={t}>
          <p>inner</p>
        </ProcessFold>,
      );
    const one = render1([edit("a")]);
    expect(screen.queryByText("+1")).toBeNull();
    one.unmount();
    render1([edit("a"), edit("b")]);
    expect(screen.getByText("+2")).toBeTruthy();
  });
});
