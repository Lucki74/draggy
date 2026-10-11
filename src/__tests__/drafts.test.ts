import { describe, expect, it } from "vitest";
import {
  afterSave,
  isCodeFile,
  isDirty,
  isMarkdownFile,
  keepMine,
  languageOf,
  lineCount,
  onDiskChange,
  openState,
  prismLanguageOf,
  readChange,
  samePath,
  takeTheirs,
} from "../canvas/drafts";


/** Two authors, one file. The rule these tests hold the canvas to: nobody's work disappears without
 * the user having chosen that it should. */

describe("a file with nothing unsaved", () => {
  it("is clean when it opens", () => {
    expect(isDirty(openState("hello"))).toBe(false);
  });

  it("follows the model's edit straight away", () => {
    const next = onDiskChange(openState("one"), "one\ntwo");

    expect(next).toEqual({ saved: "one\ntwo", draft: "one\ntwo", conflict: null });
  });

  it("ignores a change notice that changed nothing", () => {
    const state = openState("same");

    expect(onDiskChange(state, "same")).toBe(state);
  });
});

describe("a file the user is in the middle of editing", () => {
  const editing = { ...openState("one"), draft: "one, edited" };

  it("counts as unsaved", () => {
    expect(isDirty(editing)).toBe(true);
  });

  it("keeps the user's text when the file changes underneath", () => {
    const next = onDiskChange(editing, "one, by the model");

    expect(next.draft).toBe("one, edited");
    expect(next.conflict).toBe("one, by the model");
  });

  it("settles on its own when both authors wrote the same thing", () => {
    const next = onDiskChange(editing, "one, edited");

    expect(next).toEqual({ saved: "one, edited", draft: "one, edited", conflict: null });
  });

  it("can take the version on disk instead", () => {
    const next = takeTheirs(onDiskChange(editing, "theirs"));

    expect(next).toEqual({ saved: "theirs", draft: "theirs", conflict: null });
  });

  it("can keep the user's version, measured against the new disk text", () => {
    const next = keepMine(onDiskChange(editing, "theirs"));

    expect(next).toEqual({ saved: "theirs", draft: "one, edited", conflict: null });
    expect(isDirty(next)).toBe(true);
  });

  it("is clean again once saved", () => {
    const next = afterSave(editing, "one, edited");

    expect(isDirty(next)).toBe(false);
  });

  it("stays dirty when the user kept typing during the save", () => {
    const typedOn = { ...editing, draft: "one, edited more" };

    expect(isDirty(afterSave(typedOn, "one, edited"))).toBe(true);
  });
});

describe("choices with nothing to choose between", () => {
  it("leave the state alone", () => {
    const state = openState("x");

    expect(takeTheirs(state)).toBe(state);
    expect(keepMine(state)).toBe(state);
  });
});

describe("recognising the open file", () => {
  it("matches Windows paths regardless of case and slashes", () => {
    expect(samePath("C:\\Work\\notes.md", "c:/work/NOTES.md")).toBe(true);
  });

  it("keeps case on paths that are not Windows paths", () => {
    expect(samePath("/home/me/Notes.md", "/home/me/notes.md")).toBe(false);
  });

  it("reads a write to the open file as a change", () => {
    const open = { workspaceId: "w1", path: "C:\\p\\a.ts" };

    expect(readChange(open, { workspaceId: "w1", path: "C:\\p\\a.ts" })).toBe("changed");
  });

  it("reads a move away from the open file as a move", () => {
    const open = { workspaceId: "w1", path: "C:\\p\\a.ts" };

    expect(
      readChange(open, { workspaceId: "w1", path: "C:\\p\\b.ts", from: "C:\\p\\a.ts" }),
    ).toBe("moved");
  });

  it("ignores other files and other workspaces", () => {
    const open = { workspaceId: "w1", path: "C:\\p\\a.ts" };

    expect(readChange(open, { workspaceId: "w1", path: "C:\\p\\other.ts" })).toBe("none");
    expect(readChange(open, { workspaceId: "w2", path: "C:\\p\\a.ts" })).toBe("none");
  });
});

describe("the header", () => {
  it("names the language from the extension", () => {
    expect(languageOf("src/app.tsx")).toBe("TypeScript");
    expect(languageOf("C:\\p\\script.PY")).toBe("Python");
    expect(languageOf("Makefile")).toBe("Makefile");
    expect(languageOf("Dockerfile")).toBe("Docker");
    expect(languageOf(".gitignore")).toBe("Text");
  });

  it("maps extensions to prism language tokens", () => {
    expect(prismLanguageOf("app.ts")).toBe("typescript");
    expect(prismLanguageOf("component.tsx")).toBe("tsx");
    expect(prismLanguageOf("main.py")).toBe("python");
    expect(prismLanguageOf("lib.rs")).toBe("rust");
    expect(prismLanguageOf("server.go")).toBe("go");
    expect(prismLanguageOf("Program.cs")).toBe("csharp");
    expect(prismLanguageOf("native.cpp")).toBe("cpp");
    expect(prismLanguageOf("script.ps1")).toBe("powershell");
    expect(prismLanguageOf("deploy.sh")).toBe("bash");
    expect(prismLanguageOf("query.sql")).toBe("sql");
    expect(prismLanguageOf("Dockerfile")).toBe("docker");
  });

  it("identifies code files versus markdown and extensionless plain text", () => {
    expect(isCodeFile("main.ts")).toBe(true);
    expect(isCodeFile("script.py")).toBe(true);
    expect(isCodeFile("deploy.ps1")).toBe(true);
    expect(isCodeFile("Dockerfile")).toBe(true);
    expect(isCodeFile("LICENSE")).toBe(false);
    expect(isCodeFile("README.md")).toBe(false);
    expect(isCodeFile(".gitignore")).toBe(false);
    expect(isCodeFile("notes.txt")).toBe(false);

    expect(isMarkdownFile("README.md")).toBe(true);
    expect(isMarkdownFile("docs.markdown")).toBe(true);
    expect(isMarkdownFile("spec.mdx")).toBe(true);
    expect(isMarkdownFile("LICENSE")).toBe(false);
    expect(isMarkdownFile("script.py")).toBe(false);
  });

  it("counts lines for the gutter", () => {
    expect(lineCount("")).toBe(1);
    expect(lineCount("a\nb\nc")).toBe(3);
  });
});

