// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Checkbox } from "../ui/Checkbox";

afterEach(cleanup);

describe("Checkbox", () => {
  it("reports the new value on click (Space fires the same native click)", () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="Pick" />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Pick" }));
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it("is a real focusable input", () => {
    render(<Checkbox checked onChange={() => {}} label="Pick" />);
    const box = screen.getByRole("checkbox", { name: "Pick" }) as HTMLInputElement;
    box.focus();
    expect(document.activeElement).toBe(box);
    expect(box.checked).toBe(true);
  });

  it("ignores clicks when disabled", () => {
    const onChange = vi.fn();
    render(<Checkbox checked onChange={onChange} disabled label="Pick" />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Pick" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
