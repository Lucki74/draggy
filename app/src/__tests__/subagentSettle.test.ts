import { describe, expect, it, vi } from "vitest";
import type { ChatSession, SearchStep } from "../types";

/** A child run cut short by quitting reads as stopped on the next open, with its own steps closed. */
const child = (id: string, isComplete: boolean): SearchStep => ({ id, type: "reading", content: "", isComplete, filename: "a.txt" } as SearchStep);

const session = (steps: SearchStep[]): ChatSession =>
  ({
    id: "c",
    title: "t",
    updatedAt: 0,
    isGenerating: true,
    messages: [
      { id: "u", role: "user", content: "question" },
      { id: "a", role: "assistant", content: "", steps },
    ],
  }) as unknown as ChatSession;

describe("settling an interrupted child run", () => {
  vi.stubGlobal("window", {});
  const settleSession = async (value: ChatSession) => (await import("../storage")).settleSession(value);

  it("marks a running child stopped and closes its unfinished steps", async () => {
    const running = {
      id: "sa",
      type: "subagent",
      content: "Config",
      isComplete: false,
      subagent: { task: "t", label: "Config", status: "running", readOnly: true, toolCount: 1, steps: [child("c1", true), child("c2", false)] },
    } as SearchStep;

    const settled = await settleSession(session([running]));
    const step = settled.messages[1].steps?.[0];
    expect(step?.isComplete).toBe(true);
    expect(step?.subagent?.status).toBe("stopped");
    expect(step?.subagent?.steps.every((entry) => entry.isComplete)).toBe(true);
  });

  it("leaves a finished child run and an old chat without the field alone", async () => {
    const done = {
      id: "sa",
      type: "subagent",
      content: "Config",
      isComplete: true,
      subagent: { task: "t", label: "Config", status: "done", readOnly: true, toolCount: 0, steps: [], summary: "ok" },
    } as SearchStep;
    const old = child("old", true);

    const settled = await settleSession(session([done, old]));
    expect(settled.messages[1].steps?.[0]).toBe(done);
    expect(settled.messages[1].steps?.[1]).toBe(old);
  });
});
