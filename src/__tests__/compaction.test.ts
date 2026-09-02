import { describe, expect, it } from "vitest";
import {
  COMPACT_AT,
  KEEP_RECENT_MESSAGES,
  MIN_FOLD_MESSAGES,
  SUMMARY_CHAR_BUDGET,
  appendSummary,
  bucketFor,
  budgetForWindow,
  compactionSurvives,
  conversationChars,
  buildSummaryMessages,
  messageChars,
  planCompaction,
  renderCompactionBlock,
  renderTranscript,
  trimSummary,
} from "../agent/compaction";
import type { CompactionState, Message } from "../types";

function say(role: "user" | "assistant", content: string, id = ""): Message {
  return { id: id || `${role}-${content.slice(0, 8)}`, role, content };
}

/** A conversation of alternating turns, user first, each `size` characters. */
function conversation(turns: number, size = 100): Message[] {
  const messages: Message[] = [];
  for (let index = 0; index < turns; index++) {
    messages.push(
      say(index % 2 === 0 ? "user" : "assistant", "x".repeat(size), `m${index}`),
    );
  }
  return messages;
}

describe("messageChars", () => {
  it("counts the text of a message", () => {
    expect(messageChars(say("user", "hello"))).toBe(5);
  });

  it("counts an attachment, which is usually the reason a fold is needed", () => {
    const message: Message = {
      ...say("user", "look at this"),
      attachments: [{ name: "a.txt", type: "text/plain", content: "y".repeat(500) }],
    };
    expect(messageChars(message)).toBe(12 + 5 + 500);
  });

  it("survives a message with no content", () => {
    expect(messageChars({ id: "x", role: "user", content: "" })).toBe(0);
  });
});

describe("conversationChars", () => {
  it("adds up the whole conversation when nothing is folded", () => {
    expect(conversationChars(conversation(4, 10))).toBe(40);
  });

  it("counts the summary instead of the messages it replaces", () => {
    const state: CompactionState = {
      throughIndex: 2,
      summary: "s".repeat(7),
      updatedAt: 0,
    };
    // Two messages of ten remain, plus the seven-character summary.
    expect(conversationChars(conversation(4, 10), state)).toBe(27);
  });
});

describe("budgetForWindow", () => {
  it("is a fraction of the window, in characters", () => {
    expect(budgetForWindow(8192)).toBe(Math.floor(8192 * 4 * COMPACT_AT));
  });

  it("leaves room for the reply rather than filling the window", () => {
    expect(budgetForWindow(8192)).toBeLessThan(8192 * 4);
  });

  it("is never negative", () => {
    expect(budgetForWindow(0)).toBe(0);
  });
});

describe("bucketFor", () => {
  it("rounds up to the window the model will actually be loaded at", () => {
    expect(bucketFor(5000)).toBe(8192);
    expect(bucketFor(8192)).toBe(8192);
    expect(bucketFor(9000)).toBe(16384);
  });

  it("passes through a window larger than any bucket", () => {
    expect(bucketFor(500000)).toBe(500000);
  });
});

describe("planCompaction", () => {
  it("does nothing while the conversation fits", () => {
    expect(planCompaction(conversation(20, 10), { budgetChars: 100000 })).toBeNull();
  });

  it("folds once the conversation is over budget", () => {
    const plan = planCompaction(conversation(20, 500), { budgetChars: 1000 });
    expect(plan).not.toBeNull();
    expect(plan!.foldFrom).toBe(0);
    expect(plan!.foldThrough).toBeGreaterThan(0);
  });

  it("never folds the most recent messages", () => {
    const messages = conversation(20, 500);
    const plan = planCompaction(messages, { budgetChars: 1000 })!;
    expect(plan.foldThrough).toBeLessThanOrEqual(
      messages.length - KEEP_RECENT_MESSAGES,
    );
  });

  it("folds up to a user message, so what remains starts with a question", () => {
    const messages = conversation(20, 500);
    const plan = planCompaction(messages, { budgetChars: 1000 })!;
    expect(messages[plan.foldThrough].role).toBe("user");
  });

  it("declines a fold too small to be worth the cache it costs", () => {
    // Over budget, but only three messages sit outside the retained tail.
    const messages = conversation(KEEP_RECENT_MESSAGES + 3, 5000);
    const plan = planCompaction(messages, { budgetChars: 10 });
    expect(plan).toBeNull();
  });

  it("resumes from where the last fold stopped rather than starting over", () => {
    const messages = conversation(40, 500);
    const existing: CompactionState = {
      throughIndex: 10,
      summary: "notes",
      updatedAt: 0,
    };

    const plan = planCompaction(messages, { budgetChars: 1000, existing })!;
    expect(plan.foldFrom).toBe(10);
    expect(plan.foldThrough).toBeGreaterThan(10);
  });

  it("stops folding when the remainder is already small enough", () => {
    const messages = conversation(40, 10);
    const existing: CompactionState = {
      throughIndex: 30,
      summary: "notes",
      updatedAt: 0,
    };
    expect(planCompaction(messages, { budgetChars: 5000, existing })).toBeNull();
  });

  it("refuses a budget of zero rather than folding everything", () => {
    expect(planCompaction(conversation(20, 500), { budgetChars: 0 })).toBeNull();
  });

  it("handles a conversation shorter than the retained tail", () => {
    expect(planCompaction(conversation(2, 9999), { budgetChars: 10 })).toBeNull();
  });

  it("handles an empty conversation", () => {
    expect(planCompaction([], { budgetChars: 10 })).toBeNull();
  });

  it("ignores a stale summary that runs past the end of the conversation", () => {
    const existing: CompactionState = {
      throughIndex: 99,
      summary: "notes",
      updatedAt: 0,
    };
    expect(
      planCompaction(conversation(4, 10), { budgetChars: 1, existing }),
    ).toBeNull();
  });

  it("honours a caller that wants a different tail", () => {
    const messages = conversation(30, 500);
    const plan = planCompaction(messages, { budgetChars: 1000, keepRecent: 12 })!;
    expect(plan.foldThrough).toBeLessThanOrEqual(messages.length - 12);
  });

  it("respects a minimum fold size given by the caller", () => {
    const messages = conversation(KEEP_RECENT_MESSAGES + 5, 5000);
    expect(planCompaction(messages, { budgetChars: 10, minFold: 20 })).toBeNull();
    expect(planCompaction(messages, { budgetChars: 10, minFold: 2 })).not.toBeNull();
  });
});

