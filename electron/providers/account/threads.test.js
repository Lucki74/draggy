import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createThreads } = require("./threads.cjs");

const system = { role: "system", content: "prompt" };
const user = (id, content = id, note = "") => ({ role: "user", content: `${content}${note}`, draggy_ref: { id, hash: `h-${content}` } });
const reply = (id, state, content = id) => ({
  role: "assistant",
  content,
  draggy_ref: { id, hash: `h-${content}` },
  ...(state ? { provider_state: state } : {}),
});

/** Plays one completed turn: plan it, then record it as the runtime would after `turn/completed`. */
function turn(threads, messages, newId = "t1") {
  const planned = threads.plan(messages);
  return { planned, state: threads.record(planned.id ?? newId, messages) };
}

describe("account threads", () => {
  it("seeds a new thread on the first turn, with the prompt left to the runtime's instructions", () => {
    const threads = createThreads({ instanceId: "chatgpt", key: "threadId" });
    const { planned, state } = turn(threads, [system, user("u1")]);
    expect(planned).toEqual({ id: null, history: [], input: user("u1") });
    expect(state).toMatchObject({ instanceId: "chatgpt", state: { threadId: "t1", consumed: 1 } });
  });

  it("resumes with only the new input, even though the wire's time note changed", () => {
    const threads = createThreads({ instanceId: "chatgpt", key: "threadId" });
    const { state } = turn(threads, [system, user("u1", "u1", " [10:00]")]);
    const next = threads.plan([system, user("u1", "u1"), reply("r1", state), user("u2", "u2", " [10:05]")]);
    expect(next).toEqual({ id: "t1", history: [], input: user("u2", "u2", " [10:05]") });
  });

  it("hands another provider's reply in between over as history", () => {
    const threads = createThreads({ instanceId: "chatgpt", key: "threadId" });
    const { state } = turn(threads, [system, user("u1")]);
    const other = reply("r2");
    const next = threads.plan([system, user("u1"), reply("r1", state), user("u2"), other, user("u3")]);
    expect(next).toEqual({ id: "t1", history: [user("u2"), other], input: user("u3") });
  });

  it.each([
    ["an earlier message is edited", (s) => [system, user("u1", "edited"), reply("r1", s), user("u2")]],
    ["the front is compacted away", (s) => [system, { role: "user", content: "summary" }, reply("r1", s), user("u2")]],
  ])("starts over when %s", (_, build) => {
    const threads = createThreads({ instanceId: "chatgpt", key: "threadId" });
    const { state } = turn(threads, [system, user("u1")]);
    const messages = build(state);
    expect(threads.plan(messages)).toEqual({ id: null, history: messages.slice(1, -1), input: user("u2") });
  });

  it("starts over when a reply is regenerated, since the thread already saw the question", () => {
    const threads = createThreads({ instanceId: "chatgpt", key: "threadId" });
    const first = turn(threads, [system, user("u1")]).state;
    turn(threads, [system, user("u1"), reply("r1", first), user("u2")]);
    const again = threads.plan([system, user("u1"), reply("r1", first), user("u2")]);
    expect(again.id).toBeNull();
  });

  it("starts over after a restart or a stopped turn, since threads are ephemeral", () => {
    const threads = createThreads({ instanceId: "chatgpt", key: "threadId" });
    const { state } = turn(threads, [system, user("u1")]);
    const messages = [system, user("u1"), reply("r1", state), user("u2")];
    threads.forget("t1");
    expect(threads.plan(messages).id).toBeNull();
    expect(createThreads({ instanceId: "chatgpt", key: "threadId" }).plan(messages).id).toBeNull();
  });

  it("ignores a state another instance wrote", () => {
    const threads = createThreads({ instanceId: "chatgpt", key: "threadId" });
    turn(threads, [system, user("u1")]);
    const foreign = { instanceId: "work", state: { threadId: "t1", consumed: 1 } };
    expect(threads.plan([system, user("u1"), reply("r1", foreign), user("u2")]).id).toBeNull();
  });

  it("uses the runtime's own name for its thread", () => {
    const threads = createThreads({ instanceId: "claude", key: "sessionId" });
    const { state } = turn(threads, [system, user("u1")], "s1");
    expect(state.state).toMatchObject({ sessionId: "s1", consumed: 1 });
    expect(threads.plan([system, user("u1"), reply("r1", state), user("u2")]).id).toBe("s1");
  });
});
