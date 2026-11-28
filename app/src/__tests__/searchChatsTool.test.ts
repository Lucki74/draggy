import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchChats } from "../tools/memory";

const hits = [
  { chatId: "now", messageId: "a", title: "Current", excerpt: "[ingress] here" },
  { chatId: "old1", messageId: "b", title: "Cluster", excerpt: "tune the [ingress]\n controller" },
  { chatId: "old1", messageId: "c", title: "Cluster", excerpt: "again [ingress]" },
  { chatId: "old2", messageId: "d", title: "Notes", excerpt: "an [ingress] rule" },
];

beforeEach(() => {
  vi.stubGlobal("window", {
    draggy: { db: { searchChats: async () => ({ success: true, results: hits }) } },
  });
});

const ctx = { chatId: "now" } as never;

describe("search_chats", () => {
  it("skips the current chat and repeats of one chat", async () => {
    const out = String(await searchChats.run({ query: "ingress" }, ctx));
    expect(out).toContain("2 chat(s)");
    expect(out).not.toContain("chat now");
    expect(out.match(/chat old1/g)).toHaveLength(1);
    expect(out).toContain("tune the [ingress] controller");
  });

  it("honours the limit", async () => {
    const out = String(await searchChats.run({ query: "ingress", limit: 1 }, ctx));
    expect(out).toContain("1 chat(s)");
  });

  it("reports an empty query and no match", async () => {
    expect(String(await searchChats.run({ query: " " }, ctx))).toContain("Give some words");
    vi.stubGlobal("window", { draggy: { db: { searchChats: async () => ({ success: true, results: [] }) } } });
    expect(String(await searchChats.run({ query: "x" }, ctx))).toContain("No other chat");
  });
});