describe("renderTranscript", () => {
  it("labels who said what", () => {
    const text = renderTranscript([say("user", "ping"), say("assistant", "pong")]);
    expect(text).toContain("User: ping");
    expect(text).toContain("Assistant: pong");
  });

  it("names attachments without including them", () => {
    const text = renderTranscript([
      {
        ...say("user", "read this"),
        attachments: [
          { name: "budget.xlsx", type: "x", content: "SECRET".repeat(1000) },
        ],
      },
    ]);
    expect(text).toContain("budget.xlsx");
    expect(text).not.toContain("SECRET");
  });

  it("caps a very long message so one turn cannot fill the summariser", () => {
    const text = renderTranscript([say("user", "z".repeat(50000))]);
    expect(text.length).toBeLessThan(10000);
  });

  it("says so rather than showing nothing for an empty message", () => {
    expect(renderTranscript([say("user", "")])).toContain("(no text)");
  });
});

describe("buildSummaryMessages", () => {
  it("asks for notes when there are none yet", () => {
    const messages = buildSummaryMessages(null, [say("user", "hello")]);
    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toContain("hello");
  });

  it("tells the model to extend the notes rather than rewrite them", () => {
    const messages = buildSummaryMessages("earlier notes", [say("user", "next")]);
    expect(messages[1].content).toContain("earlier notes");
    expect(messages[1].content).toMatch(/do not repeat, rewrite or refer back/i);
  });

  it("asks for facts rather than narration", () => {
    const [system] = buildSummaryMessages(null, [say("user", "x")]);
    expect(system.content).toMatch(/facts, not narration/i);
  });
});

describe("appendSummary", () => {
  it("leaves the earlier text byte-identical, which is the whole point", () => {
    const previous = "first section";
    const joined = appendSummary(previous, "second section");
    expect(joined.startsWith(previous)).toBe(true);
  });

  it("returns the addition when there is nothing to append to", () => {
    expect(appendSummary(null, "  only  ")).toBe("only");
  });

  it("keeps what it has when there is nothing to add", () => {
    expect(appendSummary("kept", "   ")).toBe("kept");
  });
});

describe("trimSummary", () => {
  it("leaves a summary within budget untouched", () => {
    expect(trimSummary("short", 100)).toBe("short");
  });

  it("drops the oldest sections first", () => {
    const summary = ["oldest", "middle", "newest"].join("\n\n");
    const trimmed = trimSummary(summary, 15);
    expect(trimmed).toContain("newest");
    expect(trimmed).not.toContain("oldest");
  });

  it("never returns more than the budget", () => {
    const summary = "q".repeat(SUMMARY_CHAR_BUDGET * 3);
    expect(trimSummary(summary).length).toBeLessThanOrEqual(SUMMARY_CHAR_BUDGET);
  });
});

describe("renderCompactionBlock", () => {
  it("frames the notes as a record rather than as a new question", () => {
    const block = renderCompactionBlock({
      throughIndex: 4,
      summary: "budget is 4200",
      updatedAt: 0,
    });
    expect(block).toContain("budget is 4200");
    expect(block).toMatch(/established facts, not a new question/i);
  });
});

describe("compactionSurvives", () => {
  const state: CompactionState = { throughIndex: 10, summary: "s", updatedAt: 0 };

  it("keeps a summary that still matches the conversation", () => {
    expect(compactionSurvives(state, conversation(20))).toBe(state);
  });

  it("drops a summary describing messages that are gone", () => {
    expect(compactionSurvives(state, conversation(4))).toBeNull();
  });

  it("drops a summary when a message inside it was edited", () => {
    expect(compactionSurvives(state, conversation(20), 3)).toBeNull();
  });

  it("keeps a summary when the edit was after the folded range", () => {
    expect(compactionSurvives(state, conversation(20), 15)).toBe(state);
  });

  it("has nothing to keep when there is no summary", () => {
    expect(compactionSurvives(null, conversation(20))).toBeNull();
    expect(compactionSurvives(undefined, conversation(20))).toBeNull();
  });
});

describe("the constants agree with each other", () => {
  it("keeps fewer messages than the smallest fold, so folding can happen", () => {
    expect(MIN_FOLD_MESSAGES).toBeLessThanOrEqual(KEEP_RECENT_MESSAGES);
  });

  it("folds well before the window is full", () => {
    expect(COMPACT_AT).toBeGreaterThan(0);
    expect(COMPACT_AT).toBeLessThan(0.8);
  });
});
