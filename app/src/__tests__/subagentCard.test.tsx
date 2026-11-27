// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import WorkBlock from "../chat/WorkBlock";
import type { SearchStep } from "../types";

const t = (key: string) => key;

const child: SearchStep = { id: "c1", type: "reading", content: "", isComplete: true, filename: "notes.txt" } as SearchStep;

const card = (status: "running" | "done" | "failed", patch: Partial<SearchStep["subagent"]> = {}): SearchStep =>
  ({
    id: "sa1",
    type: "subagent",
    content: "",
    isComplete: status !== "running",
    subagent: {
      task: "Find the config keys",
      label: "Config scan",
      status,
      readOnly: true,
      toolCount: 2,
      steps: [child],
      summary: "Three keys found.",
      ...patch,
    },
  }) as SearchStep;

afterEach(() => cleanup());

describe("SubagentCard", () => {
  it("folds the child steps and summary until the row is opened", () => {
    render(<WorkBlock step={card("done")} t={t} />);
    expect(screen.getByText("subagentDone")).toBeTruthy();
    expect(screen.getByTestId("step-details-toggle").getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText(/subagentToolCount.*subagentReadOnly/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("step-details-toggle"));
    expect(screen.getByTestId("step-details-toggle").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Three keys found.")).toBeTruthy();
    expect(screen.getByRole("list", { name: "subagentSteps" })).toBeTruthy();
  });

  it("shows the running state with its tool count and mode", () => {
    render(<WorkBlock step={card("running", { summary: undefined, steps: [] })} t={t} />);
    expect(screen.getByText("subagentRunning")).toBeTruthy();
    fireEvent.click(screen.getByTestId("step-details-toggle"));
    expect(screen.getByText("subagentNoSteps")).toBeTruthy();
  });

  it("marks a failed child run", () => {
    render(<WorkBlock step={card("failed", { summary: "The subagent failed: boom" })} t={t} />);
    expect(screen.getByText("subagentFailed")).toBeTruthy();
  });
});

describe("allSteps", () => {
  it("lists a child run's own steps after its step so a nested approval is found", async () => {
    const { allSteps } = await import("../agent/allSteps");
    const approval = { id: "ap", type: "approval", content: "", isComplete: false } as SearchStep;
    const flat = allSteps([card("running", { steps: [approval] })]);
    expect(flat.map((step) => step.id)).toEqual(["sa1", "ap"]);
    expect(allSteps(undefined)).toEqual([]);
  });
});

describe("SubagentCard states", () => {
  it("shows a queued child as waiting, not running", () => {
    render(<WorkBlock step={card("queued" as "running", { steps: [], summary: undefined, toolCount: 0 })} t={t} />);
    expect(screen.getByText("subagentQueued")).toBeTruthy();
    expect(screen.queryByText("subagentRunning")).toBeNull();
  });

  it("shows a failed child with its summary when opened", () => {
    render(<WorkBlock step={card("failed", { summary: "The subagent failed: model unavailable" })} t={t} />);
    expect(screen.getByText("subagentFailed")).toBeTruthy();
    fireEvent.click(screen.getByTestId("step-details-toggle"));
    expect(screen.getByText("The subagent failed: model unavailable")).toBeTruthy();
  });

  it("wraps a summary at the 4000 character cap instead of overflowing", () => {
    const long = "word ".repeat(800).slice(0, 4000);
    render(<WorkBlock step={card("done", { summary: long })} t={t} />);
    fireEvent.click(screen.getByTestId("step-details-toggle"));
    const paragraph = screen.getByText(long.trim());
    expect(paragraph.className).toContain("break-words");
    expect(paragraph.className).toContain("whitespace-pre-wrap");
  });
});
