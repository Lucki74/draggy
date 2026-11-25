// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PermissionPicker from "../chat/PermissionPicker";
import { translations } from "../translations";

const t = (key: string) => translations.en[key] || key;

afterEach(cleanup);

function renderPicker(toolsUnavailable: boolean) {
  const onPick = vi.fn();
  render(
    <PermissionPicker
      mode="plan"
      open
      onOpenChange={vi.fn()}
      onPick={onPick}
      toolsUnavailable={toolsUnavailable}
      t={t}
    />,
  );
  return onPick;
}

describe("PermissionPicker for a model that cannot use tools", () => {
  it("offers every mode when it can", () => {
    renderPicker(false);

    for (const option of screen.getAllByRole("menuitemradio")) {
      expect(option.getAttribute("aria-disabled")).toBeNull();
    }
  });

  it("grays out every mode but Plan only, and says why", () => {
    renderPicker(true);

    const byName = (name: string) => screen.getByRole("menuitemradio", { name: new RegExp(name) }) as HTMLButtonElement;

    expect(byName("Plan only").getAttribute("aria-disabled")).toBeNull();
    for (const name of ["Ask first", "Accept edits", "YOLO"]) {
      expect(byName(name).getAttribute("aria-disabled")).toBe("true");
      expect(byName(name).title).toBe("Needs a model that supports tools");
    }
  });

  it("does not pick a grayed-out mode, but still picks Plan only", () => {
    const onPick = renderPicker(true);

    fireEvent.click(screen.getByRole("menuitemradio", { name: /YOLO/ }));
    expect(onPick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("menuitemradio", { name: /Plan only/ }));
    expect(onPick).toHaveBeenCalledWith("plan");
  });
});

describe("PermissionPicker warning", () => {
  const renderClosed = (toolsUnavailable: boolean) =>
    render(
      <PermissionPicker
        mode="plan"
        open={false}
        onOpenChange={vi.fn()}
        onPick={vi.fn()}
        toolsUnavailable={toolsUnavailable}
        t={t}
      />,
    );

  it("puts a warning icon in place of the shield when the model has no tools", () => {
    renderClosed(true);

    expect(screen.queryByTestId("permission-shield")).toBeNull();
    // It leads the pill, ahead of the label.
    const pill = screen.getByRole("button", { name: /Plan only/ });
    expect(pill.firstElementChild?.contains(screen.getByTestId("no-tools-warning"))).toBe(true);

    const warning = screen.getByTestId("no-tools-warning");
    expect(warning.getAttribute("aria-label")).toBe("Needs a model that supports tools");
    expect(warning.getAttribute("class")).toContain("text-warn");
    expect(screen.getByRole("button", { name: /Plan only/ }).title).toBe(
      "Permissions: Plan only. Needs a model that supports tools",
    );
  });

  it("shows no warning when the model can use tools", () => {
    renderClosed(false);

    expect(screen.queryByTestId("no-tools-warning")).toBeNull();
    expect(screen.queryByTestId("permission-shield")).toBeNull();
    expect(screen.getByRole("button", { name: /Plan only/ }).title).toBe("Permissions: Plan only");
  });
});
