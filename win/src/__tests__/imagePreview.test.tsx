// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ImagePreview } from "../ui/ImagePreview";

afterEach(cleanup);

describe("ImagePreview component", () => {
  it("renders image with src and alt", () => {
    render(<ImagePreview src="data:image/png;base64,abc" alt="test.png" />);
    const img = screen.getByRole("img", { name: "test.png" }) as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toBe("data:image/png;base64,abc");
  });

  it("applies the requested size classes", () => {
    const { rerender } = render(<ImagePreview src="data:image/png;base64,abc" alt="test" size="sm" />);
    expect(screen.getByRole("img").className).toContain("max-w-[64px]");

    rerender(<ImagePreview src="data:image/png;base64,abc" alt="test" size="md" />);
    expect(screen.getByRole("img").className).toContain("w-[100px]");
    expect(screen.getByRole("img").className).toContain("h-[100px]");
    expect(screen.getByRole("img").className).toContain("max-w-[100px]");

    rerender(<ImagePreview src="data:image/png;base64,abc" alt="test" size="lg" />);
    expect(screen.getByRole("img").className).toContain("w-[100px]");
    expect(screen.getByRole("img").className).toContain("h-[100px]");
  });

  it("calls onDelete when remove button is clicked", () => {
    const onDelete = vi.fn();
    render(<ImagePreview src="data:image/png;base64,abc" alt="test.png" onDelete={onDelete} />);

    const removeBtn = screen.getByRole("button", { name: "Remove attachment" });
    expect(removeBtn).toBeTruthy();
    fireEvent.click(removeBtn);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("omits the remove button when onDelete is not provided", () => {
    render(<ImagePreview src="data:image/png;base64,abc" alt="test.png" />);
    expect(screen.queryByRole("button", { name: "Remove attachment" })).toBeNull();
  });
});
