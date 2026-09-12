// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import DiffBlock from "../chat/DiffBlock";
import { translations } from "../translations";

/**
 * The diff as the user meets it in the timeline. What matters is that the
 * changed lines are visible without opening anything, and that a big change
 * does not push the whole reply off the screen.
 */

const t = (key: string) => translations.en[key] || key;

afterEach(cleanup);

describe("a small change", () => {
  const before = "one\ntwo\nthree\n";
  const after = "one\nTWO\nthree\n";

  it("shows both versions of the line that changed", () => {
    render(<DiffBlock before={before} after={after} t={t} />);

    expect(screen.getByText("two")).toBeTruthy();
    expect(screen.getByText("TWO")).toBeTruthy();
  });

  it("says how much went in and out", () => {
    render(<DiffBlock before={before} after={after} t={t} />);

    expect(screen.getByText("+1 -1")).toBeTruthy();
  });

  it("does not ask to be opened when it all fits", () => {
    render(<DiffBlock before={before} after={after} t={t} />);

    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });
});

describe("a change with nothing in it", () => {
  it("renders nothing at all", () => {
    const { container } = render(
      <DiffBlock before={"same\n"} after={"same\n"} t={t} />,
    );

    expect(container.firstChild).toBeNull();
  });
});

describe("a long change", () => {
  const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
  const after = before
    .split("\n")
    .map((line, i) => (i % 2 === 0 ? `${line} changed` : line))
    .join("\n");

  it("shows the start of it and offers the rest", () => {
    render(<DiffBlock before={before} after={after} t={t} />);

    const more = screen.getByRole("button", { name: "Show more" });
    expect(more).toBeTruthy();
    expect(screen.queryByText("line 38 changed")).toBeNull();
  });

  it("opens the whole thing when asked", () => {
    render(<DiffBlock before={before} after={after} t={t} />);

    act(() => screen.getByRole("button", { name: "Show more" }).click());

    expect(screen.getByText("line 38 changed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });
});

describe("a change too big to line up", () => {
  it("counts it instead of drawing it", () => {
    const before = Array.from({ length: 900 }, (_, i) => `old ${i}`).join("\n");
    const after = Array.from({ length: 900 }, (_, i) => `new ${i}`).join("\n");

    render(<DiffBlock before={before} after={after} t={t} />);

    expect(screen.getByText("900 lines replaced with 900")).toBeTruthy();
  });
});
