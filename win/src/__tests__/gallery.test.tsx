// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ComponentGallery from "../ui/gallery/ComponentGallery";

afterEach(cleanup);

describe("ComponentGallery", () => {
  it("renders gallery title and all primitive sections in English by default", () => {
    render(<ComponentGallery />);

    expect(screen.getByText("Component Gallery")).toBeTruthy();
    expect(screen.getByText("Buttons")).toBeTruthy();
    expect(screen.getByText("Chips")).toBeTruthy();
    expect(screen.getByText("Segmented Controls")).toBeTruthy();
    expect(screen.getByText("Status & Keyboard")).toBeTruthy();
    expect(screen.getByText("Signature Ember")).toBeTruthy();
    expect(screen.getByText("Phosphor Icons")).toBeTruthy();
  });

  it("switches to French and updates labels", () => {
    render(<ComponentGallery />);

    const frButton = screen.getByRole("radio", { name: "Français" });
    fireEvent.click(frButton);

    expect(screen.getByText("Galerie de composants")).toBeTruthy();
    expect(screen.getByText("Boutons")).toBeTruthy();
    expect(screen.getByText("Puces")).toBeTruthy();
    expect(screen.getByText("Continuer")).toBeTruthy();
  });

  it("switches to Chinese and updates labels", () => {
    render(<ComponentGallery />);

    const zhButton = screen.getByRole("radio", { name: "中文" });
    fireEvent.click(zhButton);

    expect(screen.getByText("组件库")).toBeTruthy();
    expect(screen.getByText("按钮")).toBeTruthy();
    expect(screen.getByText("标签片")).toBeTruthy();
    expect(screen.getByText("继续")).toBeTruthy();
  });

  it("toggles theme between dark and light", () => {
    const { container } = render(<ComponentGallery />);

    const rootDiv = container.firstElementChild as HTMLElement;
    expect(rootDiv.getAttribute("data-theme")).toBe("dark");

    const lightButton = screen.getAllByRole("radio", { name: "Light" })[0];
    fireEvent.click(lightButton);

    expect(rootDiv.getAttribute("data-theme")).toBe("light");
  });
});
