import { describe, expect, it } from "vitest";
import type { ChatSession, Message } from "../types";
import { shownMessage, shownSlot, switchAt } from "../agent/turnHistory";
import { forkAt } from "../chat/fork";

// Shape a 1.x chat stores: versions hold content only, no tail, and the index can be out of range.
const legacyChat = (): ChatSession =>
  JSON.parse(
    JSON.stringify({
      id: "legacy-1",
      title: "Old chat",
      updatedAt: 1,
      isGenerating: false,
      messages: [
        { id: "u1", role: "user", content: "edited wording", versions: [{ content: "first wording" }], currentVersionIndex: 5 },
        { id: "a1", role: "assistant", content: "reply two", textContent: "reply two", steps: [], versions: [{ content: "reply one", textContent: "reply one" }], currentVersionIndex: -1 },
        { id: "u2", role: "user", content: "more" },
        { id: "a2", role: "assistant", content: "sure", textContent: "sure", steps: [] },
      ],
    }),
  ) as ChatSession;

let seq = 0;
const newId = () => `legacy-n${++seq}`;

describe("1.x chat storage", () => {
  it("clamps out-of-range version indexes to the newest version", () => {
    const [user, reply] = legacyChat().messages as Message[];
    expect(shownSlot(user)).toBe(1);
    expect(shownMessage(user).content).toBe("edited wording");
    expect(shownSlot(reply)).toBe(1);
    expect(shownMessage(reply).content).toBe("reply two");
  });

  it("switches a version without a tail and keeps every message", () => {
    const messages = legacyChat().messages as Message[];
    const back = switchAt(messages, 1, 0);
    expect(back.length).toBeGreaterThanOrEqual(2);
    expect(shownMessage(back[1]).content).toBe("reply one");
  });

  it("forks a 1.x chat without losing the shown conversation", () => {
    const fork = forkAt(legacyChat(), 3, "fork-1", "Old chat (fork)", newId);
    expect(fork).not.toBeNull();
    expect(fork!.session.messages.map((m) => m.id)).toHaveLength(4);
    expect(fork!.session.messages[1].content).toBe("reply two");
    expect(fork!.session.messages[1]).not.toHaveProperty("versions");
  });
});
