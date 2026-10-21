// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import MessageItem from "../chat/MessageItem";
import { TranscriptViewContext, type TranscriptView } from "../chat/transcriptView";
import { OpenDiffContext } from "../chat/openDiffContext";
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

const show = (steps: SearchStep[], view: TranscriptView = "normal") =>
  render(
    <TranscriptViewContext.Provider value={view}>
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
    />
    </TranscriptViewContext.Provider>,
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

describe("a provider being retried", () => {
  it("counts down to the next attempt, in the reader's words", () => {
    show([{ id: "r1", type: "loading", content: "", isComplete: false, retry: { attempt: 1, of: 2, until: Date.now() + 4000 } }]);

    expect(screen.getByText("Busy right now. Trying again in 4 s (1 of 2)...")).toBeTruthy();
  });
});

describe("a model being loaded", () => {
  const loading: SearchStep = { id: "l1", type: "loading", content: "", isComplete: false, model: "qwen3-8b", startedAt: Date.now() };

  it("says which stage the engine is in, with a percent only for the prompt", async () => {
    let push: (stage: { stage: string; percent?: number }) => void = () => {};
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      gguf: { onStage: (cb: typeof push) => ((push = cb), () => {}) },
    };
    show([loading]);

    act(() => push({ stage: "reading" }));
    expect(screen.getByText(/from disk/)).toBeTruthy();
    act(() => push({ stage: "placing" }));
    expect(screen.getByText(/in memory/)).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
    act(() => push({ stage: "prefilling", percent: 42 }));
    expect(screen.getByText(/Reading the prompt 42%/)).toBeTruthy();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });
});

/** Reasoning often arrives with indented lines, which Markdown turns into a code block that does
 * not wrap and ran off the edge of the reply. */
