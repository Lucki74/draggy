import { describe, expect, it } from "vitest";
import {
  baseName,
  breadcrumbs,
  isInsideRoot,
  isNoise,
  joinPath,
  parentOf,
  partitionEntries,
  sortEntries,
} from "../files/tree";
import type { DirectoryEntry } from "../types";

/**
 * Paths for the explorer. The main process answers in whichever separator the
 * platform uses, so everything here has to read both without caring.
 */

const entry = (name: string, isDirectory = false): DirectoryEntry => ({
  name,
  path: `C:\\projects\\thing\\${name}`,
  isDirectory,
  size: 0,
  modified: 0,
});

describe("naming the parts of a path", () => {
  it("takes the last part, either way round", () => {
    expect(baseName("C:\\projects\\thing\\notes.md")).toBe("notes.md");
    expect(baseName("/home/someone/notes.md")).toBe("notes.md");
    expect(baseName("notes.md")).toBe("notes.md");
  });

  it("finds the folder something is in", () => {
    expect(parentOf("C:\\projects\\thing\\notes.md")).toBe("C:\\projects\\thing");
    expect(parentOf("/home/someone/notes.md")).toBe("/home/someone");
    expect(parentOf("notes.md")).toBe("");
  });

  it("joins with the separator the path already uses", () => {
    expect(joinPath("C:\\projects\\thing", "notes.md")).toBe(
      "C:\\projects\\thing\\notes.md",
    );
    expect(joinPath("/home/someone", "notes.md")).toBe("/home/someone/notes.md");
    expect(joinPath("C:\\projects\\thing\\", "notes.md")).toBe(
      "C:\\projects\\thing\\notes.md",
    );
  });

  it("has nothing to join onto when there is no folder", () => {
    expect(joinPath("", "notes.md")).toBe("notes.md");
  });
});

describe("what counts as inside the project", () => {
  const root = "C:\\projects\\thing";

  it("takes the folder itself and anything under it", () => {
    expect(isInsideRoot(root, root)).toBe(true);
    expect(isInsideRoot(root, "C:\\projects\\thing\\src\\App.tsx")).toBe(true);
  });

  it("reads a path the way the file system does", () => {
    expect(isInsideRoot(root, "c:/projects/thing/src")).toBe(true);
  });

  it("does not take a sibling whose name starts the same way", () => {
    expect(isInsideRoot(root, "C:\\projects\\thing-backup\\notes.md")).toBe(false);
  });
});

describe("the trail to a file", () => {
  const root = "C:\\projects\\thing";

  it("starts at the project, named after its folder", () => {
    const crumbs = breadcrumbs(root, "C:\\projects\\thing\\src\\App.tsx");

    expect(crumbs.map((crumb) => crumb.name)).toEqual(["thing", "src", "App.tsx"]);
  });

  it("gives every crumb a path of its own", () => {
    const crumbs = breadcrumbs(root, "C:\\projects\\thing\\src\\App.tsx");

    expect(crumbs[1].path).toBe("C:\\projects\\thing\\src");
    expect(crumbs[2].path).toBe("C:\\projects\\thing\\src\\App.tsx");
  });

  it("is just the project when that is all there is", () => {
    expect(breadcrumbs(root, root)).toEqual([{ name: "thing", path: root }]);
  });

  it("does not follow a path from somewhere else", () => {
    const crumbs = breadcrumbs(root, "C:\\elsewhere\\secrets.txt");

    expect(crumbs).toHaveLength(1);
    expect(crumbs[0].name).toBe("thing");
  });
});

describe("the order things are listed in", () => {
  it("puts folders first, then names, ignoring case", () => {
    const sorted = sortEntries([
      entry("zebra.md"),
      entry("src", true),
      entry("Alpha.md"),
      entry("docs", true),
    ]);

    expect(sorted.map((one) => one.name)).toEqual([
      "docs",
      "src",
      "Alpha.md",
      "zebra.md",
    ]);
  });
});

describe("what the tree folds away", () => {
  it("hides what a build made and what a dot hides", () => {
    expect(isNoise("node_modules")).toBe(true);
    expect(isNoise("dist")).toBe(true);
    expect(isNoise(".vscode")).toBe(true);
    expect(isNoise("src")).toBe(false);
    expect(isNoise("README.md")).toBe(false);
  });

  it("keeps the one dot folder people actually edit", () => {
    expect(isNoise(".github")).toBe(false);
  });

  it("splits a listing into what is shown and what is folded", () => {
    const { shown, folded } = partitionEntries([
      entry("src", true),
      entry("node_modules", true),
      entry("README.md"),
      entry(".env"),
    ]);

    expect(shown.map((one) => one.name)).toEqual(["src", "README.md"]);
    expect(folded.map((one) => one.name)).toEqual(["node_modules", ".env"]);
  });
});
