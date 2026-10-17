// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import BrowserBar from "../BrowserBar";
import { translations } from "../translations";

/** While the agent drives the pane, the bar says which step it is on and offers the way back. */

const t = (key: string) => translations.en[key] || key;

let pushAgent: (state: { active: boolean; step: string | null }) => void = () => {};
const stop = vi.fn(async () => ({ success: true }));

beforeEach(() => {
  stop.mockClear();
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    browserBar: {
      action: vi.fn(async () => ({ success: true })),
      setMenuOpen: vi.fn(async () => ({ success: true })),
      setAdblock: vi.fn(async () => ({ success: true })),
      onState: () => () => {},
    },
    browserAgent: {
      stop,
      onState: (callback: typeof pushAgent) => {
        pushAgent = callback;
        return () => {};
      },
      onConsent: () => () => {},
      answerConsent: vi.fn(async () => ({ success: true })),
    },
  };
});

afterEach(cleanup);

describe("the pane bar while the agent drives", () => {
  it("shows nothing extra when the agent is idle", () => {
    render(<BrowserBar t={t} embedded />);
    expect(screen.queryByRole("button", { name: t("browserAgentTakeOver") })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names the step and offers Take over", () => {
    render(<BrowserBar t={t} embedded />);
    act(() => pushAgent({ active: true, step: "clicking" }));
    expect(screen.getByRole("status").textContent).toBe(t("browserAgentClicking"));
    expect(screen.getByRole("button", { name: t("browserAgentTakeOver") })).toBeTruthy();
  });

  it("asks main to stop the step when the user takes over", () => {
    render(<BrowserBar t={t} embedded />);
    act(() => pushAgent({ active: true, step: "reading" }));
    fireEvent.click(screen.getByRole("button", { name: t("browserAgentTakeOver") }));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("goes back to the plain bar when the step ends", () => {
    render(<BrowserBar t={t} embedded />);
    act(() => pushAgent({ active: true, step: "typing" }));
    act(() => pushAgent({ active: false, step: null }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("no longer asks for consent in the bar", () => {
    const onConsent = vi.fn(() => () => {});
    (window as unknown as { electronAPI: { browserAgent: { onConsent: unknown } } }).electronAPI.browserAgent.onConsent =
      onConsent;
    render(<BrowserBar t={t} embedded />);
    expect(onConsent).not.toHaveBeenCalled();
  });

  it("does not listen in the separate browser window", () => {
    const onState = vi.fn(() => () => {});
    (window as unknown as { electronAPI: { browserAgent: { onState: unknown } } }).electronAPI.browserAgent.onState =
      onState;
    render(<BrowserBar t={t} />);
    expect(onState).not.toHaveBeenCalled();
  });
});
