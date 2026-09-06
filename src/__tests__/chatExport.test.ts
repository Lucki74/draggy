import { describe, expect, it } from "vitest";
import { chatToMarkdown, exportFilename, visibleText } from "../chat/export";
import type { ChatSession, Message } from "../types";

const at = new Date("2026-09-06T12:00:00Z");

function message(partial: Partial<Message>): Message {
  return { id: "m", role: "user", content: "", ...partial };
}

function session(partial: Partial<ChatSession>): ChatSession {
  return {
    id: "c",
    title: "A chat",
    messages: [],
    updatedAt: 0,
    isGenerating: false,
    ...partial,
  };
}

describe("what goes into the file", () => {
  it("writes both sides under headings", () => {
    const markdown = chatToMarkdown(
      session({
        messages: [
          message({ role: "user", content: "hello" }),
          message({ role: "assistant", content: "hi there" }),
        ],
      }),
      { assistantName: "Qwen 3 8B", now: at },
    );

    expect(markdown).toContain("# A chat");
    expect(markdown).toContain("## You\n\nhello");
    expect(markdown).toContain("## Qwen 3 8B\n\nhi there");
  });

  it("leaves out the workings", () => {
    // Thinking and tool steps are how the answer was reached, not the answer.
    const markdown = chatToMarkdown(
      session({
        messages: [
          message({
            role: "assistant",
            content: "the visible answer",
            thinkingContent: "let me work through this first",
            steps: [{ id: "s", type: "searching", content: "searching" }],
          } as Partial<Message>),
        ],
      }),
      { now: at },
    );

    expect(markdown).toContain("the visible answer");
    expect(markdown).not.toContain("work through this");
    expect(markdown).not.toContain("searching");
  });

  it("writes the version the reader was looking at", () => {
    const markdown = chatToMarkdown(
      session({
        messages: [
          message({
            role: "assistant",
            content: "the first attempt",
            currentVersionIndex: 1,
            versions: [
              { textContent: "the first attempt" },
              { textContent: "the regenerated one" },
            ],
          } as unknown as Partial<Message>),
        ],
      }),
      { now: at },
    );

    expect(markdown).toContain("the regenerated one");
    expect(markdown).not.toContain("the first attempt");
  });

  it("names what was attached", () => {
    const markdown = chatToMarkdown(
      session({
        messages: [
          message({
            role: "user",
            content: "what is in this?",
            attachments: [{ name: "contract.pdf" }],
          } as unknown as Partial<Message>),
        ],
      }),
      { now: at },
    );

    expect(markdown).toContain("*Attached: contract.pdf*");
  });

  it("drops the system message", () => {
    const markdown = chatToMarkdown(
      session({
        messages: [
          message({ role: "system", content: "you are a helpful assistant" }),
          message({ role: "user", content: "hello" }),
        ],
      }),
      { now: at },
    );

    expect(markdown).not.toContain("helpful assistant");
    expect(markdown).toContain("hello");
  });

  it("says so when a conversation was condensed", () => {
    const markdown = chatToMarkdown(
      session({
        messages: [message({ role: "user", content: "hello" })],
        compaction: { throughIndex: 1 } as unknown as ChatSession["compaction"],
      }),
      { now: at },
    );

    expect(markdown).toContain("condensed into notes");
  });

  it("handles a conversation with nothing in it", () => {
    const markdown = chatToMarkdown(session({ messages: [] }), { now: at });
    expect(markdown).toContain("This conversation is empty.");
  });

  it("marks a reply that never arrived", () => {
    const markdown = chatToMarkdown(
      session({ messages: [message({ role: "assistant", content: "" })] }),
      { now: at },
    );
    expect(markdown).toContain("*(no reply)*");
  });
});

describe("the file name", () => {
  it("is the title and the date", () => {
    expect(exportFilename(session({ title: "Tax questions" }), at)).toBe(
      "Tax questions 2026-09-06.md",
    );
  });

  it("drops characters a path cannot hold", () => {
    const name = exportFilename(session({ title: 'Q3: profit/loss <draft>?' }), at);
    expect(name).toBe("Q3 profit loss draft 2026-09-06.md");
    expect(name).not.toMatch(/[<>:"/\\|?*]/);
  });

  it("keeps a very long title openable", () => {
    const name = exportFilename(session({ title: "word ".repeat(60) }), at);
    expect(name.length).toBeLessThanOrEqual(84);
    expect(name.endsWith("2026-09-06.md")).toBe(true);
  });

  it("falls back rather than producing a nameless file", () => {
    expect(exportFilename(session({ title: "" }), at)).toBe("Conversation 2026-09-06.md");
    expect(exportFilename(session({ title: "///" }), at)).toBe("Conversation 2026-09-06.md");
  });
});

describe("which text is shown", () => {
  it("prefers the visible text over the raw content", () => {
    expect(
      visibleText(message({ content: "<think>hmm</think>answer", textContent: "answer" })),
    ).toBe("answer");
  });

  it("falls back to the content when there is no visible copy", () => {
    expect(visibleText(message({ content: "answer" }))).toBe("answer");
  });
});
