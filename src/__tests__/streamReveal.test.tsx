// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import type { Element, Root } from "hast";
import {
  FADE_MS,
  advanceReveal,
  blockStarts,
  nextWordEnd,
  rehypeStreamWords,
  settledPosition,
} from "../chat/streamReveal";
import StreamingMarkdown from "../chat/StreamingMarkdown";

/** A streamed reply is revealed a word at a time at an even pace, each word fading in, and only the
 * block still being written is rendered again. */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("where the next word ends", () => {
  it("waits for a word still arriving at the end of a live stream", () => {
    expect(nextWordEnd("Hello wor", 5, true)).toBe(5);
    expect(nextWordEnd("Hello wor", 5, false)).toBe(9);
    expect(nextWordEnd("Hello world ", 5, true)).toBe(11);
  });

  it("counts each CJK character as a word, since that text has no spaces", () => {
    expect(nextWordEnd("你好世界", 0, true)).toBe(1);
    expect(nextWordEnd("你好世界", 1, true)).toBe(2);
  });

  it("does not hold back a long run with no space in it", () => {
    const url = "https://example.com/a/very/long/path/that/keeps/going";
    expect(nextWordEnd(url, 0, true)).toBe(24);
  });
});

describe("the pace of the reveal", () => {
  const burst = "one two three four five six seven eight nine ten ".repeat(6);

  it("spreads a burst over frames rather than showing it at once", () => {
    const first = advanceReveal(burst, { position: 0, budget: 0 }, 16, true);

    expect(first.position).toBeGreaterThan(0);
    expect(first.position).toBeLessThan(burst.length / 4);
  });

  it("only ever stops at the end of a word", () => {
    let state = { position: 0, budget: 0 };
    for (let frame = 0; frame < 12; frame++) {
      state = advanceReveal(burst, state, 16, true);
      expect(state.position === 0 || /\s/.test(burst[state.position]) || state.position === burst.length).toBe(true);
    }
  });

  it("runs about a quarter of a second behind, and catches up once the text stops coming", () => {
    let state = { position: 0, budget: 0 };
    for (let elapsed = 0; elapsed < 250; elapsed += 16) state = advanceReveal(burst, state, 16, true);
    expect(state.position).toBeGreaterThan(burst.length / 2);

    for (let elapsed = 0; elapsed < 1200; elapsed += 16) state = advanceReveal(burst, state, 16, true);
    // Trailing space waits for what follows it, which changes nothing on screen.
    expect(state.position).toBe(burst.trimEnd().length);
  });

  it("saves nothing up while no word is ready, so a stall does not end in a burst", () => {
    const stalled = advanceReveal("Hello wor", { position: 5, budget: 0 }, 2000, true);
    expect(stalled).toEqual({ position: 5, budget: 0 });
  });

  it("shows what is left quickly once the stream has ended", () => {
    let state = { position: 0, budget: 0 };
    for (let elapsed = 0; elapsed < 350; elapsed += 16) state = advanceReveal(burst, state, 16, false);

    expect(state.position).toBe(burst.length);
  });
});

describe("what has finished fading in", () => {
  it("is how far the reveal had got a whole fade ago", () => {
    const marks = [
      { at: -Infinity, position: 0 },
      { at: 100, position: 6 },
      { at: 300, position: 12 },
    ];

    expect(settledPosition(marks, 100 + FADE_MS - 1)).toBe(0);
    expect(settledPosition(marks, 100 + FADE_MS)).toBe(6);
    expect(settledPosition(marks, 300 + FADE_MS)).toBe(12);
  });
});

describe("splitting a reply into blocks", () => {
  const reply = [
    "# Title",
    "",
    "A paragraph.",
    "",
    "1. First",
    "",
    "   ```js",
    "   const a = 1;",
    "   ```",
    "",
    "2. Second",
    "",
    "| a | b |",
    "| - | - |",
    "| 1 | 2 |",
    "",
    "Last words",
  ].join("\n");

  it("keeps a list whole, code indented under an item included", () => {
    const starts = blockStarts(reply);
    const slices = starts.map((start, index) => reply.slice(start, starts[index + 1]));

    expect(slices).toHaveLength(5);
    expect(slices[2]).toContain("2. Second");
    expect(slices[2]).toContain("const a = 1;");
  });

  it("finds the same blocks when parsing only the end of a grown reply", () => {
    const half = reply.slice(0, reply.indexOf("| a |"));
    const earlier = { source: half, starts: blockStarts(half) };

    expect(blockStarts(reply, earlier)).toEqual(blockStarts(reply));
  });
});

describe("wrapping the newest words", () => {
  const hast = (markdown: string) => {
    const processor = unified().use(remarkParse).use(remarkRehype);
    return processor.runSync(processor.parse(markdown)) as Root;
  };

  const spans = (tree: Root) => {
    const found: string[] = [];
    const walk = (node: Root | Element) => {
      for (const child of node.children) {
        if (child.type !== "element") continue;
        if (child.tagName === "span") found.push((child.children[0] as { value: string }).value);
        else walk(child);
      }
    };
    walk(tree);
    return found;
  };

  it("wraps only words at or past the offset, leaving the rest plain", () => {
    const tree = hast("Some settled words then new ones");
    rehypeStreamWords({ from: 18 })(tree);

    expect(spans(tree)).toEqual(["then", "new", "ones"]);
  });

  it("leaves code alone, so it keeps its layout", () => {
    const tree = hast("Run `npm test` now\n\n```\nnpm run build\n```");
    rehypeStreamWords({ from: 0 })(tree);

    expect(spans(tree)).toEqual(["Run", "now"]);
  });
});

describe("the streaming component", () => {
  const frames = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  it("reveals a live reply over time and ends with no fading words left", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout"] });
    const text = "Memory decides what fits on the card you pick. ";

    const { container, rerender } = render(
      <StreamingMarkdown source={text} streaming animateOnMount />,
    );
    expect(container.textContent).toBe("");

    await frames(50);
    const partway = container.textContent ?? "";
    expect(partway.length).toBeGreaterThan(0);
    expect(partway.length).toBeLessThan(text.trim().length);
    expect(container.querySelectorAll(".stream-word").length).toBeGreaterThan(0);

    rerender(<StreamingMarkdown source={text} streaming={false} animateOnMount />);
    await frames(1500);

    expect(container.textContent).toBe(text.trim());
    expect(container.querySelectorAll(".stream-word")).toHaveLength(0);
  });

  it("shows a finished reply as it is, with nothing to fade", () => {
    const { container } = render(
      <StreamingMarkdown source={"Already **written**."} streaming={false} animateOnMount={false} />,
    );

    expect(container.textContent).toBe("Already written.");
    expect(container.querySelector("strong")?.textContent).toBe("written");
    expect(container.querySelectorAll(".stream-word")).toHaveLength(0);
  });

  it("carries on from where it was when the text grows, instead of fading it all again", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout"] });
    const first = "The first sentence is here. ";

    const { container, rerender } = render(
      <StreamingMarkdown source={first} streaming animateOnMount />,
    );
    await frames(1500);
    expect(container.textContent).toBe(first.trim());

    rerender(<StreamingMarkdown source={`${first}And more follows. `} streaming animateOnMount />);
    await frames(20);

    const fading = [...container.querySelectorAll(".stream-word")].map((node) => node.textContent);
    expect(fading).not.toContain("first");
    expect(container.textContent?.startsWith(first.trim())).toBe(true);
  });
});
