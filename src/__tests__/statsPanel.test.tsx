// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import StatsPanel from "../stats/StatsPanel";
import { translations } from "../translations";
import type { MetricRow } from "../types";

/** The statistics page as the user meets it. */

const t = (key: string) => translations.en[key] || key;

const ROWS: MetricRow[] = [
  {
    recordedAt: Date.now(),
    model: "qwen3:8b",
    promptTokens: 1000,
    responseTokens: 500,
    responseMs: 10_000,
    firstTokenMs: 400,
    loadMs: 0,
    taskMs: 12_000,
    loops: 2,
    tools: { read_file: 3 },
  },
];

let stored: MetricRow[] = [];
const list = vi.fn(async () => ({ success: true, rows: stored }));
const clear = vi.fn(async () => {
  stored = [];
  return { success: true, removed: 1 };
});

beforeEach(() => {
  stored = [...ROWS];
  list.mockClear();
  clear.mockClear();
  (window as unknown as { electronAPI: unknown }).electronAPI = { metrics: { list, clear } };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

const show = async () => {
  await act(async () => {
    render(<StatsPanel t={t} />);
  });
};

describe("the statistics page", () => {
  it("shows speed by model, tool usage and task time", async () => {
    await show();

    expect(screen.getByText("qwen3:8b")).toBeTruthy();
    expect(screen.getAllByText("50.0 tok/s").length).toBeGreaterThan(0);
    expect(screen.getByText("read_file")).toBeTruthy();
    expect(screen.getAllByText("12 s").length).toBeGreaterThan(0);
  });

  it("says it keeps everything on this computer", async () => {
    await show();

    expect(screen.getByText(t("statsPrivacy"))).toBeTruthy();
  });

  it("asks for the last 30 days first, and another range on request", async () => {
    await show();
    const firstSince = (list.mock.calls[0] as unknown as [number])[0];
    expect(Date.now() - firstSince).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: t("statsAllTime") }));
    });

    expect((list.mock.calls.at(-1) as unknown as [number])[0]).toBe(0);
  });

  it("says when there is nothing recorded yet", async () => {
    stored = [];
    await show();

    expect(screen.getByText(t("statsEmpty"))).toBeTruthy();
  });

  it("clears only after being asked twice", async () => {
    await show();

    fireEvent.click(screen.getByText(t("statsClear")));
    expect(clear).not.toHaveBeenCalled();
    expect(screen.getByText(t("statsConfirmClear"))).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText(t("confirm")));
    });

    expect(clear).toHaveBeenCalledTimes(1);
    expect(screen.getByText(t("statsEmpty"))).toBeTruthy();
  });
});
