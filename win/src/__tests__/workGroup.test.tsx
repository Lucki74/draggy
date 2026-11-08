// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MessageItem from "../chat/MessageItem";
import { isWorkStep } from "../chat/workSummary";
import { defaultSettings } from "../app/settings";
import { TranscriptViewContext, type TranscriptView } from "../chat/transcriptView";
import type { SearchStep } from "../types";

afterEach(cleanup);

const step = (id: string, type: SearchStep["type"], extra: Partial<SearchStep> = {}): SearchStep => ({
  id,
  type,
  content: `**${id}**`,
  isComplete: true,
  ...extra,
});

const turn = (view: TranscriptView, steps: SearchStep[]) =>
  render(
    <TranscriptViewContext.Provider value={view}>
      <MessageItem
        msg={{ id: "a1", role: "assistant", content: "Final reply.", steps }}
        idx={1}
        isGenerating={false}
        isLast
        onRegenerate={() => {}}
        onSwitchVersion={() => {}}
        copiedIndex={null}
        copyToClipboard={() => {}}
        settings={{ ...defaultSettings, showMetrics: false }}
        onEditMessage={() => {}}
      />
    </TranscriptViewContext.Provider>,
  );

describe("which steps are work", () => {
  it("leaves prose, reasoning and questions out of the chain", () => {
    expect(isWorkStep(step("a", "text"))).toBe(false);
    expect(isWorkStep(step("b", "thinking"))).toBe(false);
    expect(isWorkStep(step("c", "approval"))).toBe(false);
    expect(isWorkStep(step("d", "reading"))).toBe(true);
  });
});

const unfold = () => fireEvent.click(screen.getAllByRole("button", { expanded: false })[0]);

describe("a finished reply with several steps", () => {
  it("folds under a summary row and reopens with every step in one chain", () => {
    const { container } = turn("normal", [step("one.ts", "reading"), step("two.ts", "reading")]);
    expect(screen.queryByText("one.ts")).toBeNull();
    expect(screen.getByRole("button", { name: /read 2 files/i })).toBeTruthy();
    expect(screen.queryByText(/^process/i)).toBeNull();
    unfold();
    expect(screen.getByText("one.ts")).toBeTruthy();
    expect(screen.getByText("two.ts")).toBeTruthy();
    expect(container.querySelectorAll("[data-testid=work-rail]")).toHaveLength(1);
    expect(screen.getByText("Final reply.")).toBeTruthy();
  });

  it("puts a quiet node on a finished step and a cross on a failed one", () => {
    const { container } = turn("normal", [step("one.ts", "reading"), step("boom", "error")]);
    unfold();
    expect(container.querySelectorAll(".rail-item.is-done")).toHaveLength(1);
    expect(container.querySelectorAll(".rail-item.is-failed")).toHaveLength(1);
    expect(container.querySelectorAll(".step-check")).toHaveLength(0);
  });

  it("shows only the results row for a finished search", () => {
    turn("normal", [
      step("s", "searching", { content: "Searching for **x**" }),
      step("r", "results", { content: "Search results for **x**", results: [{ title: "T", url: "https://a.test", snippet: "s" }] }),
    ]);
    unfold();
    expect(screen.getAllByText("Searched for")).toHaveLength(1);
    expect(screen.getByText("“x”")).toBeTruthy();
    expect(screen.getByText("1 result")).toBeTruthy();
  });

  it("keeps a running search visible until its results arrive", () => {
    turn("normal", [step("Searching for x", "searching", { isComplete: false })]);
    unfold();
    expect(screen.getByText("Searching for x")).toBeTruthy();
  });
});

describe("a finished step", () => {
  it("folds to one line naming its target, and shows its details on a click", () => {
    turn("normal", [
      step("one", "reading", { content: "Read **a.ts**", lines: 12, filename: "a.ts", filepath: "src/a.ts" }),
      step("two", "reading", { content: "Read **b.ts**", lines: 3 }),
    ]);
    unfold();
    expect(screen.getByText("a.ts")).toBeTruthy();
    expect(screen.getByText("12 lines")).toBeTruthy();
    const toggle = screen.getByTestId("step-details-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("src/a.ts")).toBeTruthy();
  });

  it("keeps its search results folded, and opens them in the verbose view", () => {
    const steps = [
      step("r", "results", { content: "Search results for **x**", results: [{ title: "T", url: "https://a.test", snippet: "s" }] }),
      step("two", "reading"),
    ];
    turn("normal", steps);
    unfold();
    expect(screen.getByTestId("step-details-toggle").getAttribute("aria-expanded")).toBe("false");
    cleanup();
    turn("verbose", steps);
    expect(screen.getByTestId("step-details-toggle").getAttribute("aria-expanded")).toBe("true");
  });
  it("marks a command that exited non-zero as failed", () => {
    const { container } = turn("normal", [
      step("one", "command", { content: "Ran `npm test` (exit 1)", failed: true }),
      step("two", "reading"),
    ]);
    unfold();
    expect(container.querySelectorAll(".rail-item.is-done")).toHaveLength(1);
    expect(container.querySelectorAll(".rail-item.is-failed")).toHaveLength(1);
  });

  it("hides an allowed approval outside the verbose view", () => {
    const approval = { id: "p1", kind: "command", tool: "run_command", target: "npm test" } as SearchStep["approval"];
    const steps = [step("ok", "approval", { approval, answer: "once" }), step("one", "command"), step("two", "reading")];
    turn("normal", steps);
    unfold();
    expect(screen.queryByText(/Allowed/)).toBeNull();
    cleanup();
    turn("verbose", steps);
    expect(screen.getByText(/Allowed/)).toBeTruthy();
  });
});
