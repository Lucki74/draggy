// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import StarNotice, { STAR_AFTER } from "../chat/StarNotice";
import { translations } from "../translations";

const t = (key: string) => translations.en[key] || key;
const card = () => screen.queryByText(translations.en.starNotice);

/** Runs `replies` generations to the end, the way the composer flips its prop. */
function finish(replies: number) {
  const view = render(<StarNotice generating={false} t={t} />);
  for (let i = 0; i < replies; i++) {
    view.rerender(<StarNotice generating t={t} />);
    view.rerender(<StarNotice generating={false} t={t} />);
  }
  return view;
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("the GitHub star card", () => {
  it("waits for a few finished replies", () => {
    finish(STAR_AFTER - 1);
    expect(card()).toBeNull();
  });

  it("shows after enough replies, but not while one is being written", () => {
    const view = finish(STAR_AFTER);
    expect(card()).toBeTruthy();
    view.rerender(<StarNotice generating t={t} />);
    expect(card()).toBeNull();
  });

  it("links to the repository", () => {
    finish(STAR_AFTER);
    const link = screen.getByRole("link", { name: "Star on GitHub" });
    expect(link.getAttribute("href")).toBe("https://github.com/Lucki74/draggy");
  });

  it("is shown once: dismissed or clicked, it never comes back", () => {
    finish(STAR_AFTER);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(card()).toBeNull();

    cleanup();
    finish(STAR_AFTER);
    expect(card()).toBeNull();
  });

  it("remembers the count across launches", () => {
    finish(STAR_AFTER - 1);
    cleanup();
    finish(1);
    expect(card()).toBeTruthy();
  });
});
