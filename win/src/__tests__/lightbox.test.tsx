// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Lightbox } from "../ui/Lightbox";

// The viewer opens fitted, zooms from the keyboard and the wheel, and toggles between fit and 100%.

const rect = { width: 800, height: 600, left: 0, top: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) };

function open(onClose = vi.fn()) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect as DOMRect);
  const view = render(<Lightbox open src="x.png" alt="a picture" onClose={onClose} />);
  const img = view.container.querySelector("img") as HTMLImageElement;
  Object.defineProperty(img, "naturalWidth", { value: 2000 });
  Object.defineProperty(img, "naturalHeight", { value: 1000 });
  fireEvent.load(img);
  return { onClose, img, view };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the image viewer", () => {
  it("opens with the whole picture fitted", () => {
    open();
    expect(screen.getByLabelText("Toggle fit and actual size").textContent).toBe("40%");
  });

  it("zooms with the plus and minus keys and goes back to fit on 0", () => {
    open();
    fireEvent.keyDown(window, { key: "+" });
    expect(screen.getByLabelText("Toggle fit and actual size").textContent).toBe("50%");
    fireEvent.keyDown(window, { key: "-" });
    fireEvent.keyDown(window, { key: "-" });
    expect(screen.getByLabelText("Toggle fit and actual size").textContent).toBe("32%");
    fireEvent.keyDown(window, { key: "0" });
    expect(screen.getByLabelText("Toggle fit and actual size").textContent).toBe("40%");
  });

  it("shows actual size on 1 and toggles on double-click", () => {
    const { view } = open();
    fireEvent.keyDown(window, { key: "1" });
    expect(screen.getByLabelText("Toggle fit and actual size").textContent).toBe("100%");

    fireEvent.doubleClick(view.container.querySelector(".cursor-grab") as HTMLElement);
    expect(screen.getByLabelText("Toggle fit and actual size").textContent).toBe("40%");
  });

  it("zooms with the wheel and closes on Escape", () => {
    const { onClose, view } = open();
    fireEvent.wheel(view.container.querySelector(".cursor-grab") as HTMLElement, { deltaY: -200, clientX: 400, clientY: 300 });
    expect(Number.parseFloat(screen.getByLabelText("Toggle fit and actual size").textContent ?? "0")).toBeGreaterThan(40);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
