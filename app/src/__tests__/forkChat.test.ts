import { describe, expect, it } from "vitest";
import type { ChatSession, Message } from "../types";
import { forkAt } from "../chat/fork";

const user = (id: string, content: string): Message => ({ id, role: "user", content });
const reply = (id: string, content: string, extra: Partial<Message> = {}): Message => ({
  id,
  role: "assistant",
  content,
  ...extra,
});

const session = (messages: Message[], extra: Partial<ChatSession> = {}): ChatSession => ({
  id: "chat-1",
  title: "Plans",
  messages,
  updatedAt: 1,
  isGenerating: false,
  ...extra,
});

let seq = 0;
const newId = () => `n${++seq}`;

describe("forkAt", () => {
  it("keeps the conversation through a reply and gives fresh ids", () => {
    const s = session([user("u1", "hi"), reply("a1", "hello"), user("u2", "more")]);
    const fork = forkAt(s, 1, "chat-2", "Copy", newId);
    expect(fork?.session.id).toBe("chat-2");
    expect(fork?.session.messages.map((m) => m.content)).toEqual(["hi", "hello"]);
    expect(fork?.session.messages.every((m) => !["u1", "a1"].includes(m.id))).toBe(true);
    expect(fork?.draft).toBeUndefined();
    expect(fork?.session.isGenerating).toBe(false);
  });

  it("ends before a user message and returns its wording as a draft", () => {
    const s = session([user("u1", "hi"), reply("a1", "hello"), user("u2", "more")]);
    const fork = forkAt(s, 2, "chat-2", "Copy", newId);
    expect(fork?.session.messages.map((m) => m.content)).toEqual(["hi", "hello"]);
    expect(fork?.draft).toBe("more");
  });

  it("shows the selected version and drops branch data", () => {
    const s = session([
      {
        ...user("u1", "newest"),
        versions: [{ content: "first wording" }],
        currentVersionIndex: 0,
      },
      reply("a1", "answer"),
    ]);
    const fork = forkAt(s, 1, "chat-2", "Copy", newId);
    expect(fork?.session.messages.map((m) => m.content)).toEqual(["first wording", "answer"]);
    expect(fork?.session.messages[0]).not.toHaveProperty("versions");
  });

  it("returns null for a notice, a first user message or a bad index", () => {
    const notice = { id: "n1", role: "assistant", content: "stopped", notice: "tasks_ended" } as Message;
    expect(forkAt(session([notice, reply("a1", "x")]), 0, "chat-2", "Copy", newId)).toBeNull();
    expect(forkAt(session([user("u1", "hi")]), 0, "chat-2", "Copy", newId)).toBeNull();
    expect(forkAt(session([user("u1", "hi")]), 9, "chat-2", "Copy", newId)).toBeNull();
  });

  it("keeps compaction only when it fits in the fork", () => {
    const messages = [user("u1", "a"), reply("a1", "b"), user("u2", "c")];
    const kept = forkAt(session(messages, { compaction: { throughIndex: 1, summary: "s" } as never }), 1, "x", "T", newId);
    expect(kept?.session.compaction).toBeDefined();
    const dropped = forkAt(session(messages, { compaction: { throughIndex: 2, summary: "s" } as never }), 0, "x", "T", newId);
    expect(dropped?.session.compaction).toBeUndefined();
  });

  it("drops compaction when the fork holds an earlier branch", () => {
    const branched = user("u1", "a");
    branched.versions = [{ content: "old" }];
    branched.currentVersionIndex = 0;
    const messages = [branched, reply("a1", "b"), user("u2", "c")];
    const fork = forkAt(session(messages, { compaction: { throughIndex: 1, summary: "s" } as never }), 1, "x", "T", newId);
    expect(fork?.session.compaction).toBeUndefined();
  });
});

describe("forkAt edge cases", () => {
  it("forks a fork and keeps the same conversation", () => {
    const s = session([user("u1", "hi"), reply("a1", "hello"), user("u2", "more"), reply("a2", "sure")]);
    const first = forkAt(s, 3, "chat-2", "Copy", newId)!;
    const second = forkAt(first.session, 1, "chat-3", "Copy again", newId)!;
    expect(second.session.messages.map((m) => m.content)).toEqual(["hi", "hello"]);
    expect(second.session.messages.some((m) => first.session.messages.some((f) => f.id === m.id))).toBe(false);
  });

  it("flattens a reply with a 1.x version to its shown text", () => {
    const s = session([user("u1", "hi"), reply("a1", "new", { versions: [reply("a1", "old")], currentVersionIndex: 0 })]);
    const fork = forkAt(s, 1, "chat-2", "Copy", newId)!;
    expect(fork.session.messages[1].content).toBe("old");
    expect(fork.session.messages[1].versions).toBeUndefined();
  });

  it("forks a very long chat from its last reply", () => {
    const long: Message[] = [];
    for (let i = 0; i < 2000; i++) long.push(user(`u${i}`, `q${i}`), reply(`a${i}`, `r${i}`));
    const fork = forkAt(session(long), long.length - 1, "chat-2", "Copy", newId)!;
    expect(fork.session.messages).toHaveLength(4000);
    expect(fork.session.messages[3999].content).toBe("r1999");
  });
});

describe("forkAt copies", () => {
  it("drops the provider thread but keeps tool results and attachments", () => {
    const attachment = { name: "a.png", type: "image/png", content: "x" };
    const s = session([
      user("u1", "hi"),
      reply("a1", "hello", { provider_state: { instanceId: "i1", state: { threadId: "t1" } }, toolResults: [{ id: "r" }] as never, attachments: [attachment] as never }),
    ]);
    const fork = forkAt(s, 1, "chat-2", "Copy", newId)!;
    const copied = fork.session.messages[1];
    expect(copied.provider_state).toBeUndefined();
    expect(copied.toolResults).toEqual([{ id: "r" }]);
    expect(copied.attachments).toEqual([attachment]);
  });

  it("keeps a compaction when no message has branches", () => {
    const s = session([user("u1", "hi"), reply("a1", "hello"), user("u2", "more")], {
      compaction: { throughIndex: 2, summary: "s" } as never,
    });
    const fork = forkAt(s, 2, "chat-2", "Copy", newId)!;
    expect(fork.session.compaction).toEqual({ throughIndex: 2, summary: "s" });
  });
});
