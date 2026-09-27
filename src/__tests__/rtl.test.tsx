// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSettings } from "../app/settings";

afterEach(() => {
  localStorage.clear();
  document.documentElement.dir = "";
});

describe("Arabic reads right to left", () => {
  it("turns the whole page around for Arabic, and back for any other language", () => {
    const { result } = renderHook(() => useSettings(true));
    expect(document.documentElement.dir).toBe("ltr");

    act(() => result.current[1]((prev) => ({ ...prev, language: "ar" })));
    expect(document.documentElement.dir).toBe("rtl");

    act(() => result.current[1]((prev) => ({ ...prev, language: "ja" })));
    expect(document.documentElement.dir).toBe("ltr");
  });
});

// Code keeps its left-to-right layout on purpose, so these views may say left and right.
const LEFT_TO_RIGHT = new Set(["CodeBlock.tsx", "DiffBlock.tsx", "Canvas.tsx"]);
const PHYSICAL =
  /(?<![\w-])(?:[a-z0-9-]+:)*-?(?:ml|mr|pl|pr|left|right|text-left|text-right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br)-[a-z0-9./[\]%-]+|(?<![\w-])(?:[a-z0-9-]+:)*(?:text-left|text-right|border-l|border-r)(?=[\s"'`])/g;

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sources(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

describe("the layout mirrors instead of pinning a side", () => {
  it("uses start and end, never left and right, outside the code views", () => {
    const offenders: string[] = [];
    for (const file of sources(path.join(__dirname, ".."))) {
      if (LEFT_TO_RIGHT.has(path.basename(file))) continue;
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        // Centring is symmetric, so it may stay physical.
        if (line.includes("left-1/2") && line.includes("-translate-x-1/2")) continue;
        for (const match of line.match(PHYSICAL) ?? []) offenders.push(`${path.basename(file)}: ${match}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps each code view left to right", () => {
    for (const file of ["chat/CodeBlock.tsx", "chat/DiffBlock.tsx", "canvas/Canvas.tsx"]) {
      expect(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), file).toContain('dir="ltr"');
    }
  });
});
