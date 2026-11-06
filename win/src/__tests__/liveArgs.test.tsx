// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import LiveArgs from "../chat/LiveArgs";
import type { SearchStep } from "../types";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const call = (value: string, open: boolean, complete = false): SearchStep => ({
  id: "s1",
  type: "tool_call",
  content: "",
  isComplete: false,
  tool: "write_note",
  liveArgs: { entries: [{ key: "text", value, kind: "string", open }], invalid: false, complete },
});

describe("LiveArgs", () => {
  it("shows a short value as a row and a long one in a wrapped tail box", async () => {
    const long = "word ".repeat(60);
    render(<LiveArgs step={{ ...call("hi", false), liveArgs: { entries: [{ key: "a", value: "hi", kind: "string", open: false }, { key: "b", value: long, kind: "string", open: false }], invalid: false, complete: true } }} />);
    expect(screen.getByText("hi")).toBeTruthy();
    const tail = screen.getByTestId("live-args-tail");
    expect(tail.className).toContain("overflow-x-hidden");
    expect(tail.className).toContain("break-words");
    expect(tail.textContent).toBe(long);
  });

  it("drops the fade when the value is complete and keeps it while open", () => {
    const long = "x".repeat(200);
    const { rerender } = render(<LiveArgs step={call(long, true)} />);
    expect(screen.getByTestId("live-args-tail").className).toContain("live-args-fade");
    rerender(<LiveArgs step={call(long, false, true)} />);
    expect(screen.getByTestId("live-args-tail").className).not.toContain("live-args-fade");
  });

  it("snaps to the whole text after the replay cap", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout"] });
    const long = "word ".repeat(2000);
    render(<LiveArgs step={call(long, true)} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByTestId("live-args-tail").textContent!.length).toBeLessThan(long.length);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(screen.getByTestId("live-args-tail").textContent).toBe(long);
  });

  it("shows a page address as the site name with no grid or tail box", () => {
    const step: SearchStep = {
      ...call("", false),
      tool: "read_url",
      liveArgs: { entries: [{ key: "url", value: "https://www.reddit.com/r/x/comments/1", kind: "string", open: true }], invalid: false, complete: false },
    };
    render(<LiveArgs step={step} />);
    expect(screen.getByTestId("live-args").textContent).toBe("Read reddit.com");
    expect(screen.queryByTestId("live-args-tail")).toBeNull();
    expect(document.querySelector("dl")).toBeNull();
  });

  it("renders markup as text", () => {
    render(<LiveArgs step={call("<img src=x onerror=alert(1)>", false, true)} />);
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });
});
