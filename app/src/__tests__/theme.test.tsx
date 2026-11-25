// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { defaultSettings, resolveTheme, useSettings } from "../app/settings";

describe("resolving the theme", () => {
  it("covers every setting against either system preference", () => {
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
  });

  it("starts a new install on the system's theme", () => {
    expect(defaultSettings.theme).toBe("system");
  });
});

/** A media query the test can flip, as the operating system would. */
function fakeSystem(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: dark,
    addEventListener: vi.fn((_: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_: string, listener: () => void) => listeners.delete(listener)),
  };
  window.matchMedia = vi.fn(() => query) as unknown as typeof window.matchMedia;
  return {
    query,
    listeners,
    flip(next: boolean) {
      query.matches = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

afterEach(() => {
  localStorage.clear();
  document.body.classList.remove("dark");
});

describe("following the system", () => {
  it("follows the operating system while the app is open, and stops when a fixed theme is chosen", () => {
    const system = fakeSystem(false);
    const { result } = renderHook(() => useSettings(true));
    expect(document.body.classList.contains("dark")).toBe(false);

    act(() => system.flip(true));
    expect(document.body.classList.contains("dark")).toBe(true);

    act(() => result.current[1]((prev) => ({ ...prev, theme: "light" })));
    expect(document.body.classList.contains("dark")).toBe(false);
    expect(system.listeners.size).toBe(0);

    act(() => system.flip(true));
    expect(document.body.classList.contains("dark")).toBe(false);
  });
});
