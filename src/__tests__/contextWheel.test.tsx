// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import ContextWheel from "../chat/ContextWheel";
import { formatPercent, toneFor } from "../chat/contextView";
import { describeContextWindow, measureBreakdown } from "../agent/contextBreakdown";
import { translations } from "../translations";

/** The wheel beside the model picker, and the breakdown behind it. */

const t = (key: string) => translations.en[key] || key;

const view = (overrides: Partial<Parameters<typeof describeContextWindow>[0]> = {}) =>
  describeContextWindow({
    breakdown: measureBreakdown(
      { systemChars: 4000, toolChars: 2000, memoryChars: 800, skillChars: 0, summaryChars: 0 },
      27_600,
    ),
    draftTokens: 0,
    exact: true,
    windowTokens: 203_000,
    limitTokens: null,
    ...overrides,
  });

afterEach(cleanup);

const open = () => fireEvent.click(screen.getByRole("button", { name: /Context window/ }));

describe("the wheel", () => {
  it("says how full the window is without being opened", () => {
    render(<ContextWheel view={view()} t={t} />);

    expect(screen.getByRole("button", { name: "Context window: 27.6k / 203k (13.6%)" })).toBeTruthy();
  });

  it("fills its ring in proportion", () => {
    render(<ContextWheel view={view()} t={t} />);

    const ring = screen.getByTestId("context-wheel-fill");
    const circumference = Number(ring.getAttribute("stroke-dasharray"));
    const offset = Number(ring.getAttribute("stroke-dashoffset"));

    expect(1 - offset / circumference).toBeCloseTo(0.136, 2);
  });

  it("marks a figure estimated while a reply streams", () => {
    render(<ContextWheel view={view({ exact: false })} t={t} />);

    expect(screen.getByRole("button", { name: "Context window: ~27.6k / 203k (13.6%)" })).toBeTruthy();
  });

  it("claims nothing before anything has been counted", () => {
    render(<ContextWheel view={view({ breakdown: null })} t={t} />);

    expect(screen.getByRole("button", { name: "Context window: - / 203k" })).toBeTruthy();
  });

  it("spins instead while the conversation is being compacted", () => {
    render(<ContextWheel view={view()} t={t} compacting />);

    expect(screen.queryByTestId("context-wheel-fill")).toBeNull();
  });

  it("gets louder as the window fills", () => {
    expect(toneFor(50)).toBe("var(--text-main)");
    expect(toneFor(85)).toBe("#f59e0b");
    expect(toneFor(97)).toBe("#ef4444");
  });
});

describe("the breakdown", () => {
  it("opens to the total and a bar, with the parts folded away", () => {
    render(<ContextWheel view={view()} t={t} />);
    open();

    const panel = screen.getByRole("dialog");
    expect(panel.textContent).toContain("27.6k / 203k (13.6%)");
    expect(screen.queryByText(t("contextMessages"))).toBeNull();
  });

  it("lists what the window is spent on when expanded", () => {
    render(<ContextWheel view={view()} t={t} />);
    open();

    fireEvent.click(screen.getByRole("button", { expanded: false, name: /27\.6k/ }));

    for (const key of ["contextMessages", "contextSystem", "contextTools", "contextMemory", "contextFree"]) {
      expect(screen.getByText(t(key))).toBeTruthy();
    }
    expect(screen.queryByText(t("contextSkills"))).toBeNull();
  });

  it("says where automatic compaction happens", () => {
    render(<ContextWheel view={view()} t={t} />);
    open();

    expect(screen.getByText("Compacts automatically at 122k tokens")).toBeTruthy();
  });

  it("says so when the point is the user's own limit", () => {
    render(<ContextWheel view={view({ limitTokens: 50_000 })} t={t} />);
    open();

    expect(screen.getByText("Compacts at your limit of 50k tokens")).toBeTruthy();
  });

  it("compacts on request and closes", async () => {
    const onCompact = vi.fn();
    render(<ContextWheel view={view()} t={t} onCompact={onCompact} />);
    open();

    await act(async () => {
      fireEvent.click(screen.getByText(t("compactNow")));
    });

    expect(onCompact).toHaveBeenCalledTimes(1);
    // Closing animates out, so the wheel's own state is what says it closed.
    expect(
      screen.getByLabelText("Context window: 27.6k / 203k (13.6%)").getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("offers no compact button when there is no conversation to fold", () => {
    render(<ContextWheel view={view()} t={t} />);
    open();

    expect(screen.queryByText(t("compactNow"))).toBeNull();
  });

  it("keeps a sliver of a percent visible", () => {
    expect(formatPercent(0.44)).toBe("0.4%");
    expect(formatPercent(13.6)).toBe("13.6%");
    expect(formatPercent(20)).toBe("20%");
    expect(formatPercent(140)).toBe("100%");
  });
});
