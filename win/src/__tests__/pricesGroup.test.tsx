// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import PricesGroup from "../settings/PricesGroup";
import { defaultSettings } from "../app/settings";
import { getDisplayMoney, resolveDisplayMoney, setDisplayMoney, US_DOLLARS } from "../stats/displayMoney";
import { DEFAULT_REFERENCE, formatReference, parseReference } from "../stats/pricing";
import { turnCostLabel } from "../stats/turnCostLabel";
import { translations } from "../translations";
import type { PricingStatus, TurnCost } from "../types";

const t = (key: string) => (translations.en as Record<string, string>)[key] ?? key;

const status: PricingStatus = {
  origin: "live",
  pricesGeneratedAt: "2026-10-27T04:00:00.000Z",
  priceCount: 1400,
  ratesDate: "2026-10-27",
  pricesAt: 1,
  pricesError: null,
  ratesAt: 1,
  ratesError: null,
};

let refresh: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refresh = vi.fn(async () => ({ success: true, prices: { ok: true }, rates: { ok: true }, status }));
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    pricing: { status: async () => ({ success: true, status }), refresh, onUpdated: () => () => {} },
  };
});

afterEach(() => {
  cleanup();
  setDisplayMoney(US_DOLLARS);
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("the prices settings", () => {
  it("turns the automatic refresh off", () => {
    const onUpdate = vi.fn();
    render(<PricesGroup settings={defaultSettings} onUpdate={onUpdate} t={t} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onUpdate).toHaveBeenCalledWith({ priceRefresh: false });
  });

  it("shows where the prices and rates come from", async () => {
    render(<PricesGroup settings={defaultSettings} onUpdate={() => {}} t={t} />);
    await waitFor(() => expect(screen.getByText(/Prices downloaded 2026-10-27/)).toBeTruthy());
    expect(screen.getByText(/Rates 2026-10-27/)).toBeTruthy();
  });

  it("updates on request and reports a failure", async () => {
    render(<PricesGroup settings={defaultSettings} onUpdate={() => {}} t={t} />);
    fireEvent.click(screen.getByRole("button", { name: "Update now" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();

    refresh.mockResolvedValueOnce({ success: false, prices: { ok: false, error: "offline" } });
    fireEvent.click(screen.getByRole("button", { name: "Update now" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("offline"));
  });
});

describe("the display currency", () => {
  it("applies a rate and falls back to dollars without one", () => {
    expect(resolveDisplayMoney("eur", { EUR: 0.9 })).toEqual({ currency: "EUR", rate: 0.9 });
    expect(resolveDisplayMoney("EUR", null)).toEqual(US_DOLLARS);
    expect(resolveDisplayMoney("EUR", { EUR: 0 })).toEqual(US_DOLLARS);
    expect(resolveDisplayMoney(undefined, { EUR: 0.9 })).toEqual(US_DOLLARS);
  });

  it("notifies when it changes and ignores an identical value", () => {
    const next = { currency: "EUR", rate: 0.9 };
    act(() => setDisplayMoney(next));
    expect(getDisplayMoney()).toEqual(next);
  });

  it("converts the figure in the reply footer", () => {
    const cost: TurnCost = { kind: "billed", costMicros: 1_000_000, costSource: "table", outputTokens: 10, inputTokens: 10 };
    const label = turnCostLabel(cost, t, "en-US", { currency: "EUR", rate: 0.9 });
    expect(label?.text).toContain("0.90");
    expect(label?.text).toContain("€");
  });
});

describe("the reference model setting", () => {
  it("round-trips and falls back on a bad value", () => {
    expect(parseReference(formatReference({ provider: "openai", model: "gpt-4o" }))).toEqual({ provider: "openai", model: "gpt-4o" });
    expect(parseReference(undefined)).toEqual(DEFAULT_REFERENCE);
    expect(parseReference("nonsense")).toEqual(DEFAULT_REFERENCE);
    expect(parseReference("openai/")).toEqual(DEFAULT_REFERENCE);
  });
});
