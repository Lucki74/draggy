import { describe, expect, it, vi } from "vitest";
import type { SearchStep } from "../types";

describe("a call that was still being written when the app closed", () => {
  it("is not kept when the conversation opens", async () => {
    vi.stubGlobal("window", {});
    const { settleSession } = await import("../storage");
    const live: SearchStep = { id: "l", type: "tool_call", content: "", isComplete: false, tool: "search_web" };
    const done: SearchStep = { id: "d", type: "searching", content: "x", isComplete: true };
    const session = {
      id: "c",
      title: "t",
      updatedAt: 0,
      isGenerating: true,
      messages: [
        {
          id: "m",
          role: "assistant" as const,
          content: "ok",
          steps: [done, live],
          versions: [{ content: "", steps: [live] }],
        },
      ],
    };
    const settled = settleSession(session);
    expect(settled.messages[0].steps?.map((s) => s.id)).toEqual(["d"]);
    expect(settled.messages[0].versions?.[0].steps).toEqual([]);
  });
});
