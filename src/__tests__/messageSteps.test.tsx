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

/** A document is written as HTML and can be read either way. A source file is already its own
 * source, and asking which of one thing to show is the question that made no sense. */
describe("a file the model wrote", () => {
  const file = (filename: string, fileContent: string): SearchStep => ({
    id: "f1",
    type: "create_file",
    content: filename,
    isComplete: true,
    filename,
    fileContent,
  });

  it("offers preview and source for a document", () => {
    show([file("report.docx", "<h1>Report</h1>")]);

    expect(screen.getByText("Preview")).toBeTruthy();
    expect(screen.getByText("Source")).toBeTruthy();
  });

  it("offers neither for a code file", () => {
    show([file("format.ts", "export const one = 1;")]);

    expect(screen.queryByText("Preview")).toBeNull();
    expect(screen.queryByText("Source")).toBeNull();
  });

  /** The card scrolled, the preview inside it scrolled, and the highlighter inside that scrolled
   * again: three bars down the right-hand edge of one file. */
  it("scrolls in one place, not three", () => {
    const long = Array.from({ length: 221 }, (_, i) => `const line${i} = ${i};`).join("\n");
    const { container } = show([file("organizer.py", long)]);

    const scrolling = Array.from(container.querySelectorAll("*")).filter((element) => {
      const inline = element.getAttribute("style") || "";
      const classes = element.className?.toString() || "";
      return (
        /overflow(-[xy])?\s*:\s*(auto|scroll)/.test(inline) ||
        /\boverflow(-[xy])?-(auto|scroll)\b/.test(classes)
      );
    });

    expect(scrolling.length).toBe(1);
  });
});
