import { describe, expect, it } from "vitest";
import { stepView } from "../chat/stepView";
import type { SearchStep } from "../types";

const step = (type: SearchStep["type"], content: string, extra: Partial<SearchStep> = {}): SearchStep => ({
  id: "s",
  type,
  content,
  isComplete: true,
  ...extra,
});

describe("stepView", () => {
  it("splits a file read into its verb and a file argument", () => {
    expect(stepView(step("reading", "Read **a.ts**", { filepath: "src/a.ts" }))).toEqual({ name: "Read", args: [["file", "a.ts"]] });
  });

  it("gives a command its text and the exit note as the result", () => {
    expect(stepView(step("command", "Ran `npm test` (exit 0)"))).toEqual({ name: "Ran", args: [["command", "npm test"]], result: "(exit 0)" });
  });

  it("gives a search its query", () => {
    expect(stepView(step("searching", "Searching for **x**"))?.args).toEqual([["query", "x"]]);
  });

  it("returns null for a sentence with no subject", () => {
    expect(stepView(step("reading", "Read files"))).toBeNull();
  });

  it("splits a failed command into name, command and reason", () => {
    expect(stepView(step("error", "Failed `ls -la`: The sandbox is not available."))).toEqual({
      name: "Failed",
      args: [["command", "ls -la"]],
      result: "The sandbox is not available.",
    });
  });
});
