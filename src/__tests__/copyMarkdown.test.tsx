// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import { MARKDOWN_COMPONENTS, REHYPE_PLUGINS, REMARK_PLUGINS } from "../chat/markdown";
import { copyAsMarkdown, toMarkdown } from "../chat/copyMarkdown";

/** A copied piece of reply pastes back as Markdown, not as flattened text. */

afterEach(cleanup);

const rendered = (markdown: string) =>
  render(
    <div onCopy={copyAsMarkdown}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={MARKDOWN_COMPONENTS}>
        {markdown}
      </ReactMarkdown>
    </div>,
  ).container.firstElementChild as HTMLElement;

describe("toMarkdown", () => {
  it("keeps headings, emphasis, inline code and links", () => {
    const root = rendered("## Plan\n\nRun **all** the *tests* with `npm test`, see [docs](https://example.com).");

    expect(toMarkdown(root)).toBe(
      "## Plan\n\nRun **all** the *tests* with `npm test`, see [docs](https://example.com).",
    );
  });

  it("keeps nested lists, numbering and task boxes", () => {
    const root = rendered("1. First\n   - inner\n2. Second\n\n- [x] done\n- [ ] open");

    expect(toMarkdown(root)).toBe("1. First\n   - inner\n2. Second\n\n- [x] done\n- [ ] open");
  });

  it("fences a code block with its language and leaves its toolbar out", () => {
    const root = rendered("```ts\nconst a = 1;\n```");

    expect(toMarkdown(root)).toBe("```typescript\nconst a = 1;\n```");
  });

  it("keeps tables and quotes", () => {
    const root = rendered("| a | b |\n| - | - |\n| 1 | 2 |\n\n> quoted\n> twice");

    expect(toMarkdown(root)).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |\n\n> quoted\n> twice");
  });
});

describe("copying a selection", () => {
  const copy = (root: HTMLElement, from: Node, to: Node) => {
    const range = document.createRange();
    range.setStartBefore(from);
    range.setEndAfter(to);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const data: Record<string, string> = {};
    fireEvent.copy(root, { clipboardData: { setData: (type: string, value: string) => (data[type] = value) } });
    return data;
  };

  it("puts Markdown and HTML on the clipboard", () => {
    const root = rendered("Intro with **bold**.\n\n- one\n- two");
    const data = copy(root, root.querySelector("p")!, root.querySelector("ul")!);

    expect(data["text/plain"]).toBe("Intro with **bold**.\n\n- one\n- two");
    expect(data["text/html"]).toContain("<strong>bold</strong>");
  });

  it("leaves a selection inside one run of text to the browser", () => {
    const root = rendered("Just words here.");
    const text = root.querySelector("p")!.firstChild!;
    const data = copy(root, text, text);

    expect(data).toEqual({});
  });
});
