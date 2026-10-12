// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MAX_WORD_CHARS, advanceReveal, blockStarts, nextWordEnd } from "../chat/streamReveal";
import StreamingMarkdown from "../chat/StreamingMarkdown";

/** A streamed reply is revealed a word at a time at an even pace, and only the block still
 * being written is rendered again. */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("where the next word ends", () => {
  it("waits for a word still arriving at the end of a live stream", () => {
    expect(nextWordEnd("Hello wor", 0, true)).toBe(6);
    expect(nextWordEnd("Hello wor", 6, true)).toBe(6);
    expect(nextWordEnd("Hello wor", 6, false)).toBe(9);
    expect(nextWordEnd("Hello\nworld", 0, true)).toBe(6);
  });

  it("takes the spaces after a word with it", () => {
    expect(nextWordEnd("one   two", 0, true)).toBe(6);
  });

  it("cuts a run with no space in it at the width", () => {
    expect(nextWordEnd("õ¢á".repeat(100), 0, true)).toBe(MAX_WORD_CHARS);
  });
});

describe("the pace of the reveal", () => {
  const burst = "one two three four five six seven eight nine ten ".repeat(6);

  it("spreads a burst over frames rather than showing it at once", () => {
    let state = { position: 0, budget: 0 };
    for (let frame = 0; frame < 6; frame++) state = advanceReveal(burst, state, 16, true);

    expect(state.position).toBeGreaterThan(0);
    expect(state.position).toBeLessThan(burst.length / 2);
  });

  it("only ever stops at the end of a word", () => {
    let state = { position: 0, budget: 0 };
    for (let frame = 0; frame < 30; frame++) {
      state = advanceReveal(burst, state, 16, true);
      expect(state.position === 0 || burst[state.position - 1] === " ").toBe(true);
    }
  });

  it("runs a fraction of a second behind, holding back only the word still arriving", () => {
    let state = { position: 0, budget: 0 };
    for (let elapsed = 0; elapsed < 250; elapsed += 16) state = advanceReveal(burst, state, 16, true);
    expect(state.position).toBeGreaterThan(burst.length / 3);

    for (let elapsed = 0; elapsed < 1200; elapsed += 16) state = advanceReveal(burst, state, 16, true);
    expect(burst.length - state.position).toBeLessThanOrEqual(MAX_WORD_CHARS);
  });

  it("saves nothing up while no word is ready, so a stall does not end in a burst", () => {
    const stalled = advanceReveal("Hello", { position: 0, budget: 0 }, 2000, true);
    expect(stalled).toEqual({ position: 0, budget: 0 });
  });

  it("shows what is left quickly once the stream has ended", () => {
    let state = { position: 0, budget: 0 };
    for (let elapsed = 0; elapsed < 350; elapsed += 16) state = advanceReveal(burst, state, 16, false);

    expect(state.position).toBe(burst.length);
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

describe("the streaming component", () => {
  const frames = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  it("reveals a live reply a word at a time, then all of it once the reply ends", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout"] });
    const text = "Memory decides what fits on the card you pick. ".repeat(4);

    const { container, rerender } = render(
      <StreamingMarkdown source={text} streaming animateOnMount />,
    );
    expect(container.textContent).toBe("");

    await frames(150);
    const partway = container.textContent ?? "";
    expect(partway.length).toBeGreaterThan(0);
    expect(partway.length).toBeLessThan(text.trim().length);
    expect(text.startsWith(partway)).toBe(true);

    rerender(<StreamingMarkdown source={text} streaming={false} animateOnMount />);
    await frames(1500);

    expect(container.textContent).toBe(text.trim());
  });

  it("shows a finished reply as it is", () => {
    const { container } = render(
      <StreamingMarkdown source={"Already **written**."} streaming={false} animateOnMount={false} />,
    );

    expect(container.textContent).toBe("Already written.");
    expect(container.querySelector("strong")?.textContent).toBe("written");
  });

  it("carries on from where it was when the text grows", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout"] });
    const first = "The first sentence is here. ";

    const { container, rerender } = render(
      <StreamingMarkdown source={first} streaming animateOnMount />,
    );
    await frames(1500);
    expect(container.textContent).toBe(first.trim());

    rerender(<StreamingMarkdown source={`${first}And more follows. `} streaming animateOnMount />);
    await frames(20);

    expect(container.textContent?.startsWith(first.trim())).toBe(true);
  });

  it("keeps the ember caret on the line being written, and drops it when the reply ends", () => {
    const source = "First paragraph.\n\nSecond **one** here.";
    const { container, rerender } = render(
      <StreamingMarkdown source={source} streaming animateOnMount={false} />,
    );

    const carets = container.querySelectorAll(".ember-caret");
    expect(carets).toHaveLength(1);
    expect(carets[0].parentElement?.tagName).toBe("P");
    expect(container.querySelectorAll(".stream-word").length).toBeGreaterThan(0);
    expect(carets[0].parentElement?.textContent).toBe("Second one here.");

    rerender(<StreamingMarkdown source={source} streaming={false} animateOnMount={false} />);
    expect(container.querySelectorAll(".ember-caret")).toHaveLength(0);
  });

  it("never puts the caret inside a void element such as a trailing line break", () => {
    for (const source of [
      "Hello there<br>",
      "Hello there  \n",
      "Hello\n\n---",
      "Hi ![x](a.png)",
      "Raw text <param>",
      "Raw text <keygen>",
      "Raw <wbr>",
      "Inline <input value=\"a\"> <img src=\"a.png\"> end",
    ]) {
      expect(() =>
        render(<StreamingMarkdown source={source} streaming animateOnMount={false} />),
      ).not.toThrow();
      cleanup();
    }
  });
});
