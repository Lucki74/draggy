// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CostSection from "../stats/CostSection";
import { summarizeCost } from "../stats/costSummary";
import { translations } from "../translations";
import type { MetricRow } from "../types";

afterEach(cleanup);

const t = (key: string) => (translations.en as Record<string, string>)[key] ?? key;
const noon = (day: number) => new Date(2026, 9, day, 12).getTime();

const row = (extra: Partial<MetricRow> = {}): MetricRow => ({
  recordedAt: noon(20),
  workspaceId: "w1",
  chatId: "c1",
  model: "@openai/gpt-4o",
  promptTokens: 1000,
  responseTokens: 500,
  responseMs: 5000,
  firstTokenMs: 300,
  loadMs: 0,
  taskMs: 6000,
  loops: 1,
  tools: {},
  providerId: "openai",
  kind: "billed",
  costMicros: 1_250_000,
  costSource: "table",
  ...extra,
});

const show = (rows: MetricRow[], options?: Parameters<typeof summarizeCost>[1]) =>
  render(<CostSection t={t} cost={summarizeCost(rows, options)} from={noon(19)} to={noon(22)} locale="en-US" />);

describe("the cost section of the statistics", () => {
  it("shows what was spent, a bar per day and the providers", () => {
    const { container } = show([row(), row({ costMicros: 250_000 })]);
    expect(screen.getAllByText("Spent").length).toBeTruthy();
    expect(screen.getAllByText("$1.50").length).toBeGreaterThan(0);
    expect(container.querySelectorAll("svg rect")).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Cost per day" })).toBeTruthy();
    expect(screen.getByText("openai")).toBeTruthy();
  });

  it("swaps the chart for a table of the same days", () => {
    const { container } = show([row()]);
    fireEvent.click(screen.getByRole("button", { name: "Show as table" }));
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByText("2026-10-20")).toBeTruthy();
    expect(screen.getByText("2026-10-21")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show as chart" }));
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("keeps plan value apart from spent and explains it", () => {
    show([row({ kind: "account", providerId: "claude", costMicros: 3_000_000 })]);
    expect(screen.getAllByText("Plan value").length).toBeTruthy();
    expect(screen.getAllByText("~$3.00").length).toBeGreaterThan(0);
    expect(screen.getByText(/Nothing was billed/)).toBeTruthy();
  });

  it("shows local savings against the reference model", () => {
    show([row({ kind: "local", costMicros: null, providerId: null })], { priceReference: () => 500_000 });
    expect(screen.getByText("Saved locally")).toBeTruthy();
    expect(screen.getByText("~$0.50")).toBeTruthy();
  });

  it("counts turns it could not price instead of showing them as free", () => {
    show([row(), row({ costMicros: null, costSource: "unknown" })]);
    expect(screen.getByText("Turns without a price")).toBeTruthy();
    expect(screen.getAllByText("$1.25").length).toBeGreaterThan(0);
  });

  it("says so when nothing paid has happened", () => {
    show([]);
    expect(screen.getByText("No paid replies in this range yet.")).toBeTruthy();
  });
});
