// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { FilePreview } from "../chat/FilePreview";

/** A long plain-text file is windowed; scrolling must reveal the lines at the new offset. */

afterEach(() => {
  cleanup();
});

const longText = Array.from({ length: 5000 }, (_, i) => `row ${i}`).join("\n");

function scrollerOf(container: HTMLElement): HTMLElement {
  const pre = container.querySelector("pre");
  if (!pre?.parentElement) throw new Error("no scroller");
  return pre.parentElement;
}

function rendered(container: HTMLElement): string {
  return scrollerOf(container).textContent ?? "";
}

describe("FilePreview long file scrolling", () => {
  it("renders the lines at the scrolled offset and not the end of the file", () => {
    const { container } = render(<FilePreview filename="app.log" content={longText} fullHeight />);

    fireEvent.scroll(scrollerOf(container), { target: { scrollTop: 2000 } });

    expect(rendered(container)).toContain("row 100");
    expect(rendered(container)).not.toContain("row 4999");
  });

  it("keeps the rows under one wheel notch in the window", () => {
    const { container } = render(<FilePreview filename="app.log" content={longText} fullHeight />);
    const scroller = scrollerOf(container);

    fireEvent.scroll(scroller, { target: { scrollTop: 2000 } });
    fireEvent.wheel(scroller, { deltaY: 100 });
    fireEvent.scroll(scroller, { target: { scrollTop: 2100 } });

    expect(rendered(container)).toContain("row 105");
  });

  it("windows to the real scroller height, so a tall pane has no blank tail", () => {
    const { container } = render(<FilePreview filename="app.log" content={longText} fullHeight />);
    const scroller = scrollerOf(container);
    Object.defineProperty(scroller, "clientHeight", { value: 1200, configurable: true });

    fireEvent.scroll(scroller, { target: { scrollTop: 2000 } });

    expect(rendered(container)).toContain("row 185");
  });
});
