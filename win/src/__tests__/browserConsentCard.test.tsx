// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import BrowserConsentCard from "../chat/BrowserConsentCard";
import { translations } from "../translations";

/** The agent asks in the chat, with three answers. */

const t = (key: string) => translations.en[key] || key;

type Ask = { id: string; kind: "site" | "action"; host: string; detail: string } | null;
let pushConsent: (ask: Ask) => void = () => {};
let cleanedUp = false;
const answerConsent = vi.fn(async () => ({ success: true }));

beforeEach(() => {
  answerConsent.mockClear();
  cleanedUp = false;
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    browserAgent: {
      onConsent: (callback: typeof pushConsent) => {
        pushConsent = callback;
        return () => {
          cleanedUp = true;
        };
      },
      answerConsent,
    },
  };
});

afterEach(cleanup);

describe("the consent card in the chat", () => {
  it("shows nothing until the agent asks", () => {
    render(<BrowserConsentCard t={t} />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("names the site and offers session, once and deny", async () => {
    render(<BrowserConsentCard t={t} />);
    act(() => pushConsent({ id: "c1", kind: "site", host: "shop.test", detail: "" }));
    expect(screen.getByRole("alertdialog").textContent).toContain("shop.test");
    expect(screen.getByRole("button", { name: t("browserConsentSession") })).toBeTruthy();
    expect(screen.getByRole("button", { name: t("browserConsentOnce") })).toBeTruthy();
    expect(screen.getByRole("button", { name: t("browserConsentDeny") })).toBeTruthy();
    expect(screen.queryByText(/always/i)).toBeNull();
  });

  it("sends the choice and closes", async () => {
    render(<BrowserConsentCard t={t} />);
    act(() => pushConsent({ id: "c1", kind: "site", host: "shop.test", detail: "" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t("browserConsentSession") }));
    });
    expect(answerConsent).toHaveBeenCalledWith("c1", "session");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("shows the reason for an action and sends deny", async () => {
    render(<BrowserConsentCard t={t} />);
    act(() => pushConsent({ id: "c2", kind: "action", host: "shop.test", detail: "Buy now" }));
    expect(screen.getByRole("alertdialog").textContent).toContain("Buy now");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t("browserConsentDeny") }));
    });
    expect(answerConsent).toHaveBeenCalledWith("c2", "deny");
  });

  it("disables the buttons while the answer is on its way", () => {
    answerConsent.mockImplementationOnce(() => new Promise(() => {}));
    render(<BrowserConsentCard t={t} />);
    act(() => pushConsent({ id: "c3", kind: "site", host: "shop.test", detail: "" }));
    fireEvent.click(screen.getByRole("button", { name: t("browserConsentOnce") }));
    expect((screen.getByRole("button", { name: t("browserConsentSession") }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("clears when main withdraws the question", () => {
    render(<BrowserConsentCard t={t} />);
    act(() => pushConsent({ id: "c4", kind: "site", host: "shop.test", detail: "" }));
    act(() => pushConsent(null));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("stops listening when it unmounts", () => {
    const { unmount } = render(<BrowserConsentCard t={t} />);
    unmount();
    expect(cleanedUp).toBe(true);
  });
});
