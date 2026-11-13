// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WindowControls } from "../app/WindowControls";
import { translations } from "../translations";

const win = vi.hoisted(() => ({
  minimize: vi.fn(async () => {}),
  toggleMaximize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  isMaximized: vi.fn(async () => false),
  onResized: vi.fn(async (_handler: () => void) => () => {}),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => win,
}));

const t = (key: string) => translations.en[key] || key;

beforeEach(() => {
  win.isMaximized.mockResolvedValue(false);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WindowControls", () => {
  it("renders minimize, maximize and close with translated labels", () => {
    render(<WindowControls t={t} />);
    expect(screen.getByRole("button", { name: "Minimize" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Maximize" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("calls the matching window command on click", () => {
    render(<WindowControls t={t} />);
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    fireEvent.click(screen.getByRole("button", { name: "Maximize" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(win.minimize).toHaveBeenCalledTimes(1);
    expect(win.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(win.close).toHaveBeenCalledTimes(1);
  });

  it("shows restore when the window is maximized", async () => {
    win.isMaximized.mockResolvedValue(true);
    render(<WindowControls t={t} />);
    expect(await screen.findByRole("button", { name: "Restore down" })).toBeTruthy();
  });

  it("re-reads the maximized state on resize", async () => {
    let onResize: () => void = () => {};
    win.onResized.mockImplementation(async (handler: () => void) => {
      onResize = handler;
      return () => {};
    });
    render(<WindowControls t={t} />);
    win.isMaximized.mockResolvedValue(true);
    await act(async () => onResize());
    await waitFor(() => expect(screen.getByRole("button", { name: "Restore down" })).toBeTruthy());
  });
});
