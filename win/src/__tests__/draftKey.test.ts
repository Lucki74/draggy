import { describe, expect, it } from "vitest";
import { draftKeyFor } from "../chat/useChatSession";
import type { ChatMessage } from "../types";

describe("where a draft is kept", () => {
  it("shares one key per mode until the first message is sent", () => {
    expect(draftKeyFor({ id: "a", messages: [] }, "chat")).toBe("draft_new_chat");
    expect(draftKeyFor({ id: "b", messages: [] }, "chat")).toBe("draft_new_chat");
    expect(draftKeyFor({ id: "a", messages: [] }, "code")).toBe("draft_new_code");
  });

  it("keys a chat with messages by its id", () => {
    expect(draftKeyFor({ id: "a", messages: [{} as ChatMessage] }, "chat")).toBe("draft_a");
  });
});
