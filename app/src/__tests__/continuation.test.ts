import { describe, expect, it } from "vitest";
import { continuesBody } from "../chat/continuation";

describe("a continued reply streaming in the timeline", () => {
  it("takes the place of the old body once it begins with it", () => {
    expect(continuesBody("I have started the report", "I have started the report and finished it.")).toBe(true);
  });

  it("leaves an unrelated body and an empty one alone", () => {
    expect(continuesBody("Earlier answer", "A new paragraph about tools.")).toBe(false);
    expect(continuesBody("", "Anything")).toBe(false);
  });
});
