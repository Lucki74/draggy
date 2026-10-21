// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ComposerPreview } from "../ui/gallery/ComposerPreview";

/** The + menu: everything that adds to a message, in one place. */

afterEach(cleanup);

const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "Add context" }));

describe("the + menu", () => {
  it("offers files, a folder, extensions and web access but no skills", () => {
    render(<ComposerPreview />);
    openMenu();

    for (const name of ["Add files", "Add folder", "Extensions"]) {
      expect(screen.getByRole("menuitem", { name })).toBeTruthy();
    }
    // Skills are reached with / in the message, not from this menu.
    for (const name of ["Code review", "PDF"]) expect(screen.queryByText(name)).toBeNull();
    for (const name of ["Auto", "On", "Off"]) {
      expect(screen.getByRole("menuitemradio", { name })).toBeTruthy();
    }
  });

  it("sends a folder and extensions to their settings pages", () => {
    const onOpenSettings = vi.fn();
    render(<ComposerPreview onOpenSettings={onOpenSettings} />);
    openMenu();
    fireEvent.click(screen.getByText("Add folder"));
    openMenu();
    fireEvent.click(screen.getByText("Extensions"));

    expect(onOpenSettings.mock.calls).toEqual([["library"], ["extensions"]]);
  });

});
