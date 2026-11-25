import { describe, expect, it } from "vitest";
import { SLASH_COMMANDS } from "../chat/slashCommands";

describe("/research", () => {
  it("is not in the slash menu", () => {
    expect(SLASH_COMMANDS.find((one) => one.id === "research")).toBeUndefined();
  });
});
