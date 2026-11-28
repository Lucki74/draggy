import { describe, expect, it } from "vitest";
import { toolGrammar } from "../agent/toolGrammar";
import type { ToolDefinition } from "../tools/registry";
import { grammarAccepts } from "./support/gbnf";

/** The grammar that decodes text tool calls. The sample replies below run through the same
 * recognizer the tests use for the grammar's rules, so a rule change shows up as a changed verdict. */

function tool(name: string, properties: Record<string, Record<string, unknown>>, required: string[] = []): ToolDefinition {
  return {
    type: "function",
    function: {
      name,
      description: "Test tool.",
      parameters: {
        type: "object",
        properties,
        required,
      } as unknown as ToolDefinition["function"]["parameters"],
    },
  };
}

const readFile = tool(
  "read_file",
  { path: { type: "string", description: "A path." }, lines: { type: "integer", description: "Count." } },
  ["path"],
);
const searchWeb = tool("search_web", { query: { type: "string", description: "Query." } }, ["query"]);
const definitions = [readFile, searchWeb];
const grammar = toolGrammar(definitions);

const call = (name: string, args: string) => `<tool>{"name": "${name}", "args": ${args}}</tool>`;

describe("toolGrammar shape", () => {
  it("gives no grammar without tools, or past the tool limit", () => {
    expect(toolGrammar([])).toBe("");
    const many = Array.from({ length: 25 }, (_, index) => tool(`t${index}`, {}));
    expect(toolGrammar(many)).toBe("");
  });

  it("gives no grammar when the rules would be too long", () => {
    const long = Array.from({ length: 24 }, (_, index) => tool(`${"x".repeat(700)}${index}`, {}));
    expect(toolGrammar(long)).toBe("");
  });

  it("ends the reply after one closing tag with optional leading reasoning", () => {
    expect(grammar).toMatch(/^root ::= reasoning\? text tail$/m);
    expect(grammar).toMatch(/^call ::= "<tool>" ws \( .+ \) ws "<\/tool>"$/m);
  });

  it("lists every tool name as a call and no other", () => {
    expect(grammar).toContain(String.raw`"\"read_file\""`);
    expect(grammar).toContain(String.raw`"\"search_web\""`);
    expect(grammar).not.toContain("delete_file");
  });
});

describe("toolGrammar decodes replies", () => {
  it("accepts prose followed by one call", () => {
    expect(grammarAccepts(grammar, `Reading it now.\n${call("read_file", '{"path": "a.txt"}')}`)).toBe(true);
  });

  it("accepts the optional argument in either position", () => {
    expect(grammarAccepts(grammar, call("read_file", '{"path": "a.txt", "lines": 3}'))).toBe(true);
    expect(grammarAccepts(grammar, call("read_file", '{"lines": 3, "path": "a.txt"}'))).toBe(true);
  });

  it("accepts a call with no arguments for a tool that has none", () => {
    const none = toolGrammar([tool("ping", {})]);
    expect(grammarAccepts(none, call("ping", "{}"))).toBe(true);
  });

  it("accepts an array and an object argument as JSON values", () => {
    const nested = toolGrammar([tool("bulk", { items: { type: "array", description: "Items." }, options: { type: "object", description: "Options." } })]);
    expect(grammarAccepts(nested, call("bulk", '{"items": [1, "two", {"x": null}], "options": {"deep": [true]}}'))).toBe(true);
  });

  it("accepts a reply that opens with reasoning, prefilled or not", () => {
    expect(grammarAccepts(grammar, `reason about it</think>${call("search_web", '{"query": "paris"}')}`)).toBe(true);
    expect(grammarAccepts(grammar, `<think>reason</think>\n${call("search_web", '{"query": "paris"}')}`)).toBe(true);
  });

  it("accepts prose that only resembles the tag", () => {
    expect(grammarAccepts(grammar, "Open the <toolbar> and then stop.")).toBe(true);
    expect(grammarAccepts(grammar, "Plain answer, no call.")).toBe(true);
  });
});

describe("toolGrammar refuses malformed replies", () => {
  it("refuses text after the closing tag, so the model cannot write its own result", () => {
    expect(grammarAccepts(grammar, `${call("search_web", '{"query": "paris"}')} The result is 4.`)).toBe(false);
  });

  it("refuses a tool that is not listed", () => {
    expect(grammarAccepts(grammar, call("delete_file", '{"path": "a"}'))).toBe(false);
  });

  it("refuses an unclosed tag", () => {
    expect(grammarAccepts(grammar, '<tool>{"name": "search_web", "args": {"query": "paris"}}')).toBe(false);
  });

  it("refuses a bad JSON escape", () => {
    expect(grammarAccepts(grammar, call("search_web", '{"query": "a\\q"}'))).toBe(false);
  });

  it("refuses a call that leaves out a required argument", () => {
    expect(grammarAccepts(grammar, call("read_file", '{"lines": 3}'))).toBe(false);
    expect(grammarAccepts(grammar, call("read_file", "{}"))).toBe(false);
  });

  it("refuses a key given twice", () => {
    expect(grammarAccepts(grammar, call("read_file", '{"path": "a", "path": "b"}'))).toBe(false);
  });

  it("refuses an argument of the wrong type", () => {
    expect(grammarAccepts(grammar, call("read_file", '{"path": "a.txt", "lines": "3"}'))).toBe(false);
  });

  it("refuses a literal tag in prose", () => {
    expect(grammarAccepts(grammar, "Write <tool> first.")).toBe(false);
  });

  it("refuses whitespace padding past the cap", () => {
    const padded = `<tool>{"name":${" ".repeat(9)}"search_web", "args": {"query": "paris"}}</tool>`;
    expect(grammarAccepts(grammar, padded)).toBe(false);
    expect(grammarAccepts(grammar, `<tool>{"name":  "search_web", "args": {"query": "paris"}}</tool>`)).toBe(true);
  });
});

describe("toolGrammar enum values", () => {
  const mode = toolGrammar([tool("set_mode", { mode: { type: "string", enum: ["fast", "slow"], description: "Mode." } }, ["mode"])]);

  it("accepts only the listed values", () => {
    expect(grammarAccepts(mode, call("set_mode", '{"mode": "fast"}'))).toBe(true);
    expect(grammarAccepts(mode, call("set_mode", '{"mode": "medium"}'))).toBe(false);
  });
});

describe("toolGrammar argument types", () => {
  it("reads a union type as either of its types", () => {
    const union = toolGrammar([tool("count", { n: { type: ["integer", "null"], description: "Count." } })]);
    expect(grammarAccepts(union, call("count", '{"n": 4}'))).toBe(true);
    expect(grammarAccepts(union, call("count", '{"n": null}'))).toBe(true);
    expect(grammarAccepts(union, call("count", '{"n": "4"}'))).toBe(false);
  });

  it("reads a parameter with no type as any JSON value", () => {
    const untyped = toolGrammar([tool("anything", { value: { description: "Any." } })]);
    expect(grammarAccepts(untyped, call("anything", '{"value": [1]}'))).toBe(true);
  });
});
