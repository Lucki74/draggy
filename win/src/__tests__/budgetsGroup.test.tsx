// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import BudgetsGroup from "../settings/BudgetsGroup";
import { DEFAULT_BUDGETS } from "../stats/budget";
import { defaultSettings } from "../app/settings";
import { translations } from "../translations";
import type { AppSettings, BudgetSettings } from "../types";

const t = (key: string) => (translations.en as Record<string, string>)[key] ?? key;

const withBudgets = (budgets: BudgetSettings): AppSettings => ({ ...defaultSettings, budgets });

beforeEach(() => {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    providers: { list: async () => [{ id: "openai", kind: "cloud", enabled: true, label: "OpenAI" }] },
  };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("the budgets settings", () => {
  it("hides the limits until budgets are switched on", () => {
    render(<BudgetsGroup settings={withBudgets(DEFAULT_BUDGETS)} onUpdate={() => {}} t={t} />);
    expect(screen.queryByLabelText("All providers: per day")).toBeNull();
  });

  it("turns budgets on", () => {
    const onUpdate = vi.fn();
    render(<BudgetsGroup settings={withBudgets(DEFAULT_BUDGETS)} onUpdate={onUpdate} t={t} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onUpdate).toHaveBeenCalledWith({ budgets: { ...DEFAULT_BUDGETS, enabled: true } });
  });

  it("stores a typed dollar amount as micro-dollars and clears it when emptied", () => {
    const onUpdate = vi.fn();
    render(<BudgetsGroup settings={withBudgets({ ...DEFAULT_BUDGETS, enabled: true })} onUpdate={onUpdate} t={t} />);
    const daily = screen.getByLabelText("All providers: per day");
    fireEvent.change(daily, { target: { value: "2.5" } });
    fireEvent.blur(daily);
    expect(onUpdate).toHaveBeenLastCalledWith({
      budgets: { enabled: true, global: { dailyMicros: 2_500_000, monthlyMicros: null }, providers: {} },
    });
    fireEvent.change(daily, { target: { value: "" } });
    fireEvent.blur(daily);
    expect(onUpdate).toHaveBeenLastCalledWith({
      budgets: { enabled: true, global: { dailyMicros: null, monthlyMicros: null }, providers: {} },
    });
  });

  it("offers a limit for each enabled paid provider", async () => {
    const onUpdate = vi.fn();
    render(<BudgetsGroup settings={withBudgets({ ...DEFAULT_BUDGETS, enabled: true })} onUpdate={onUpdate} t={t} />);
    const monthly = await waitFor(() => screen.getByLabelText("OpenAI: per month"));
    fireEvent.change(monthly, { target: { value: "20" } });
    fireEvent.blur(monthly);
    expect(onUpdate).toHaveBeenLastCalledWith({
      budgets: {
        enabled: true,
        global: { dailyMicros: null, monthlyMicros: null },
        providers: { openai: { dailyMicros: null, monthlyMicros: 20_000_000 } },
      },
    });
  });
});
