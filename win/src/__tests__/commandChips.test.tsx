// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ComposerPreview } from "../ui/gallery/ComposerPreview";
import { chipSegments, commandRanges } from "../chat/slashCommands";
import type { InstalledSkill } from "../types";

/** A command that will run is drawn as a chip behind the text, so the text itself never moves. */

afterEach(cleanup);

const skills = [{ id: "pdf", name: "pdf", description: "", path: "", source: "library", enabled: true }] as InstalledSkill[];

describe("which words are chips", () => {
  it("marks a skill anywhere and a built-in command only as the first word", () => {
    expect(commandRanges("use /pdf here", { skills })).toEqual([[4, 8]]);
    expect(commandRanges("/new now", { skills })).toEqual([[0, 4]]);
    expect(commandRanges("then /new", { skills })).toEqual([]);
  });

  it("leaves URLs, paths, code spans and unknown words plain", () => {
    for (const text of ["https://a.io/pdf", "/dev/null", "`/pdf`", "/nope"]) {
      expect(commandRanges(text, { skills })).toEqual([]);
    }
  });

  it("cuts the text around the chips", () => {
    expect(chipSegments("use /pdf here", [[4, 8]])).toEqual([
      { text: "use ", chip: false },
      { text: "/pdf", chip: true },
      { text: " here", chip: false },
    ]);
  });
});

describe("the layer behind the field", () => {
  it("shows a chip for a typed command and none for plain text", () => {
    render(<ComposerPreview />);
    const field = screen.getByRole("textbox");

    fireEvent.change(field, { target: { value: "hello" } });
    expect(screen.queryByTestId("command-chips")).toBeNull();

    fireEvent.change(field, { target: { value: "/new hello" } });
    expect(screen.getByTestId("command-chips").querySelector("mark")?.textContent).toBe("/new");
  });

  it("draws the command in the accent color so the layer does not hide it", () => {
    render(<ComposerPreview />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "/new hello" } });
    const mark = screen.getByTestId("command-chips").querySelector("mark");
    expect(mark?.className).toContain("accent-ink");
    expect(mark?.className).not.toContain("text-transparent");
  });
});
