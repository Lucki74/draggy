// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import {
  DOCUMENT_REMARK_PLUGINS,
  MARKDOWN_COMPONENTS,
  REHYPE_PLUGINS,
} from "../chat/markdown";

/** Exercises markdown rendering: GitHub alert callouts, document remark plugins, and sanitization. */

afterEach(() => {
  cleanup();
});

describe("Markdown alert callouts", () => {
  it("renders a WARNING callout with title and stripped marker", () => {
    const md = "> [!WARNING]\n> Install from official sources only.";
    render(
      <ReactMarkdown
        remarkPlugins={DOCUMENT_REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {md}
      </ReactMarkdown>,
    );

    expect(screen.getByText("Warning")).toBeTruthy();
    expect(screen.getByText("Install from official sources only.")).toBeTruthy();
    expect(screen.queryByText(/\[!WARNING\]/)).toBeNull();
  });

  it("renders NOTE, TIP, IMPORTANT, and CAUTION callouts", () => {
    const alerts = [
      { text: "> [!NOTE]\n> Notable info.", label: "Note" },
      { text: "> [!TIP]\n> Pro tip.", label: "Tip" },
      { text: "> [!IMPORTANT]\n> Important details.", label: "Important" },
      { text: "> [!CAUTION]\n> Watch out.", label: "Caution" },
    ];

    for (const alert of alerts) {
      const { unmount } = render(
        <ReactMarkdown
          remarkPlugins={DOCUMENT_REMARK_PLUGINS}
          rehypePlugins={REHYPE_PLUGINS}
          components={MARKDOWN_COMPONENTS}
        >
          {alert.text}
        </ReactMarkdown>,
      );

      expect(screen.getByText(alert.label)).toBeTruthy();
      unmount();
    }
  });

  it("renders ordinary blockquotes as blockquote elements without alert headers", () => {
    const md = "> Simple cited quote.";
    const { container } = render(
      <ReactMarkdown
        remarkPlugins={DOCUMENT_REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {md}
      </ReactMarkdown>,
    );

    expect(container.querySelector("blockquote")).toBeTruthy();
    expect(screen.queryByText("Warning")).toBeNull();
    expect(screen.queryByText("Note")).toBeNull();
  });
});
