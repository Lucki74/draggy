// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ProcessFold from "../chat/ProcessFold";
import Rail, { type RailEntry } from "../chat/Rail";
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

const words: Record<string, string> = {
  working: "Working",
  workedFor: "Worked {time}",
  workRead_one: "Read {n} file",
  workRead_other: "Read {n} files",
  earlierSteps_one: "{n} earlier step",
  earlierSteps_other: "{n} earlier steps",
};
const t = (key: string) => words[key] ?? key;
const entry = (key: string, state: RailEntry["state"] = "done"): RailEntry => ({ key, state, kind: "step", node: <p>{key}</p> });

describe("ProcessFold", () => {
  const steps = [step("a", "reading"), step("b", "reading")];
  const entries = [entry("inner")];

  it("is open and reads as working while the turn runs", () => {
    render(<ProcessFold steps={steps} entries={entries} live view="normal" language="en" t={t} />);
    expect(screen.getByText("Working")).toBeTruthy();
    expect(screen.getByText("inner")).toBeTruthy();
  });

  it("folds under the summary once done and reopens in full on click", () => {
    const { rerender } = render(<ProcessFold steps={steps} entries={entries} live view="normal" language="en" t={t} />);
    rerender(<ProcessFold steps={steps} entries={entries} live={false} durationMs={9000} view="normal" language="en" t={t} />);
    expect(screen.getByText("Worked 9s")).toBeTruthy();
    expect(screen.getByText("Read 2 files")).toBeTruthy();
    expect(screen.queryByText("inner")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("inner")).toBeTruthy();
  });

  it("stays open once done in the thinking and verbose views", () => {
    render(<ProcessFold steps={steps} entries={entries} live={false} view="thinking" language="en" t={t} />);
    expect(screen.getByText("inner")).toBeTruthy();
  });

  it("shows edit counts in the row only for several edited files", () => {
    const edit = (id: string) => step(id, "edit_file", { before: "a\n", after: "b\n" });
    const render1 = (list: SearchStep[]) => render(<ProcessFold steps={list} entries={entries} live={false} view="normal" language="en" t={t} />);
    const one = render1([edit("a")]);
    expect(screen.queryByText("+1")).toBeNull();
    one.unmount();
    render1([edit("a"), edit("b")]);
    expect(screen.getByText("+2")).toBeTruthy();
  });
});

describe("Rail", () => {
  const five = ["a", "b", "c", "d", "e"].map((key, index) => entry(key, index === 4 ? "live" : "done"));

  it("keeps only the newest steps in focus and counts the rest", () => {
    const { container } = render(<Rail entries={five} focus running t={t} />);
    expect(container.querySelectorAll(".rail-gone")).toHaveLength(2);
    fireEvent.click(screen.getByText("2 earlier steps"));
    expect(container.querySelectorAll(".rail-gone")).toHaveLength(0);
  });

  it("shows every step without focus and marks the live one", () => {
    const { container } = render(<Rail entries={five} focus={false} running t={t} />);
    expect(container.querySelectorAll(".rail-gone")).toHaveLength(0);
    expect(container.querySelectorAll(".rail-item.is-live")).toHaveLength(1);
    expect(screen.queryByText(/earlier step/)).toBeNull();
  });
});
