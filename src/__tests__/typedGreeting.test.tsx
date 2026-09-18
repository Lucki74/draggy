// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import TypedGreeting from "../TypedGreeting";

/** Tests the smooth typed greeting with character-by-character reveals and caret. */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TypedGreeting", () => {
  it("renders screen reader text immediately and types visible characters", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"],
    });

    const { container } = render(<TypedGreeting text="Hello" />);

    expect(container.querySelector(".sr-only")?.textContent).toBe("Hello");
    expect(container.querySelector(".typing-caret")).toBeTruthy();

    for (let i = 0; i < 10; i++) {
      await act(async () => {
        vi.advanceTimersByTime(50);
      });
    }

    const visibleChars = Array.from(container.querySelectorAll(".typing-char")).map(
      (el) => el.textContent,
    );
    expect(visibleChars.join("")).toBe("Hello");
  });
});
