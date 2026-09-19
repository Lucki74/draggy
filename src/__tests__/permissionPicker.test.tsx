// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Brain } from "lucide-react";
import CrossedIcon from "../chat/CrossedIcon";
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
      expect((option as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it("grays out every mode but Plan only, and says why", () => {
    renderPicker(true);

    const byName = (name: string) => screen.getByRole("menuitemradio", { name: new RegExp(name) }) as HTMLButtonElement;

    expect(byName("Plan only").disabled).toBe(false);
    for (const name of ["Ask first", "Accept edits", "Auto"]) {
      expect(byName(name).disabled).toBe(true);
      expect(byName(name).title).toBe("Needs a model that supports tools");
    }
  });

  it("does not pick a grayed-out mode, but still picks Plan only", () => {
    const onPick = renderPicker(true);

    fireEvent.click(screen.getByRole("menuitemradio", { name: /Auto/ }));
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
    // It leads the pill, where the shield would have been, ahead of the label.
    const pill = screen.getByRole("button", { name: /Plan only/ });
    expect(pill.firstElementChild).toBe(screen.getByTestId("no-tools-warning"));

    const warning = screen.getByTestId("no-tools-warning");
    expect(warning.getAttribute("aria-label")).toBe("Needs a model that supports tools");
    expect(warning.getAttribute("class")).toContain("text-amber-500");
    expect(screen.getByRole("button", { name: /Plan only/ }).title).toBe(
      "Permissions: Plan only. Needs a model that supports tools",
    );
  });

  it("shows no warning when the model can use tools", () => {
    renderClosed(false);

    expect(screen.queryByTestId("no-tools-warning")).toBeNull();
    expect(screen.getByTestId("permission-shield")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Plan only/ }).title).toBe("Permissions: Plan only");
  });

  it("keeps the warning when the label is hidden for a narrow composer", () => {
    render(
      <PermissionPicker mode="plan" open={false} onOpenChange={vi.fn()} onPick={vi.fn()} toolsUnavailable t={t} compact />,
    );

    expect(screen.getByTestId("no-tools-warning")).toBeTruthy();
  });
});

describe("CrossedIcon", () => {
  it("draws the icon in amber with a slash through it, hidden from screen readers", () => {
    render(<CrossedIcon icon={Brain} />);

    const wrapper = screen.getByTestId("crossed-icon");
    expect(wrapper.className).toContain("text-amber-500");
    expect(wrapper.getAttribute("aria-hidden")).toBe("true");
    expect(wrapper.querySelector("line")).not.toBeNull();
    expect(wrapper.querySelector("svg.lucide")).not.toBeNull();
  });
});
