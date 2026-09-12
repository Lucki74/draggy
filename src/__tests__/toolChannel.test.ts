import { describe, expect, it } from "vitest";
import {
  chooseChannel,
  looksLikeCall,
  readRepair,
  repairPrompt,
  repairSchema,
} from "../agent/toolChannel";
import type { ToolDefinition } from "../tools/registry";

/**
 * How a model is asked for a tool call, and what happens when it gets the shape
 * wrong. The README's own known rough edge is that this varies by model, so the
 * rules here are the ones that decide how well a small model does.
 */

const definitions: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

describe("choosing how to ask", () => {
  it("uses the tool interface when the model has one", () => {
    expect(chooseChannel(["tools", "thinking"])).toBe("native");
  });

  it("falls back to the prompted format otherwise", () => {
    expect(chooseChannel(["vision"])).toBe("text");
    expect(chooseChannel([])).toBe("text");
    expect(chooseChannel(undefined)).toBe("text");
  });
});

describe("the schema a repair is asked for", () => {
  it("only allows the tools that exist", () => {
    const schema = repairSchema(definitions) as {
      properties: { name: { enum?: string[] } };
      required: string[];
    };

    expect(schema.properties.name.enum).toEqual(["search_web", "read_file"]);
    expect(schema.required).toEqual(["name", "args"]);
  });

  it("still asks for a name when there are no tools to list", () => {
    const schema = repairSchema([]) as {
      properties: { name: { enum?: string[]; type: string } };
    };

    expect(schema.properties.name.enum).toBeUndefined();
    expect(schema.properties.name.type).toBe("string");
  });

  it("shows the model what it wrote, without pasting a whole reply back", () => {
    const prompt = repairPrompt("x".repeat(2000));

    expect(prompt).toMatch(/could not be read/i);
    expect(prompt.length).toBeLessThan(800);
  });
});

describe("reading the repair", () => {
  it("takes a bare object, which is what the schema forces", () => {
    const call = readRepair('{"name": "search_web", "args": {"query": "paris"}}');

    expect(call.name).toBe("search_web");
    expect(call.args).toEqual({ query: "paris" });
  });

  it("takes one wrapped in a fence anyway", () => {
    const call = readRepair('```json\n{"name": "read_file", "args": {}}\n```');

    expect(call.name).toBe("read_file");
  });

  it("gives an empty call an empty argument list rather than nothing", () => {
    expect(readRepair('{"name": "read_file"}').args).toEqual({});
  });

  it("says nothing for a reply with no call in it", () => {
    expect(readRepair("I could not do that.")).toEqual({});
    expect(readRepair("")).toEqual({});
  });
});

describe("noticing a call that went wrong", () => {
  const names = ["search_web", "read_file"];

  it("spots an unclosed tag around a known tool", () => {
    expect(looksLikeCall('<tool>{"name": "search_web", "args": {}', names)).toBe(true);
  });

  it("spots a bare object naming a tool", () => {
    expect(looksLikeCall('Sure: {"name": "read_file", "path": "a.txt"}', names)).toBe(
      true,
    );
  });

  it("leaves an ordinary answer alone", () => {
    expect(looksLikeCall("Paris is the capital of France.", names)).toBe(false);
    expect(looksLikeCall("", names)).toBe(false);
  });

  it("leaves prose that merely mentions a tool alone", () => {
    // A model explaining itself is not a model calling something.
    expect(
      looksLikeCall("I could use search_web for this if you want.", names),
    ).toBe(false);
  });

  it("does not fire for a tool that does not exist", () => {
    expect(looksLikeCall('<tool>{"name": "launch_missiles"}</tool>', names)).toBe(
      false,
    );
  });
});
