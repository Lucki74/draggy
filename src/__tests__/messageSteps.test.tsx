// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import MessageItem from "../chat/MessageItem";
import { defaultSettings } from "../app/settings";
import type { Message, SearchStep } from "../types";

// Steps in a finished reply: one that worked reads as done, one that failed says it failed.

afterEach(cleanup);

const reply = (steps: SearchStep[]): Message => ({
  id: "a1",
  role: "assistant",
  content: "Done.",
  textContent: "Done.",
  steps,
});

const show = (steps: SearchStep[]) =>
  render(
    <MessageItem
      msg={reply(steps)}
      idx={1}
      isGenerating={false}
      isLast
      onRegenerate={() => {}}
      onSwitchVersion={() => {}}
      copiedIndex={null}
      copyToClipboard={() => {}}
      settings={{ ...defaultSettings, showMetrics: false }}
      onEditMessage={() => {}}
    />,
  );

describe("steps in a finished reply", () => {
  it("marks a step that failed as failed", () => {
    show([{ id: "s1", type: "error", content: "Writing **format.ts**", isComplete: true }]);

    expect(screen.getByText("format.ts")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
  });

  it("adds nothing to a step that worked", () => {
    show([{ id: "s1", type: "reading", content: "Read **format.ts**", isComplete: true }]);

    expect(screen.getByText("format.ts")).toBeTruthy();
    expect(screen.queryByText("Failed")).toBeNull();
  });

  it("shows a step's own words, with no English rewriting of them", () => {
    show([{ id: "s1", type: "navigating", content: "Navigation vers **example.com**", isComplete: true }]);

    expect(screen.getByText(/Navigation vers/)).toBeTruthy();
    expect(screen.queryByText(/Visited/)).toBeNull();
  });
});
