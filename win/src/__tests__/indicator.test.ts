import { describe, expect, it } from "vitest";
import { showsGroupMark, showsTailMark } from "../chat/indicator";
import type { SearchStep } from "../types";

const step = (type: string, isComplete: boolean, content = "x"): SearchStep => ({ id: type, type, isComplete, content }) as SearchStep;

describe("which working mark shows", () => {
  it("shows the tail mark only when nothing else is visibly working", () => {
    expect(showsTailMark([], true, true)).toBe(true);
    expect(showsTailMark([step("thinking", false, "")], true, true)).toBe(true);
    expect(showsTailMark([step("thinking", false, "idea")], true, true)).toBe(false);
    expect(showsTailMark([step("run_code", false)], true, true)).toBe(false);
    expect(showsTailMark([], false, true)).toBe(false);
    expect(showsTailMark([], true, false)).toBe(false);
  });

  it("never shows the tail mark and a running step's mark together", () => {
    for (const running of [true, false]) {
      const steps = [step("command", !running)];
      const stepMark = running;
      expect(Number(showsTailMark(steps, true, true)) + Number(stepMark)).toBe(1);
    }
  });

  it("shows the group mark only while the group is folded", () => {
    const running = [step("command", false)];
    expect(showsGroupMark(running, false)).toBe(true);
    expect(showsGroupMark(running, true)).toBe(false);
    expect(showsGroupMark([step("command", true)], false)).toBe(false);
  });
});
