import { describe, expect, it } from "vitest";
import { autoContinueWindow } from "../agent/autoContinue";

const cut = { loaded: 4096, modelMax: 32768, used: 4000, canGrow: true };

describe("automatic continuation of a cut reply", () => {
  it("resumes at the next window when the cut can grow", () => {
    expect(autoContinueWindow(cut, 8192)).toBe(8192);
  });

  it("does not resume when the window cannot grow", () => {
    expect(autoContinueWindow({ ...cut, canGrow: false }, 8192)).toBeNull();
  });

  it("does not resume without a larger window", () => {
    expect(autoContinueWindow(cut, null)).toBeNull();
    expect(autoContinueWindow(cut, 4096)).toBeNull();
  });

  it("does not resume without a cut", () => {
    expect(autoContinueWindow(undefined, 8192)).toBeNull();
  });
});
