import { describe, expect, it } from "vitest";
import { charsPerToken, fitWire, keepToolResults, readOverflow, shrinkText } from "../agent/contextFit";
import { messageChars } from "../agent/compaction";
import { toWireMessage } from "../agent/agentLoop";
import { dropStaleFooters } from "../research/receipts";
import { contextSizeFor, forgetContextSize, growContext, limitContextSize } from "../llama";
import type { Message } from "../types";

type Entry = { role: "system" | "user" | "assistant" | "tool"; content: string; thinking?: string };

const long = (char: string, length: number) => char.repeat(length);
const chars = (wire: Entry[]) => wire.reduce((sum, entry) => sum + entry.content.length + (entry.thinking?.length ?? 0), 0);

describe("charsPerToken", () => {
  it("uses the engine's count and keeps it in range", () => {
    expect(charsPerToken(null)).toBe(4);
    expect(charsPerToken({ tokens: 1000, chars: 2500 })).toBe(2.5);
    expect(charsPerToken({ tokens: 1000, chars: 500 })).toBe(1.5);
    expect(charsPerToken({ tokens: 1000, chars: 9000 })).toBe(4);
  });
});

describe("readOverflow", () => {
  it("reads llama-server's refusal and its prompt count", () => {
    const body = '{"error":{"message":"the request exceeds the available context size, try increasing it","n_prompt_tokens":9123,"n_ctx":8192}}';
    expect(readOverflow(body)).toBe(9123);
    expect(readOverflow("the request exceeds the available context size")).toBe(0);
    expect(readOverflow("model not found")).toBeNull();
  });
});

describe("fitWire", () => {
  it("leaves a wire that fits alone", () => {
    const wire: Entry[] = [{ role: "system", content: "sys" }, { role: "user", content: "hi" }];
    expect(fitWire(wire, 1000, 0, 2)).toEqual({ fits: true, dropped: 0, changed: false });
  });

  it("shrinks this turn's older tool output before touching the conversation", () => {
    const wire: Entry[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "earlier" },
      { role: "assistant", content: "earlier answer" },
      { role: "user", content: "do it" },
      { role: "assistant", content: "" },
      { role: "tool", content: long("a", 20000) },
      { role: "assistant", content: "" },
      { role: "tool", content: long("b", 3000) },
      { role: "assistant", content: "" },
      { role: "tool", content: long("c", 3000) },
    ];
    const result = fitWire(wire, 10000, 0, 4);
    expect(result).toMatchObject({ fits: true, dropped: 0 });
    expect(wire[1].content).toBe("earlier");
    expect(wire[5].content).toContain("characters left out to fit the context window");
    expect(wire[9].content).toBe(long("c", 3000));
  });

  it("drops the oldest exchanges with a note, never the request or the system prompt", () => {
    const wire: Entry[] = [
      { role: "system", content: "sys" },
      { role: "user", content: long("x", 5000) },
      { role: "assistant", content: long("y", 5000), thinking: long("t", 3000) },
      { role: "user", content: "keep me" },
      { role: "assistant", content: "recent" },
      { role: "user", content: "the request" },
    ];
    const result = fitWire(wire, 2000, 0, 6);
    expect(result.fits).toBe(true);
    expect(result.dropped).toBeGreaterThan(0);
    expect(wire[0].content).toBe("sys");
    expect(wire.at(-1)?.content).toMatch(/^\[Earlier messages were left out to fit the context window\.\]/);
    expect(wire.at(-1)?.content).toContain("the request");
    expect(chars(wire)).toBeLessThanOrEqual(2000);
  });

  it("says when even a trimmed prompt cannot fit", () => {
    const wire: Entry[] = [{ role: "system", content: long("s", 5000) }, { role: "user", content: "hi" }];
    expect(fitWire(wire, 1000, 0, 2).fits).toBe(false);
  });
});

describe("tool results carried between turns", () => {
  it("cuts each result with a marker and holds the reply under one budget", () => {
    const kept = keepToolResults([long("a", 30000), "short", ""]);
    expect(kept).toHaveLength(2);
    expect(kept[0]).toContain("characters left out");
    expect(kept[1]).toBe("short");
    expect(shrinkText("tiny", 10)).toBe("tiny");
  });

  it("sends a past reply's tool output on the next turn and counts it for the fold", () => {
    const reply: Message = { id: "a1", role: "assistant", content: "The page says 42.", toolResults: ["TOOL RESULT (read_url): the answer is 42"] };
    expect(toWireMessage(reply, false).content).toContain("TOOL RESULT (read_url): the answer is 42");
    expect(messageChars(reply)).toBeGreaterThan(reply.content.length + 30);
  });
});

describe("dropStaleFooters", () => {
  it("keeps the run state only on the newest research result", () => {
    const wire = [
      { role: "tool", content: "TOOL RESULT (add_note): Saved as n1.\n\nRESEARCH: old state" },
      { role: "user", content: "a note of my own\n\nRESEARCH: mine" },
      { role: "tool", content: "TOOL RESULT (add_note): Saved as n2.\n\nRESEARCH: new state" },
    ];
    expect(dropStaleFooters(wire)).toBe(1);
    expect(wire[0].content).toBe("TOOL RESULT (add_note): Saved as n1.");
    expect(wire[1].content).toContain("RESEARCH: mine");
    expect(wire[2].content).toContain("RESEARCH: new state");
  });
});

describe("memory ceiling", () => {
  it("holds the automatic window at the size that started", () => {
    const model = "ceiling-test.gguf";
    forgetContextSize(model);
    expect(contextSizeFor(model, 100, 131072, null)).toBe(4096);
    limitContextSize(model, 8192);
    expect(growContext(model, 131072, 8192)).toBeNull();
    expect(contextSizeFor(model, 400000, 131072, null)).toBe(8192);
    forgetContextSize(model);
  });
});
