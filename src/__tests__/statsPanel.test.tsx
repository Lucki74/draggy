// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import StatsPanel from "../stats/StatsPanel";
import { translations } from "../translations";
import type { MetricRow } from "../types";

/** The statistics page as the user meets it. */

const t = (key: string) => translations.en[key] || key;

const ROWS: MetricRow[] = [
  {
    recordedAt: Date.now(),
    chatId: "chat-a",
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

  it("asks for the last 30 days first, and another range on request", async () => {
    await show();
    const firstSince = (list.mock.calls[0] as unknown as [number])[0];
    expect(Date.now() - firstSince).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);

    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: t("statsAllTime") }));
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

    fireEvent.click(screen.getByRole("button", { name: t("statsClear") }));
    expect(clear).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: t("statsConfirmClear") });
    expect(within(dialog).getByText(t("statsClearHint"))).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: t("statsClear") }));
    });

    expect(clear).toHaveBeenCalledTimes(1);
    expect(screen.getByText(t("statsEmpty"))).toBeTruthy();
  });

  it("fills bars with the primary text colour, which keeps contrast in both themes", async () => {
    // The inverted action colour sits too close to the raised track in the dark theme.
    const { container } = render(<StatsPanel t={t} />);
    await act(async () => {});
    const fills = container.querySelectorAll("[data-bar] > .bg-text-primary");
    expect(fills.length).toBeGreaterThan(0);
    expect(container.querySelector("[data-bar] > .bg-action-bg")).toBeNull();
  });
});

describe("the usage pane", () => {
  const showChat = async (chatId: string | null) => {
    await act(async () => {
      render(<StatsPanel t={t} chatId={chatId} />);
    });
  };

  it("counts only the open chat, over all time, with no range or clear", async () => {
    stored = [...ROWS, { ...ROWS[0], chatId: "chat-b", model: "llama3.2" }];
    await showChat("chat-a");

    expect((list.mock.calls[0] as unknown as [number])[0]).toBe(0);
    expect(screen.getByText("qwen3:8b")).toBeTruthy();
    expect(screen.queryByText("llama3.2")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("button", { name: t("statsClear") })).toBeNull();
  });

  it("says so when the chat has nothing recorded", async () => {
    await showChat("chat-z");

    expect(screen.getByText(t("statsEmptyChat"))).toBeTruthy();
  });

  it("stays empty with no chat open", async () => {
    await showChat(null);

    expect(screen.getByText(t("statsEmptyChat"))).toBeTruthy();
  });
});
