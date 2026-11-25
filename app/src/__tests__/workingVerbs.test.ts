import { describe, expect, it } from "vitest";
import { WORKING_VERBS, workingVerbsFor } from "../workingVerbs";

describe("the working verbs", () => {
  it.each(Object.keys(WORKING_VERBS))("gives %s at least 250 distinct verbs", (language) => {
    const verbs = WORKING_VERBS[language];
    expect(verbs.length).toBeGreaterThanOrEqual(250);
    expect(new Set(verbs).size).toBe(verbs.length);
    expect(verbs.every((verb) => verb.trim().length > 0)).toBe(true);
  });

  it("falls back to English for a language it does not know", () => {
    expect(workingVerbsFor("xx")).toBe(WORKING_VERBS.en);
  });
});
