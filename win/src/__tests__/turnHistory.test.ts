// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { ChatSession, Message } from "../types";
import {
  classifyTurnError,
  editAt,
  isTransient,
  modelHistory,
  promoteShown,
  retryAt,
  shownMessage,
  switchAt,
} from "../agent/turnHistory";
import { settleSession } from "../storage";

const user = (id: string, content: string): Message => ({ id, role: "user", content });
const reply = (id: string, content: string, extra: Partial<Message> = {}): Message => ({
  id,
  role: "assistant",
  content,
  textContent: content,
  steps: [],
  ...extra,
});

const chat = (): Message[] => [user("u1", "hi"), reply("a1", "hello"), user("u2", "more"), reply("a2", "sure")];

describe("turnHistory", () => {
  it("keeps the later conversation in the old version when retrying mid-chat", () => {
    const retried = retryAt(chat(), 1)!;
    expect(retried).toHaveLength(2);
    const fresh = retried[1];
    expect(fresh.content).toBe("");
    expect(fresh.versions).toHaveLength(1);
    expect(fresh.versions![0].content).toBe("hello");
    expect(fresh.versions![0].tail!.map((m) => m.id)).toEqual(["u2", "a2"]);
    expect(fresh.currentVersionIndex).toBe(1);
  });

  it("brings the tail back when switching to the old version and keeps the new one", () => {
    const retried = retryAt(chat(), 1)!;
    retried[1] = { ...retried[1], content: "hey", textContent: "hey" };
    retried.push(user("u3", "next"));

    const back = switchAt(retried, 1, 0);
    expect(back.map((m) => m.id)).toEqual(["u1", "a1", "u2", "a2"]);
    expect(shownMessage(back[1]).content).toBe("hello");

    const forward = switchAt(back, 1, 1);
    expect(forward.map((m) => m.id)).toEqual(["u1", "a1", "u3"]);
    expect(shownMessage(forward[1]).content).toBe("hey");
  });

  it("drops a failed attempt that wrote nothing instead of keeping it as a version", () => {
    const messages = [user("u1", "hi"), reply("a1", "", { failed: true, error: "boom" })];
    const retried = retryAt(messages, 1)!;
    expect(retried[1].versions).toEqual([]);
    expect(retried[1].failed).toBeUndefined();
  });

  it("branches an edited user message", () => {
    const edited = editAt(chat(), 0, "hello there")!;
    expect(edited).toHaveLength(1);
    expect(edited[0].content).toBe("hello there");
    expect(edited[0].versions![0].content).toBe("hi");
    expect(edited[0].versions![0].tail).toHaveLength(3);
  });

  it("promotes the shown version so a continuation writes into it", () => {
    const retried = retryAt(chat(), 1)!;
    retried[1] = { ...retried[1], content: "hey", textContent: "hey" };
    const back = switchAt(retried, 1, 0);
    const promoted = promoteShown(back[1]);
    expect(promoted.content).toBe("hello");
    expect(promoted.currentVersionIndex).toBe(1);
    expect(promoted.versions![0].content).toBe("hey");
  });

  it("shows the model failures as a placeholder and steering notes inline", () => {
    const history = modelHistory([
      user("u1", "hi"),
      reply("a1", "Error: engine crashed", { failed: true, error: "engine crashed", textContent: "" }),
      user("u2", "go"),
      reply("a2", "working", {
        steps: [{ id: "s", type: "steer", content: "use tabs", isComplete: true } as never],
      }),
    ]);
    expect(history).toHaveLength(4);
    expect(history[1].content).toBe("[This reply failed before any text was written.]");
    expect(history[3].content).toContain("[The user added during this reply: use tabs]");
  });

  it("classifies errors and retries only transient ones", () => {
    expect(classifyTurnError("CUDA error: out of memory")).toBe("memory");
    expect(classifyTurnError("request exceeds the available context size")).toBe("context");
    expect(classifyTurnError("429 Too Many Requests")).toBe("rate-limit");
    expect(classifyTurnError("fetch failed: ECONNREFUSED")).toBe("network");
    expect(classifyTurnError("weird")).toBe("unknown");
    expect(isTransient("network")).toBe(true);
    expect(isTransient("context")).toBe(false);
  });

  it("marks a reply cut short by quitting as interrupted", () => {
    const session = {
      id: "c",
      title: "t",
      updatedAt: 0,
      messages: [
        user("u1", "hi"),
        reply("a1", "half", { steps: [{ id: "s", type: "search", content: "x", isComplete: false } as never] }),
      ],
    } as unknown as ChatSession;
    const settled = settleSession(session);
    expect(settled.messages[1].interrupted).toBe(true);
    expect(settled.messages[1].steps!.every((step) => step.isComplete)).toBe(true);

    const done = settleSession({ ...session, messages: [user("u1", "hi"), reply("a1", "done")] });
    expect(done.messages[1].interrupted).toBeUndefined();
  });
});
