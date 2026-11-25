// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PullProgress, { formatRemainingTime } from "../settings/PullProgress";
import type { PullState } from "../settings/useModelManager";
import { translations } from "../translations";

const t = (key: string) => translations.en[key] || key;

afterEach(cleanup);

describe("formatRemainingTime", () => {
  it("formats under an hour as minutes and zero-padded seconds", () => {
    expect(formatRemainingTime(45)).toBe("0m 45s");
    expect(formatRemainingTime(134)).toBe("2m 14s");
    expect(formatRemainingTime(125)).toBe("2m 05s");
    expect(formatRemainingTime(3599)).toBe("59m 59s");
  });

  it("adds hours from one hour up", () => {
    expect(formatRemainingTime(3600)).toBe("1h 00m 00s");
    expect(formatRemainingTime(3665)).toBe("1h 01m 05s");
  });

  it("is empty when there is nothing sensible to show", () => {
    expect(formatRemainingTime(null)).toBe("");
    expect(formatRemainingTime(undefined)).toBe("");
    expect(formatRemainingTime(0)).toBe("");
    expect(formatRemainingTime(-5)).toBe("");
    expect(formatRemainingTime(0.2)).toBe("");
    expect(formatRemainingTime(Number.NaN)).toBe("");
    expect(formatRemainingTime(Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("PullProgress", () => {
  const GB = 1e9;
  const downloading: PullState = {
    name: "tiny.gguf",
    percent: 42.4,
    phase: "downloading",
    remainingSeconds: 134,
    completed: 2.1 * GB,
    total: 5 * GB,
    bytesPerSecond: 24e6,
  };

  it("shows the name, the bytes written, the speed and the time remaining", () => {
    render(<PullProgress state={downloading} t={t} />);

    expect(screen.getByText("tiny.gguf")).toBeTruthy();
    expect(screen.getByText("2.10 / 5.00 GB · 24 MB/s · 2m 14s")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("42");
  });

  it("leaves out the speed and time it has no measure for", () => {
    render(<PullProgress state={{ ...downloading, bytesPerSecond: null, remainingSeconds: null }} t={t} />);
    expect(screen.getByText("2.10 / 5.00 GB")).toBeTruthy();
  });

  it("names the phase before any bytes are reported", () => {
    const { rerender } = render(<PullProgress state={{ name: "tiny.gguf", percent: 0, phase: "preparing" }} t={t} />);
    expect(screen.getByText(t("preparingDownload"))).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBeNull();

    rerender(<PullProgress state={{ ...downloading, phase: "done", percent: 100 }} t={t} />);
    expect(screen.getByText(t("verifyingDownload"))).toBeTruthy();

    rerender(<PullProgress state={{ name: "tiny.gguf", percent: 0, phase: "queued" }} t={t} />);
    expect(screen.getByText(t("queuedDownload"))).toBeTruthy();
  });

  it("clamps the progress line", () => {
    render(<PullProgress state={{ ...downloading, percent: 140 }} t={t} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  });

  it("offers cancel only when a handler is given, and calls it", () => {
    const { rerender } = render(<PullProgress state={downloading} t={t} />);
    expect(screen.queryByRole("button")).toBeNull();

    const onCancel = vi.fn();
    rerender(<PullProgress state={downloading} onCancel={onCancel} t={t} />);
    fireEvent.click(screen.getByRole("button", { name: t("cancel") }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows why a download failed and offers to try again or dismiss it", () => {
    const onRetry = vi.fn();
    const onCancel = vi.fn();
    render(
      <PullProgress
        state={{ name: "tiny.gguf", percent: 10, phase: "failed", error: "Server returned HTTP 404" }}
        onCancel={onCancel}
        onRetry={onRetry}
        t={t}
      />,
    );

    expect(screen.getByRole("alert").textContent).toBe("Server returned HTTP 404");
    expect(screen.queryByRole("progressbar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("retry") }));
    fireEvent.click(screen.getByRole("button", { name: t("dismiss") }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
