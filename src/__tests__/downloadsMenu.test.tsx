// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import DownloadsMenu, { badgeLabel } from "../settings/DownloadsMenu";
import type { PullState } from "../settings/useModelManager";
import { translations } from "../translations";

const t = (key: string) => translations.en[key] || key;

const running: PullState = { name: "big.gguf", percent: 40, phase: "downloading", remainingSeconds: 90 };
const waiting: PullState = { name: "next.gguf", percent: 0, phase: "queued" };

afterEach(cleanup);

describe("badgeLabel", () => {
  it("shows the count up to nine and 9+ beyond", () => {
    expect(badgeLabel(1)).toBe("1");
    expect(badgeLabel(9)).toBe("9");
    expect(badgeLabel(10)).toBe("9+");
    expect(badgeLabel(42)).toBe("9+");
  });
});

describe("DownloadsMenu", () => {
  it("shows no badge while nothing is downloading", () => {
    render(<DownloadsMenu pulls={[]} onCancel={vi.fn()} t={t} />);

    expect(screen.queryByTestId("downloads-badge")).toBeNull();
    expect(screen.getByRole("button", { name: "Downloads" })).toBeTruthy();
  });

  it("counts every download, running or waiting, in the badge", () => {
    render(<DownloadsMenu pulls={[running, waiting]} onCancel={vi.fn()} t={t} />);

    expect(screen.getByTestId("downloads-badge").textContent).toBe("2");
    expect(screen.getByRole("button", { name: "Downloads (2)" })).toBeTruthy();
  });

  it("lists each download with its progress when opened", () => {
    render(<DownloadsMenu pulls={[running, waiting]} onCancel={vi.fn()} t={t} />);

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Downloads (2)" }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("big.gguf")).toBeTruthy();
    expect(screen.getByText("40%")).toBeTruthy();
    expect(screen.getByText("next.gguf")).toBeTruthy();
    expect(screen.getByText("Queued")).toBeTruthy();
  });

  it("cancels the download whose button was pressed", () => {
    const onCancel = vi.fn();
    render(<DownloadsMenu pulls={[running, waiting]} onCancel={onCancel} t={t} />);

    fireEvent.click(screen.getByRole("button", { name: "Downloads (2)" }));
    const [, cancelNext] = screen.getAllByRole("button", { name: "Cancel" });
    fireEvent.click(cancelNext);

    expect(onCancel).toHaveBeenCalledWith("next.gguf");
  });

  it("says so when there is nothing to show", () => {
    render(<DownloadsMenu pulls={[]} onCancel={vi.fn()} t={t} />);

    fireEvent.click(screen.getByRole("button", { name: "Downloads" }));

    expect(screen.getByText("No downloads in progress.")).toBeTruthy();
  });

  it("closes on Escape and on a click outside", () => {
    render(
      <div>
        <span>outside</span>
        <DownloadsMenu pulls={[running]} onCancel={vi.fn()} t={t} />
      </div>,
    );
    const open = () => fireEvent.click(screen.getByRole("button", { name: "Downloads (1)" }));

    open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    open();
    fireEvent.mouseDown(screen.getByText("outside"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
