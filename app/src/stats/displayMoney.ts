import { useSyncExternalStore } from "react";

/** The currency costs are shown in and how many of it one US dollar buys. Costs are stored in dollars. */
export interface DisplayMoney {
  currency: string;
  rate: number;
}

/** The currencies offered in Settings. The exchange-rate feed carries them all. */
export const DISPLAY_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "CNY", "INR", "BRL"] as const;

export const US_DOLLARS: DisplayMoney = { currency: "USD", rate: 1 };

let current: DisplayMoney = US_DOLLARS;
const listeners = new Set<() => void>();

/** Picks the display currency. A currency with no known rate shows in dollars rather than as a wrong figure. */
export function resolveDisplayMoney(currency: string | undefined, rates: Record<string, number> | null | undefined): DisplayMoney {
  const code = (currency ?? "USD").toUpperCase();
  const rate = rates?.[code];
  if (code === "USD" || typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return US_DOLLARS;
  return { currency: code, rate };
}

export function setDisplayMoney(next: DisplayMoney): void {
  if (next.currency === current.currency && next.rate === current.rate) return;
  current = next;
  listeners.forEach((listener) => listener());
}

export const getDisplayMoney = (): DisplayMoney => current;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The display currency, re-rendering the caller when the setting or the rates change. */
export function useDisplayMoney(): DisplayMoney {
  return useSyncExternalStore(subscribe, getDisplayMoney);
}
