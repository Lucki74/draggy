import { describe, expect, it } from "vitest";
import {
  addGrant,
  decide,
  grantCovers,
  targetFromArgs,
} from "../agent/permissions";
import type { Grant, ToolAnnotations } from "../agent/permissions";
import type { PermissionMode } from "../types";

/**
 * The gate every tool call goes through. These tests are the specification:
 * anything that can reach the user's files or the outside world has to be
 * either explicitly safe, already allowed, or asked about.
 */

const MODES: PermissionMode[] = ["plan", "ask", "acceptEdits", "auto"];

const read: ToolAnnotations = { readOnly: true };
const edit: ToolAnnotations = {};
const wipe: ToolAnnotations = { destructive: true };
const ours: ToolAnnotations = { sandboxed: true };

function verdict(
  mode: PermissionMode,
  annotations: ToolAnnotations,
  extra: { target?: string; grants?: Grant[] } = {},
) {
  return decide({ mode, tool: "a_tool", annotations, ...extra }).decision;
}

describe("reading", () => {
  it("is allowed in every mode, plan included", () => {
    for (const mode of MODES) expect(verdict(mode, read)).toBe("allow");
  });

  it("stays allowed when it reaches the web", () => {
    // How search_web and read_url are described: they fetch, but change nothing.
    for (const mode of MODES) {
      expect(verdict(mode, { readOnly: true, openWorld: true })).toBe("allow");
    }
  });
});

describe("plan mode", () => {
  it("refuses anything that changes something", () => {
    expect(verdict("plan", edit)).toBe("deny");
    expect(verdict("plan", wipe)).toBe("deny");
    expect(verdict("plan", ours)).toBe("deny");
  });

  it("refuses even what the user has already allowed", () => {
    const grants = [{ tool: "a_tool" }];
    expect(verdict("plan", edit, { grants })).toBe("deny");
  });

  it("tells the model to propose instead of acting", () => {
    const { reason } = decide({ mode: "plan", tool: "write_file" });
    expect(reason).toMatch(/plan mode/i);
    expect(reason).toMatch(/instead/i);
  });
});

describe("what Draggy owns", () => {
  it("runs without asking: its own folder, its scratch space, its browser", () => {
    expect(verdict("ask", ours)).toBe("allow");
    expect(verdict("acceptEdits", ours)).toBe("allow");
  });

  it("still asks before losing something, even inside Draggy", () => {
    expect(verdict("ask", { sandboxed: true, destructive: true })).toBe("ask");
  });
});

describe("ask mode", () => {
  it("asks before a change out in the user's world", () => {
    expect(verdict("ask", edit)).toBe("ask");
    expect(verdict("ask", wipe)).toBe("ask");
  });

  it("stops asking once the user has allowed that tool", () => {
    expect(verdict("ask", edit, { grants: [{ tool: "a_tool" }] })).toBe("allow");
  });

  it("does not let one tool's permission cover another", () => {
    expect(verdict("ask", edit, { grants: [{ tool: "other_tool" }] })).toBe("ask");
  });
});

describe("accept-edits mode", () => {
  it("lets an edit through but not a deletion", () => {
    expect(verdict("acceptEdits", edit)).toBe("allow");
    expect(verdict("acceptEdits", wipe)).toBe("ask");
  });

  it("lets a deletion through once it has been allowed", () => {
    expect(verdict("acceptEdits", wipe, { grants: [{ tool: "a_tool" }] })).toBe(
      "allow",
    );
  });
});

describe("auto mode", () => {
  it("runs everything except what plan mode forbids", () => {
    expect(verdict("auto", edit)).toBe("allow");
    expect(verdict("auto", wipe)).toBe("allow");
  });
});

describe("a grant with a folder on it", () => {
  const grants = [{ tool: "write_file", target: "C:\\projects\\draggy" }];

  const ask = (target: string) =>
    decide({ mode: "ask", tool: "write_file", target, grants }).decision;

  it("covers the folder itself and everything under it", () => {
    expect(ask("C:\\projects\\draggy")).toBe("allow");
    expect(ask("C:\\projects\\draggy\\src\\App.tsx")).toBe("allow");
  });

  it("does not cover a sibling with a longer name", () => {
    // The bug a plain startsWith would have: draggy-website is not draggy.
    expect(ask("C:\\projects\\draggy-website\\index.html")).toBe("ask");
  });

  it("does not cover the folder above it", () => {
    expect(ask("C:\\projects\\notes.txt")).toBe("ask");
  });

  it("reads a path the way the file system does", () => {
    expect(ask("c:/projects/draggy/src/App.tsx")).toBe("allow");
    expect(ask("C:\\projects\\draggy\\")).toBe("allow");
  });

  it("asks again when the call names nothing", () => {
    expect(decide({ mode: "ask", tool: "write_file", grants }).decision).toBe("ask");
  });
});

describe("collecting grants", () => {
  it("keeps the broader one when it arrives", () => {
    const grants = addGrant(
      [{ tool: "write_file", target: "C:\\a\\b" }],
      { tool: "write_file" },
    );

    expect(grants).toEqual([{ tool: "write_file" }]);
  });

  it("keeps grants for other tools", () => {
    const grants = addGrant([{ tool: "read_file" }], { tool: "write_file" });

    expect(grants).toHaveLength(2);
  });

  it("swallows a narrower grant under one already held", () => {
    const grants = addGrant([{ tool: "write_file" }], {
      tool: "write_file",
      target: "C:\\a",
    });

    expect(grants.some((one) => one.target === "C:\\a")).toBe(true);
    expect(grantCovers(grants[0], "write_file", "C:\\anywhere")).toBe(true);
  });
});

describe("what the user is asked about", () => {
  it("finds the path in a call", () => {
    expect(targetFromArgs({ path: "C:\\a\\b.txt" })).toBe("C:\\a\\b.txt");
    expect(targetFromArgs({ filename: "report.docx" })).toBe("report.docx");
    expect(targetFromArgs({ url: "https://example.com" })).toBe(
      "https://example.com",
    );
  });

  it("says nothing when the call is not about one thing", () => {
    expect(targetFromArgs({ query: "weather" })).toBeNull();
    expect(targetFromArgs({ path: "   " })).toBeNull();
    expect(targetFromArgs({ path: 7 })).toBeNull();
  });
});
