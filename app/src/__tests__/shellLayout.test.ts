// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useShellLayout } from "../app/useShellLayout";

afterEach(() => vi.unstubAllGlobals());

/** A work area of `width`, which holds the chat and the docked pane, in a wide window. */
function layoutIn(width: number, pane: number) {
  vi.stubGlobal("innerWidth", 1600);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      report: (entries: unknown[]) => void;
      constructor(report: (entries: unknown[]) => void) {
        this.report = report;
      }
      observe() {
        this.report([{ contentRect: { width } }]);
      }
      disconnect() {}
    },
  );
  const hook = renderHook(() => useShellLayout({ canvasPath: null, initialRightPaneWidth: pane }));
  act(() => {
    hook.result.current.observeWorkArea(document.createElement("div"));
  });
  return hook.result;
}

describe("dragging the side pane", () => {
  it("stops growing once the chat has no room left to give", () => {
    const result = layoutIn(1000, 400);

    const target = document.createElement("div");
    act(() => {
      result.current.startResizeRightPane({
        clientX: 1000,
        pointerId: 1,
        preventDefault() {},
        currentTarget: target,
      } as unknown as React.PointerEvent);
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 0 }));
      window.dispatchEvent(new MouseEvent("pointerup"));
    });

    // 1000 of work area less the 420 the chat keeps.
    expect(result.current.rightPaneWidth).toBe(580);
    expect(result.current.dockOverlay).toBe(false);
  });

  it("gives way to the chat when the work area shrinks under a wide pane", () => {
    const result = layoutIn(1000, 900);

    expect(result.current.rightPaneWidth).toBe(580);
    expect(result.current.dockOverlay).toBe(false);
  });
});
