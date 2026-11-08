// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useShellLayout } from "../app/useShellLayout";

afterEach(() => vi.unstubAllGlobals());

describe("dragging the side pane", () => {
  it("stops growing once the chat has no room left to give", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        report: (entries: unknown[]) => void;
        constructor(report: (entries: unknown[]) => void) {
          this.report = report;
        }
        observe() {
          this.report([{ contentRect: { width: 600 } }]);
        }
        disconnect() {}
      },
    );
    const { result } = renderHook(() => useShellLayout({ canvasPath: null, initialRightPaneWidth: 400 }));
    act(() => {
      result.current.observeWorkArea(document.createElement("div"));
    });

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

    // 400 of pane plus 600 of chat, less the 420 the chat keeps.
    expect(result.current.rightPaneWidth).toBe(580);
  });
});
