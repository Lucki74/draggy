// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ComposerPreview } from "../ui/gallery/ComposerPreview";

/** The + menu: everything that adds to a message, in one place. */

afterEach(cleanup);

const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "Add context" }));

describe("the + menu", () => {
  it("offers files, a folder, skills for this surface, extensions and web access", () => {
    render(<ComposerPreview />);
    openMenu();

    for (const name of ["Add files", "Add folder", "Code review", "PDF", "Extensions"]) {
      expect(screen.getByRole("menuitem", { name })).toBeTruthy();
    }
    for (const name of ["Auto", "On", "Off"]) {
      expect(screen.getByRole("menuitemradio", { name })).toBeTruthy();
    }
    // The preview is Code mode, so a chat-only skill stays out.
    expect(screen.queryByText("Essay outline")).toBeNull();
  });

  it("drafts the skill's command when one is picked", () => {
    const runSlashCommand = vi.fn();
    render(<ComposerPreview runSlashCommand={runSlashCommand} />);
    openMenu();

    fireEvent.click(screen.getByText("Code review"));

    expect(runSlashCommand).toHaveBeenCalledWith("review");
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

  it("leaves the skills heading out when there are none", () => {
    render(<ComposerPreview skills={[]} />);
    openMenu();

    expect(screen.queryByText("Skills")).toBeNull();
  });
});
