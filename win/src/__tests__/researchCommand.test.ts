import { describe, expect, it } from "vitest";
import { researchInstruction, researchRequest } from "../research/command";
import { SLASH_COMMANDS } from "../chat/slashCommands";

describe("/research", () => {
  it("takes the question after the command", () => {
    expect(researchRequest("/research  How fast is X?\nAnd why")).toBe("How fast is X?\nAnd why");
    expect(researchRequest("/Research")).toBe("");
  });

  it("ignores other messages and lookalike commands", () => {
    expect(researchRequest("please /research this")).toBeNull();
    expect(researchRequest("/researcher notes")).toBeNull();
    expect(researchRequest("/web on")).toBeNull();
  });

  it("tells the model to start with the plan, or to ask when there is no question", () => {
    expect(researchInstruction("How fast is X?")).toMatch(/start_research/);
    expect(researchInstruction("")).toMatch(/Ask what to research/);
  });

  it("is in the slash menu and takes an argument", () => {
    expect(SLASH_COMMANDS.find((one) => one.id === "research")).toMatchObject({ takesArgument: true });
  });
});