describe("a thinking step with indented lines", () => {
  it("wraps them instead of running off the edge", () => {
    const { container } = show([
      {
        id: "t1",
        type: "thinking",
        content: "Plan:\n\n    *   A very long line that keeps going well past the width of the reply",
        isComplete: true,
        thoughtTime: 2,
      },
    ], "thinking");

    const block = container.querySelector("details pre");
    expect(block).not.toBeNull();
    expect(block?.closest(".markdown-body")?.className).toContain("[&_pre]:whitespace-pre-wrap");
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

  it("renders live preview directly while a document is being generated", () => {
    const generatingDoc: SearchStep = {
      id: "f2",
      type: "create_file",
      content: "Creating report.docx",
      isComplete: false,
      filename: "report.docx",
      fileContent: "<h1>Live Heading</h1>",
    };
    const { container } = show([generatingDoc]);

    expect(screen.getByText("Writing...")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByText("Live Heading")).toBeTruthy();
    expect(container.querySelector(".ember-caret")).toBeTruthy();
  });

  it("stops saying Writing once the file step is complete", () => {
    show([file("format.ts", "export const one = 1;")]);

    expect(screen.queryByText("Writing...")).toBeNull();
    expect(screen.getByText("File created · 1 lines")).toBeTruthy();
  });

  it("renders the typing indicator directly on the code text, not in a floating corner", () => {
    const generatingCode: SearchStep = {
      id: "f3",
      type: "create_file",
      content: "Writing format.ts",
      isComplete: false,
      filename: "format.ts",
      fileContent: "const active = true;",
    };
    const { container } = show([generatingCode]);

    expect(screen.getByText("Writing...")).toBeTruthy();
    // The caret is inside the <code> element right next to the code tokens
    const codeEl = container.querySelector("code");
    expect(codeEl).toBeTruthy();
    expect(codeEl?.querySelector(".ember-caret")).toBeTruthy();

    // Detached floating corner container is not present
    expect(container.querySelector(".absolute.bottom-4.end-4")).toBeNull();
  });

  it("renders live html generation in Chrome preview with white canvas and active caret", () => {
    const generatingHtml: SearchStep = {
      id: "f4",
      type: "create_file",
      content: "Writing index.html",
      isComplete: false,
      filename: "index.html",
      fileContent: "<h1>Live Webpage</h1>",
    };
    const { container } = show([generatingHtml]);

    expect(screen.getByText("Writing...")).toBeTruthy();
    expect(screen.getByText("http://localhost:3000/index.html")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByText("Live Webpage")).toBeTruthy();
    expect(container.querySelector(".chrome-html-canvas.bg-white")).toBeTruthy();
    expect(container.querySelector(".ember-caret")).toBeTruthy();
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

describe("an edited file step", () => {
  it("renders Open diff action and opens diff pane on click", () => {
    const onOpenDiff = vi.fn();
    render(
      <OpenDiffContext.Provider value={onOpenDiff}>
        <MessageItem
          msg={reply([
            {
              id: "s1",
              type: "edit_file",
              content: "Edited **format.ts**",
              filepath: "/project/format.ts",
              isComplete: true,
            },
          ])}
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
      </OpenDiffContext.Provider>,
    );

    // A lone step sits in its work group too, closed until opened.
    fireEvent.click(screen.getByRole("button", { name: "Edited 1 file" }));
    const diffBtn = screen.getByRole("button", { name: "Open changes" });
    expect(diffBtn).toBeTruthy();
    diffBtn.click();
    expect(onOpenDiff).toHaveBeenCalledWith("/project/format.ts");
  });
});

describe("a failed reply", () => {
  const failedMsg: Message = {
    id: "a1",
    role: "assistant",
    content: "The model engine stopped while loading",
    failed: true,
  };

  it("shows the error alert and retry button when not generating", () => {
    const onRegenerate = vi.fn();
    render(
      <MessageItem
        msg={failedMsg}
        idx={1}
        isGenerating={false}
        isLast
        onRegenerate={onRegenerate}
        onSwitchVersion={() => {}}
        copiedIndex={null}
        copyToClipboard={() => {}}
        settings={{ ...defaultSettings, showMetrics: false }}
        onEditMessage={() => {}}
      />,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("The model engine stopped while loading")).toBeTruthy();
    const retryBtn = screen.getByRole("button", { name: "Retry" });
    expect(retryBtn).toBeTruthy();
    fireEvent.click(retryBtn);
    expect(onRegenerate).toHaveBeenCalledWith(1);
  });

  it("hides the error alert while generating a retry", () => {
    render(
      <MessageItem
        msg={{
          ...failedMsg,
          content: "",
          steps: [{ id: "s1", type: "loading", content: "Loading model 0.6s...", isComplete: false }],
        }}
        idx={1}
        isGenerating={true}
        isLast
        onRegenerate={() => {}}
        onSwitchVersion={() => {}}
        copiedIndex={null}
        copyToClipboard={() => {}}
        settings={{ ...defaultSettings, showMetrics: false }}
        onEditMessage={() => {}}
      />,
    );

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/Loading model/)).toBeTruthy();
  });

  it("does not show error alert on a successful earlier version when the latest attempt failed", () => {
    const multiVersionMsg: Message = {
      id: "a1",
      role: "assistant",
      content: "The model engine stopped while loading",
      failed: true,
      versions: [
        {
          content: "Hello! How can I help you today?",
          textContent: "Hello! How can I help you today?",
        },
      ],
      currentVersionIndex: 0,
    };

    render(
      <MessageItem
        msg={multiVersionMsg}
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

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Hello! How can I help you today?")).toBeTruthy();
    expect(screen.getByLabelText("Previous version")).toBeTruthy();
    expect(screen.getByLabelText("Next version")).toBeTruthy();
  });

  it("shows version switcher on a failed attempt when earlier versions exist", () => {
    const onSwitchVersion = vi.fn();
    const multiVersionMsg: Message = {
      id: "a1",
      role: "assistant",
      content: "The model engine stopped while loading",
      failed: true,
      versions: [
        {
          content: "Hello! How can I help you today?",
          textContent: "Hello! How can I help you today?",
        },
      ],
      currentVersionIndex: 1,
    };

    render(
      <MessageItem
        msg={multiVersionMsg}
        idx={1}
        isGenerating={false}
        isLast
        onRegenerate={() => {}}
        onSwitchVersion={onSwitchVersion}
        copiedIndex={null}
        copyToClipboard={() => {}}
        settings={{ ...defaultSettings, showMetrics: false }}
        onEditMessage={() => {}}
      />,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("The model engine stopped while loading")).toBeTruthy();
    const prevBtn = screen.getByLabelText("Previous version");
    expect(prevBtn).toBeTruthy();
    fireEvent.click(prevBtn);
    expect(onSwitchVersion).toHaveBeenCalledWith(1, 0);
  });

  it("shows both generated text and error alert when text was produced before failure", () => {
    const partialFailureMsg: Message = {
      id: "a1",
      role: "assistant",
      content: "Here is the partial solution before the crash.",
      textContent: "Here is the partial solution before the crash.",
      failed: true,
      error: "Connection terminated by host",
    };

    render(
      <MessageItem
        msg={partialFailureMsg}
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

    // Both the generated text and error alert are visible
    expect(screen.getByText("Here is the partial solution before the crash.")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Connection terminated by host")).toBeTruthy();

    // Verify ordering: generated text appears before error alert in the DOM
    const generatedEl = screen.getByText("Here is the partial solution before the crash.");
    const alertEl = screen.getByRole("alert");
    expect(generatedEl.compareDocumentPosition(alertEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Copy and retry actions are accessible
    expect(screen.getByLabelText("Copy reply")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("does not render the error as ai text when no text was generated", () => {
    const noTextFailureMsg: Message = {
      id: "a1",
      role: "assistant",
      content: "The model engine stopped while loading",
      failed: true,
      error: "The model engine stopped while loading",
    };

    render(
      <MessageItem
        msg={noTextFailureMsg}
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

    expect(screen.getByRole("alert")).toBeTruthy();
    const matches = screen.getAllByText("The model engine stopped while loading");
    expect(matches).toHaveLength(1);
    expect(screen.getByRole("alert").contains(matches[0])).toBe(true);
  });
});
