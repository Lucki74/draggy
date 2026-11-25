import { describe, expect, it } from "vitest";
import { matchSlashCommands, replaceSlashToken, slashTokenAt } from "../chat/slashCommands";
import type { InstalledSkill } from "../types";

/** A /command can be typed anywhere in a message, so the word at the caret decides the menu. */

const skills = [
  { id: "pdf", name: "pdf", description: "Reads PDF files.", path: "", source: "library", enabled: true },
  { id: "docx", name: "docx", description: "Word documents.", path: "", source: "library", enabled: true },
] as InstalledSkill[];

describe("the slash word at the caret", () => {
  it("is found at the start, after a space and at the end of a line", () => {
    expect(slashTokenAt("/pd", 3)).toEqual({ start: 0, end: 3, query: "pd" });
    expect(slashTokenAt("read it, then /do", 17)).toEqual({ start: 14, end: 17, query: "do" });
    expect(slashTokenAt("one\n/pd more", 7)).toEqual({ start: 4, end: 7, query: "pd" });
  });

  it("reads only up to the caret but replaces the whole word", () => {
    expect(slashTokenAt("use /pdfx now", 8)).toEqual({ start: 4, end: 9, query: "pdf" });
  });

  it("ignores paths, URLs, code spans and a caret outside the word", () => {
    expect(slashTokenAt("/dev/null", 9)).toBeNull();
    expect(slashTokenAt("see https://a.io/pd", 19)).toBeNull();
    expect(slashTokenAt("run `/pd", 8)).toBeNull();
    expect(slashTokenAt("/pdf and more", 12)).toBeNull();
  });
});

describe("the menu inside a message", () => {
  it("offers skills only, never the built-in commands, past the first word", () => {
    const text = "first read it, then /";
    const ids = matchSlashCommands(text, { skills }).map((command) => command.id);

    expect(ids).toEqual(["pdf", "docx"]);
  });

  it("still offers the built-in commands for a leading slash", () => {
    const ids = matchSlashCommands("/n", { skills }).map((command) => command.id);

    expect(ids).toEqual(["new"]);
  });

  it("follows a caret placed in the middle of the text", () => {
    const text = "use /do and then summarise";
    const ids = matchSlashCommands(text, { skills, caret: 7 }).map((command) => command.id);

    expect(ids).toEqual(["docx"]);
  });
});

describe("picking a command", () => {
  it("swaps the word for the command and puts the caret after the space", () => {
    const token = slashTokenAt("use /do on this", 7)!;

    expect(replaceSlashToken("use /do on this", token, "docx")).toEqual({ text: "use /docx on this", caret: 10 });
  });

  it("adds the space when none follows", () => {
    const token = slashTokenAt("use /do", 7)!;

    expect(replaceSlashToken("use /do", token, "docx")).toEqual({ text: "use /docx ", caret: 10 });
  });
});
