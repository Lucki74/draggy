import { describe, expect, it } from "vitest";
import { answerFor, approvalText, chunkReply, readChatMap, resolveChat, telegramChatOf } from "../telegram/mapping";

describe("chunkReply", () => {
  it("keeps a short reply whole and drops an empty one", () => {
    expect(chunkReply("hello")).toEqual(["hello"]);
    expect(chunkReply("   ")).toEqual([]);
  });

  it("splits a long reply under the limit, at a line when it can", () => {
    const text = `${"a".repeat(3000)}\n${"b".repeat(3000)}`;
    const parts = chunkReply(text);
    expect(parts).toHaveLength(2);
    expect(parts.every((part) => part.length <= 4000)).toBe(true);
    expect(parts.join("\n")).toBe(text);
  });

  it("cuts a block with no break at the limit", () => {
    const parts = chunkReply("x".repeat(9000));
    expect(parts.map((part) => part.length)).toEqual([4000, 4000, 1000]);
  });
});

describe("callback mapping", () => {
  it("allows once or refuses, never remembers", () => {
    expect(answerFor(true)).toBe("once");
    expect(answerFor(false)).toBe("no");
  });

  it("words the question", () => {
    expect(approvalText({ id: "1", tool: "bash", target: "ls", reason: "runs a command" }, { ask: "Allow" })).toContain("Allow bash");
  });
});

describe("chat map", () => {
  it("creates a chat on the first message and reuses it after", () => {
    const first = resolveChat({}, "42", "c1");
    expect(first).toMatchObject({ chatId: "c1", created: true });
    const second = resolveChat(first.map, "42", "c2");
    expect(second).toMatchObject({ chatId: "c1", created: false });
    expect(resolveChat(first.map, "42", "c3", true)).toMatchObject({ chatId: "c3", created: true });
    expect(telegramChatOf(first.map, "c1")).toBe("42");
  });

  it("reads a damaged save as empty", () => {
    expect(readChatMap("nope")).toEqual({});
    expect(readChatMap('{"1":"a","2":5}')).toEqual({ "1": "a" });
  });
});
