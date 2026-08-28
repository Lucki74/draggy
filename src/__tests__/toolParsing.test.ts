import { describe, expect, it } from "vitest";
import {
  TOOL_MARKER_OVERLAP,
  TOOL_MARKER_RE,
  createToolParser,
  extractThought,
  parseToolCall,
} from "../toolParsing";
import {
  LEAKED_SYNTAX_FIXTURES,
  NON_TOOL_FIXTURES,
  PRESERVED_JSON_FIXTURES,
  THINK_FIXTURES,
  TOOL_CALL_FIXTURES,
} from "./fixtures/toolCalls";

const NAMES = [
  "search_library",
  "search_web",
  "read_url",
  "browser_navigate",
  "browser_get_elements",
  "browser_click",
  "browser_type",
  "browser_press_key",
  "browser_get_text",
  "browser_close",
  "create_file",
  "run_code",
];

const parser = createToolParser(NAMES);

describe("detecting tool calls the models actually emit", () => {
  for (const fixture of TOOL_CALL_FIXTURES) {
    it(`recognises ${fixture.label}`, () => {
      const detected = parser.detect(fixture.raw);
      expect(detected, `no call detected in: ${fixture.raw}`).not.toBeNull();

      const { name, args } = parseToolCall(detected as string);
      expect(name).toBe(fixture.expect.name);
      expect(args).toEqual(fixture.expect.args);
    });
  }
});

describe("not mistaking ordinary text for a tool call", () => {
  for (const fixture of NON_TOOL_FIXTURES) {
    it(`leaves ${fixture.label} alone`, () => {
      expect(parser.detect(fixture.raw)).toBeNull();
    });
  }
});

describe("stripping tool syntax out of the visible reply", () => {
  for (const fixture of TOOL_CALL_FIXTURES) {
    if (fixture.visible === undefined) continue;

    it(`hides ${fixture.label} from the user`, () => {
      expect(parser.strip(fixture.raw)).toBe(fixture.visible);
    });
  }

  it("never leaves a raw JSON tool body on screen", () => {
    for (const fixture of TOOL_CALL_FIXTURES) {
      const visible = parser.strip(fixture.raw);
      expect(visible).not.toContain('"name"');
      expect(visible).not.toContain("</tool>");
      expect(visible).not.toContain("<think>");
    }
  });

  it("keeps ordinary prose intact", () => {
    const prose = "The capital of France is Paris.";
    expect(parser.strip(prose)).toBe(prose);
  });

  it("keeps a code block that merely mentions a tool name", () => {
    const source = "```python\ndef search_web(q):\n    pass\n```";
    expect(parser.strip(source)).toContain("def search_web(q):");
  });
});

describe("streaming safety", () => {
  it("flags a complete marker sitting at the end of a chunk", () => {
    const chunk = "Looking that up now. <tool";
    expect(TOOL_MARKER_RE.test(chunk.slice(-TOOL_MARKER_OVERLAP))).toBe(true);
  });

  it("does not flag a marker that is still only half arrived", () => {
    expect(TOOL_MARKER_RE.test("Looking that up now. <to")).toBe(false);
  });

  it("the overlap window is wide enough for the longest marker", () => {
    const longest = "<browser_";
    expect(TOOL_MARKER_OVERLAP).toBeGreaterThanOrEqual(longest.length);
  });

  it("finds a marker split across a chunk boundary using the overlap", () => {
    const first = "I will search. <sea";
    const second = 'rch_web>{"query": "x"}</search_web>';

    const scanFrom = Math.max(0, first.length - TOOL_MARKER_OVERLAP);
    const joined = first + second;

    expect(TOOL_MARKER_RE.test(joined.slice(scanFrom))).toBe(true);
    expect(parser.detect(joined)).not.toBeNull();
  });

  it("detects a call only once the tag is complete", () => {
    const partial = '<tool>{"name": "search_web", "args": {"query": "half';
    expect(parser.detect(partial)).toBeNull();

    const complete = partial + '-written"}}</tool>';
    expect(parser.detect(complete)).not.toBeNull();
  });
});

describe("extracting reasoning", () => {
  for (const fixture of THINK_FIXTURES) {
    it(`handles ${fixture.label}`, () => {
      expect(extractThought(fixture.raw)).toBe(fixture.thought);
    });
  }
});

describe("registry-driven names", () => {
  it("does not detect a tool that is not registered", () => {
    const narrow = createToolParser(["search_web"]);
    expect(narrow.detect("<run_code>print(1)</run_code>")).toBeNull();
  });

  it("detects a tool registered at runtime", () => {
    const extended = createToolParser(["search_web", "mcp_lookup"]);
    const detected = extended.detect('<mcp_lookup>{"query": "x"}</mcp_lookup>');

    expect(detected).not.toBeNull();
    expect(parseToolCall(detected as string).name).toBe("mcp_lookup");
  });

  it("survives a tool name containing regex metacharacters", () => {
    const odd = createToolParser(["weird.tool+name"]);
    expect(() => odd.detect("nothing here")).not.toThrow();
    expect(odd.detect("nothing here")).toBeNull();
  });

  it("handles an empty registry without matching everything", () => {
    const empty = createToolParser([]);
    expect(empty.detect("<search_web>x</search_web>")).toBeNull();
    expect(empty.strip("plain text")).toBe("plain text");
  });
});

describe("parseToolCall tolerance", () => {
  it("strips a json fence", () => {
    expect(parseToolCall('```json\n{"name":"a","args":{}}\n```').name).toBe("a");
  });

  it("strips a bare fence", () => {
    expect(parseToolCall('```\n{"name":"b","args":{}}\n```').name).toBe("b");
  });

  it("returns nothing for unparseable input", () => {
    expect(parseToolCall("not json at all")).toEqual({});
  });

  it("accepts parameters as an alias for args", () => {
    expect(parseToolCall('{"name":"c","parameters":{"q":1}}').args).toEqual({ q: 1 });
  });
});

describe("hiding tool-call envelopes that native models echo into the reply", () => {
  for (const fixture of LEAKED_SYNTAX_FIXTURES) {
    it(`hides ${fixture.label}`, () => {
      expect(parser.strip(fixture.raw)).toBe(fixture.visible);
    });
  }

  it("never leaves a function envelope on screen", () => {
    for (const fixture of LEAKED_SYNTAX_FIXTURES) {
      const visible = parser.strip(fixture.raw);
      expect(visible).not.toContain('"type"');
      expect(visible).not.toContain('"function"');
      expect(visible).not.toContain("}}}");
    }
  });
});

describe("not destroying JSON the user actually wants to see", () => {
  for (const fixture of PRESERVED_JSON_FIXTURES) {
    it(`keeps ${fixture.label}`, () => {
      expect(parser.strip(fixture.raw)).toContain(fixture.keep);
    });
  }
});
