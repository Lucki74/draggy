// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { insertMention, mentionAt, relativePaths } from "../chat/mentions";
import { ComposerPreview } from "../ui/gallery/ComposerPreview";

/** Typing @ in Code mode offers project files and writes the picked path. */

afterEach(cleanup);

describe("mentionAt", () => {
  it("finds the @word the caret ends", () => {
    expect(mentionAt("look at @comp", 13)).toEqual({ start: 8, query: "comp" });
    expect(mentionAt("@", 1)).toEqual({ start: 0, query: "" });
  });

  it("ignores an @ inside a word and an @word the caret has left", () => {
    expect(mentionAt("mail me@host.com", 16)).toBeNull();
    expect(mentionAt("@comp and more", 14)).toBeNull();
  });
});

describe("insertMention", () => {
  it("swaps the @word for the path and puts the caret after it", () => {
    const text = "fix @comp now";
    const result = insertMention(text, { start: 4, query: "comp" }, 9, "src/chat/Composer.tsx");

    expect(result.text).toBe("fix @src/chat/Composer.tsx now");
    expect(result.caret).toBe("fix @src/chat/Composer.tsx ".length);
  });
});

describe("relativePaths", () => {
  it("cuts the project folder, uses forward slashes and drops repeats", () => {
    const hits = [
      { path: "D:\\dev\\draggy\\src\\a.ts" },
      { path: "D:\\dev\\draggy\\src\\a.ts" },
      { path: "D:/dev/draggy/README.md" },
    ];

    expect(relativePaths("D:\\dev\\draggy\\", hits)).toEqual(["src/a.ts", "README.md"]);
  });
});

describe("the mention list", () => {
  it("opens on @, moves with the arrows and writes the pick on Enter", async () => {
    render(<ComposerPreview />);
    const field = screen.getByRole("textbox") as HTMLTextAreaElement;

    fireEvent.change(field, { target: { value: "see @comp", selectionStart: 9, selectionEnd: 9 } });
    const list = await screen.findByRole("listbox", { name: "Project files" }, { timeout: 1000 });
    expect(list.textContent).toContain("Composer.tsx");

    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1].getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(field, { key: "Enter" });
    expect(field.value).toBe("see @src/ui/gallery/ComposerPreview.tsx ");
    expect(screen.queryByRole("listbox", { name: "Project files" })).toBeNull();
  });

  it("closes on Escape without changing the text", async () => {
    render(<ComposerPreview />);
    const field = screen.getByRole("textbox") as HTMLTextAreaElement;

    fireEvent.change(field, { target: { value: "@men", selectionStart: 4, selectionEnd: 4 } });
    await screen.findByRole("listbox", { name: "Project files" }, { timeout: 1000 });
    fireEvent.keyDown(field, { key: "Escape" });

    expect(screen.queryByRole("listbox", { name: "Project files" })).toBeNull();
    expect(field.value).toBe("@men");
  });
});
