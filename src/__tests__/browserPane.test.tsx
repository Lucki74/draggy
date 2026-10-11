// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import BrowserPane from "../browser/BrowserPane";
import { registerOverlay } from "../ui/overlays";
import { translations } from "../translations";

/** The Browser pane only reports where its body is and whether the native page should show. */

const t = (key: string) => translations.en[key] || key;

let pushState: (state: Record<string, unknown>) => void = () => {};
let calls: unknown[] = [];

const PAGE = {
  url: "https://example.com/",
  title: "Example",
  canGoBack: false,
  canGoForward: false,
  loading: false,
  adblock: true,
};

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => {
    run();
    return 0;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(800, 80, 400, 600));
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    browserBar: {
      action: vi.fn(async () => ({ success: true })),
      setMenuOpen: vi.fn(async () => ({ success: true })),
      setAdblock: vi.fn(async () => ({ success: true })),
      onState: (callback: (state: Record<string, unknown>) => void) => {
        pushState = callback;
        return () => {};
      },
    },
    browserPane: {
      setBounds: async (rect: unknown) => {
        calls.push(rect);
        return { success: true };
      },
      setVisible: async (visible: boolean) => {
        calls.push(visible);
        return { success: true };
      },
      onOpen: () => () => {},
    },
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("BrowserPane", () => {
  it("keeps the page hidden and explains itself before anything is open", () => {
    render(<BrowserPane t={t} />);
    expect(screen.getByText(t("browserEmpty"))).toBeTruthy();
    expect(calls).toContainEqual({ x: 800, y: 80, width: 400, height: 600 });
    expect(calls.at(-1)).toBe(false);
  });

  it("shows the page once one has loaded, and hides it again on unmount", () => {
    const { unmount } = render(<BrowserPane t={t} />);
    act(() => pushState(PAGE));
    expect(screen.queryByText(t("browserEmpty"))).toBeNull();
    expect(calls.at(-1)).toBe(true);

    unmount();
    expect(calls.at(-1)).toBe(false);
  });

  it("steps aside while a menu or dialog overlaps it", () => {
    render(<BrowserPane t={t} />);
    act(() => pushState(PAGE));
    expect(calls.at(-1)).toBe(true);

    let close = () => {};
    act(() => {
      close = registerOverlay(() => new DOMRect(900, 100, 200, 200));
    });
    expect(calls.at(-1)).toBe(false);

    act(() => close());
    expect(calls.at(-1)).toBe(true);
  });

  it("stays put for a layer somewhere else in the window", () => {
    render(<BrowserPane t={t} />);
    act(() => pushState(PAGE));
    const before = calls.length;

    let close = () => {};
    act(() => {
      close = registerOverlay(() => new DOMRect(10, 10, 200, 200));
    });
    expect(calls.length).toBe(before);
    act(() => close());
  });
});
