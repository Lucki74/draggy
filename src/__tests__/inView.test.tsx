// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import InView from "../chat/InView";

/** Off-screen rows unmount but keep their height, so the scrollbar does not jump. */

type Callback = (entries: Array<{ isIntersecting: boolean }>) => void;

let callback: Callback | null = null;
const disconnect = vi.fn();

class FakeObserver {
  constructor(cb: Callback) {
    callback = cb;
  }
  observe() {}
  disconnect = disconnect;
}

const intersect = (isIntersecting: boolean) => act(() => callback?.([{ isIntersecting }]));

function stubHeight(height: number) {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(height);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  callback = null;
  disconnect.mockClear();
});

describe("InView", () => {
  it("renders children when IntersectionObserver is undefined", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<InView>content</InView>);
    expect(screen.getByText("content")).toBeTruthy();
  });

  it("holds children back until the element is near the viewport", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    render(<InView>content</InView>);
    expect(screen.queryByText("content")).toBeNull();
  });

  it("renders children when intersecting", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    render(<InView>content</InView>);
    intersect(true);
    expect(screen.getByText("content")).toBeTruthy();
  });

  it("unmounts children when non-intersecting and keeps the measured height", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    stubHeight(150);
    const { container } = render(<InView estimatedHeight={72}>content</InView>);
    intersect(true);
    intersect(false);

    expect(screen.queryByText("content")).toBeNull();
    expect((container.firstChild as HTMLElement).style.minHeight).toBe("150px");
  });

  it("falls back to the estimated height when nothing was ever measured", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const { container } = render(<InView estimatedHeight={72}>content</InView>);
    expect((container.firstChild as HTMLElement).style.minHeight).toBe("72px");
  });

  it("renders children unconditionally when forceRender is true", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    render(<InView forceRender>content</InView>);
    expect(screen.getByText("content")).toBeTruthy();
  });
});
