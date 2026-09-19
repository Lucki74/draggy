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
  const downloading: PullState = { name: "tiny.gguf", percent: 42.4, phase: "downloading", remainingSeconds: 134 };

  it("shows the model name, the time remaining and the percentage", () => {
    render(<PullProgress state={downloading} t={t} />);

    expect(screen.getByText("tiny.gguf")).toBeTruthy();
    expect(screen.getByText("2m 14s")).toBeTruthy();
    expect(screen.getByText("42%")).toBeTruthy();
  });

  it("puts the time remaining immediately before the percentage", () => {
    render(<PullProgress state={downloading} t={t} />);

    const time = screen.getByText("2m 14s");
    const percent = screen.getByText("42%");
    expect(time.nextElementSibling).toBe(percent);
  });

  it("omits the time while the estimate is unknown", () => {
    const { container, rerender } = render(<PullProgress state={{ ...downloading, remainingSeconds: null }} t={t} />);
    expect(container.textContent).not.toMatch(/\dm \d\ds/);
    expect(screen.getByText("42%")).toBeTruthy();

    rerender(<PullProgress state={{ ...downloading, remainingSeconds: undefined }} t={t} />);
    expect(container.textContent).not.toMatch(/\dm \d\ds/);
  });

  it("hides the time outside the downloading phase", () => {
    const { container, rerender } = render(
      <PullProgress state={{ ...downloading, phase: "preparing", percent: 0 }} t={t} />,
    );
    expect(screen.getByText(t("preparingDownload"))).toBeTruthy();
    expect(container.textContent).not.toMatch(/\dm \d\ds/);

    rerender(<PullProgress state={{ ...downloading, phase: "done", percent: 100 }} t={t} />);
    expect(screen.getByText(t("verifyingDownload"))).toBeTruthy();
    expect(container.textContent).not.toMatch(/\dm \d\ds/);
  });

  it("clamps the percentage to the bar", () => {
    render(<PullProgress state={{ ...downloading, percent: 140 }} t={t} />);
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("offers cancel only when a handler is given, and calls it", () => {
    const { rerender } = render(<PullProgress state={downloading} t={t} />);
    expect(screen.queryByRole("button")).toBeNull();

    const onCancel = vi.fn();
    rerender(<PullProgress state={downloading} onCancel={onCancel} t={t} />);
    fireEvent.click(screen.getByRole("button", { name: t("cancel") }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
