// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { VersionSwitch } from "../chat/VersionSwitch";

const t = (key: string) => key;

describe("VersionSwitch", () => {
  it("renders nothing without other versions", () => {
    const { container } = render(<VersionSwitch idx={0} slot={0} total={1} onSwitchVersion={vi.fn()} t={t} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the slot and steps to neighbours, clamped at the ends", () => {
    const onSwitch = vi.fn();
    const { rerender } = render(<VersionSwitch idx={4} slot={1} total={3} onSwitchVersion={onSwitch} t={t} />);
    expect(screen.getByText("2 / 3")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("nextVersion"));
    expect(onSwitch).toHaveBeenLastCalledWith(4, 2);
    fireEvent.click(screen.getByLabelText("previousVersion"));
    expect(onSwitch).toHaveBeenLastCalledWith(4, 0);

    rerender(<VersionSwitch idx={4} slot={2} total={3} onSwitchVersion={onSwitch} t={t} />);
    expect((screen.getByLabelText("nextVersion") as HTMLButtonElement).disabled).toBe(true);
  });
});
