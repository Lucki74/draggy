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
    expect(container.querySelectorAll(".border-s").length).toBeGreaterThan(0);
    expect(screen.getByText("Final reply.")).toBeTruthy();
  });

  it("shows a quiet dot on a finished step and a cross on a failed one", () => {
    const { container } = turn("normal", [step("one.ts", "reading"), step("boom", "error")]);
    unfold();
    expect(container.querySelectorAll(".step-dot")).toHaveLength(1);
    expect(container.querySelectorAll(".step-check")).toHaveLength(0);
    expect(container.querySelectorAll(".text-danger").length).toBeGreaterThan(0);
  });

  it("shows only the results row for a finished search", () => {
    turn("normal", [
      step("Searched for x", "searching"),
      step("Search results for x", "results", { results: [{ title: "T", url: "https://a.test", snippet: "s" }] }),
    ]);
    unfold();
    expect(screen.queryByText("Searched for x")).toBeNull();
    expect(screen.getByText("Search results for x")).toBeTruthy();
  });

  it("keeps a running search visible until its results arrive", () => {
    turn("normal", [step("Searching for x", "searching", { isComplete: false })]);
    unfold();
    expect(screen.getByText("Searching for x")).toBeTruthy();
  });
});
