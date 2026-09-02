import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const storage = require("./storage.cjs");

let workdir;

beforeEach(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-db-test-"));
  storage.init(workdir);
});

afterEach(() => {
  storage.close();
  fs.rmSync(workdir, { recursive: true, force: true });
});

const message = (id, role, content, extra = {}) => ({
  id,
  role,
  content,
  textContent: content,
  ...extra,
});

const session = (id, messages, extra = {}) => ({
  id,
  title: `Chat ${id}`,
  updatedAt: 1000,
  isOutOfContext: false,
  messages,
  ...extra,
});

describe("round-tripping a conversation", () => {
  it("stores and reloads messages in order", () => {
    storage.saveChat(
      session("a", [
        message("m1", "user", "hello"),
        message("m2", "assistant", "hi there"),
        message("m3", "user", "again"),
      ]),
    );

    const [loaded] = storage.loadChats();

    expect(loaded.id).toBe("a");
    expect(loaded.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(loaded.messages[1].content).toBe("hi there");
  });

  it("preserves nested message fields", () => {
    storage.saveChat(
      session("a", [
        message("m1", "assistant", "answer", {
          steps: [{ id: "s1", type: "searching", content: "looking", isComplete: true }],
          metrics: { responseTokens: 42, tokensPerSecond: 12.5 },
          versions: [{ content: "older" }],
          currentVersionIndex: 0,
        }),
      ]),
    );

    const [loaded] = storage.loadChats();
    const restored = loaded.messages[0];

    expect(restored.steps[0].type).toBe("searching");
    expect(restored.metrics.responseTokens).toBe(42);
    expect(restored.versions[0].content).toBe("older");
    expect(restored.currentVersionIndex).toBe(0);
  });

  it("always reloads with generation stopped", () => {
    storage.saveChat({ ...session("a", []), isGenerating: true });
    expect(storage.loadChats()[0].isGenerating).toBe(false);
  });

  it("orders chats by recency", () => {
    storage.saveChat({ ...session("old", []), updatedAt: 100 });
    storage.saveChat({ ...session("new", []), updatedAt: 900 });

    expect(storage.loadChats().map((c) => c.id)).toEqual(["new", "old"]);
  });

  it("overwrites rather than duplicating on re-save", () => {
    storage.saveChat(session("a", [message("m1", "user", "one")]));
    storage.saveChat(session("a", [message("m1", "user", "one"), message("m2", "user", "two")]));

    const chats = storage.loadChats();
    expect(chats).toHaveLength(1);
    expect(chats[0].messages).toHaveLength(2);
  });

  it("shrinks a conversation when messages are removed", () => {
    storage.saveChat(session("a", [message("m1", "user", "1"), message("m2", "user", "2")]));
    storage.saveChat(session("a", [message("m1", "user", "1")]));

    expect(storage.loadChats()[0].messages).toHaveLength(1);
  });

  it("carries the out-of-context flag", () => {
    storage.saveChat({ ...session("a", []), isOutOfContext: true });
    expect(storage.loadChats()[0].isOutOfContext).toBe(true);
  });
});

describe("attachments", () => {
  const image = "data:image/png;base64," + "A".repeat(4000);

  it("stores attachment content on disk and reads it back intact", () => {
    storage.saveChat(
      session("a", [
        message("m1", "user", "look", {
          attachments: [{ name: "shot.png", type: "image/png", content: image }],
        }),
      ]),
    );

    const restored = storage.loadChats()[0].messages[0].attachments[0];

    expect(restored.name).toBe("shot.png");
    expect(restored.type).toBe("image/png");
    expect(restored.content).toBe(image);
  });

  it("stores one blob for the same image pasted into two chats", () => {
    const attachments = [{ name: "shot.png", type: "image/png", content: image }];

    storage.saveChat(session("a", [message("m1", "user", "one", { attachments })]));
    storage.saveChat(session("b", [message("m2", "user", "two", { attachments })]));

    expect(storage.stats().attachments).toBe(1);
  });

  it("keeps several distinct attachments on one message, in order", () => {
    storage.saveChat(
      session("a", [
        message("m1", "user", "two files", {
          attachments: [
            { name: "a.txt", type: "text/plain", content: "alpha" },
            { name: "b.txt", type: "text/plain", content: "beta" },
          ],
        }),
      ]),
    );

    const restored = storage.loadChats()[0].messages[0].attachments;
    expect(restored.map((a) => a.name)).toEqual(["a.txt", "b.txt"]);
    expect(restored[1].content).toBe("beta");
  });

  it("does not lose a large attachment the way localStorage did", () => {
    const huge = "data:image/png;base64," + "B".repeat(6 * 1024 * 1024);

    storage.saveChat(
      session("a", [
        message("m1", "user", "big", {
          attachments: [{ name: "big.png", type: "image/png", content: huge }],
        }),
      ]),
    );

    expect(storage.loadChats()[0].messages[0].attachments[0].content).toBe(huge);
  });

  it("collects an orphaned blob once the chat is deleted", () => {
    storage.saveChat(
      session("a", [
        message("m1", "user", "look", {
          attachments: [{ name: "shot.png", type: "image/png", content: image }],
        }),
      ]),
    );

    expect(storage.stats().attachments).toBe(1);
    storage.deleteChat("a");
    expect(storage.stats().attachments).toBe(0);
  });

  it("keeps a shared blob alive while another chat still references it", () => {
    const attachments = [{ name: "shot.png", type: "image/png", content: image }];

    storage.saveChat(session("a", [message("m1", "user", "one", { attachments })]));
    storage.saveChat(session("b", [message("m2", "user", "two", { attachments })]));

    storage.deleteChat("a");

    expect(storage.stats().attachments).toBe(1);
    expect(storage.loadChats()[0].messages[0].attachments[0].content).toBe(image);
  });
});

describe("deleting", () => {
  it("removes one chat and leaves the rest", () => {
    storage.saveChat(session("a", [message("m1", "user", "x")]));
    storage.saveChat(session("b", [message("m2", "user", "y")]));

    storage.deleteChat("a");

    expect(storage.loadChats().map((c) => c.id)).toEqual(["b"]);
  });

  it("cascades to messages", () => {
    storage.saveChat(session("a", [message("m1", "user", "x")]));
    storage.deleteChat("a");

    expect(storage.stats().messages).toBe(0);
  });

  it("clears everything", () => {
    storage.saveChat(session("a", [message("m1", "user", "x")]));
    storage.saveChat(session("b", [message("m2", "user", "y")]));

    storage.clearChats();

    expect(storage.loadChats()).toEqual([]);
    expect(storage.stats().messages).toBe(0);
  });

  it("ignores a delete for a chat that is not there", () => {
    expect(() => storage.deleteChat("ghost")).not.toThrow();
  });
});

describe("full-text search", () => {
  beforeEach(() => {
    storage.saveChat(
      session("a", [message("m1", "user", "How do I calibrate the microphone threshold?")]),
    );
    storage.saveChat(
      session("b", [message("m2", "assistant", "The KV cache grows with context length.")]),
    );
  });

  it("finds a chat by a word in a message", () => {
    const hits = storage.searchChats("microphone");

    expect(hits).toHaveLength(1);
    expect(hits[0].chatId).toBe("a");
  });

  it("matches a prefix", () => {
    expect(storage.searchChats("calibr").map((h) => h.chatId)).toEqual(["a"]);
  });

  it("returns an excerpt around the match", () => {
    expect(storage.searchChats("cache")[0].excerpt).toContain("[cache]");
  });

  it("returns nothing for an empty query", () => {
    expect(storage.searchChats("   ")).toEqual([]);
  });

  it("does not throw on query syntax a user might type", () => {
    for (const term of ['"', "AND", "a OR", "*", "(", "NEAR/"]) {
      expect(() => storage.searchChats(term)).not.toThrow();
    }
  });

  it("drops a deleted chat from the index", () => {
    storage.deleteChat("a");
    expect(storage.searchChats("microphone")).toEqual([]);
  });

  it("reindexes on re-save", () => {
    storage.saveChat(session("a", [message("m1", "user", "completely different words")]));

    expect(storage.searchChats("microphone")).toEqual([]);
    expect(storage.searchChats("completely")).toHaveLength(1);
  });
});

describe("key-value settings", () => {
  it("stores and reads a value", () => {
    storage.setValue("theme", "dark");
    expect(storage.getValue("theme")).toBe("dark");
  });

  it("returns null for a key that was never set", () => {
    expect(storage.getValue("nope")).toBeNull();
  });

  it("overwrites on a second write", () => {
    storage.setValue("k", "one");
    storage.setValue("k", "two");
    expect(storage.getValue("k")).toBe("two");
  });
});

describe("importing from localStorage", () => {
  it("imports a batch of sessions", () => {
    const result = storage.importSessions([
      session("a", [message("m1", "user", "one")]),
      session("b", [message("m2", "user", "two")]),
    ]);

    expect(result.imported).toBe(2);
    expect(storage.loadChats()).toHaveLength(2);
  });

  it("skips entries with no id rather than failing the whole import", () => {
    const result = storage.importSessions([
      session("a", [message("m1", "user", "one")]),
      { title: "broken" },
      null,
    ]);

    expect(result.imported).toBe(1);
  });

  it("tolerates a session with no messages array", () => {
    expect(() => storage.importSessions([{ id: "x", title: "t" }])).not.toThrow();
  });
});

describe("summaries", () => {
  it("reports message counts without loading the bodies", () => {
    storage.saveChat(
      session("a", [message("m1", "user", "x"), message("m2", "assistant", "y")]),
    );

    const [summary] = storage.loadChatSummaries();
    expect(summary.messageCount).toBe(2);
    expect(summary.title).toBe("Chat a");
  });
});

describe("message ids only need to be unique within a chat", () => {
  it("accepts the same message id in two different chats", () => {
    storage.saveChat(session("a", [message("shared-id", "user", "in chat a")]));

    expect(() =>
      storage.saveChat(session("b", [message("shared-id", "user", "in chat b")])),
    ).not.toThrow();

    const chats = storage.loadChats();
    expect(chats).toHaveLength(2);
  });

  it("keeps both copies separate and intact", () => {
    storage.saveChat(session("a", [message("shared-id", "user", "in chat a")]));
    storage.saveChat(session("b", [message("shared-id", "user", "in chat b")]));

    const byId = Object.fromEntries(storage.loadChats().map((c) => [c.id, c]));

    expect(byId.a.messages[0].content).toBe("in chat a");
    expect(byId.b.messages[0].content).toBe("in chat b");
  });

  it("keeps attachments attached to the right copy", () => {
    storage.saveChat(
      session("a", [
        message("shared-id", "user", "a", {
          attachments: [{ name: "a.txt", type: "text/plain", content: "alpha" }],
        }),
      ]),
    );
    storage.saveChat(
      session("b", [
        message("shared-id", "user", "b", {
          attachments: [{ name: "b.txt", type: "text/plain", content: "beta" }],
        }),
      ]),
    );

    const byId = Object.fromEntries(storage.loadChats().map((c) => [c.id, c]));

    expect(byId.a.messages[0].attachments[0].content).toBe("alpha");
    expect(byId.b.messages[0].attachments[0].content).toBe("beta");
  });

  it("survives a duplicate id inside one chat rather than refusing to save", () => {
    expect(() =>
      storage.saveChat(
        session("a", [
          message("dup", "user", "first"),
          message("dup", "assistant", "second"),
        ]),
      ),
    ).not.toThrow();

    expect(storage.loadChats()[0].messages).toHaveLength(2);
  });

  it("still round-trips a chat that reuses ids across many saves", () => {
    for (let i = 0; i < 5; i++) {
      storage.saveChat(session("a", [message("m1", "user", `take ${i}`)]));
      storage.saveChat(session("b", [message("m1", "user", `other ${i}`)]));
    }

    const byId = Object.fromEntries(storage.loadChats().map((c) => [c.id, c]));
    expect(byId.a.messages[0].content).toBe("take 4");
    expect(byId.b.messages[0].content).toBe("other 4");
  });
});

describe("upgrading a database written by the old schema", () => {
  it("migrates chats, messages and attachments without losing anything", () => {
    storage.close();

    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-legacy-"));
    const { DatabaseSync } = require("node:sqlite");
    const legacy = new DatabaseSync(path.join(legacyDir, "draggy.db"));

    legacy.exec(`
      CREATE TABLE chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL, is_out_of_context INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE messages (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, position INTEGER NOT NULL, role TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE attachments (message_id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, blob_hash TEXT NOT NULL, PRIMARY KEY (message_id, position));
      CREATE TABLE blobs (hash TEXT PRIMARY KEY, bytes INTEGER NOT NULL);
      CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE VIRTUAL TABLE message_search USING fts5(chat_id UNINDEXED, message_id UNINDEXED, body);

      INSERT INTO chats VALUES ('old', 'Old chat', 500, 0);
      INSERT INTO messages VALUES ('om1', 'old', 0, 'user', '{"id":"om1","role":"user","content":"hello from v1"}');
      INSERT INTO kv VALUES ('schema_version', '1');
    `);
    legacy.close();

    storage.init(legacyDir);

    const chats = storage.loadChats();
    expect(chats).toHaveLength(1);
    expect(chats[0].messages[0].content).toBe("hello from v1");

    // The whole point of the upgrade: ids may now repeat across chats.
    expect(() =>
      storage.saveChat(session("fresh", [message("om1", "user", "reused id")])),
    ).not.toThrow();

    storage.close();
    fs.rmSync(legacyDir, { recursive: true, force: true });
    storage.init(workdir);
  });
});

describe("surviving a damaged database", () => {
  it("rebuilds when the search index cannot be constructed", () => {
    storage.close();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-corrupt-"));
    const dbPath = path.join(dir, "draggy.db");

    // Build a healthy database with real content first.
    storage.init(dir);
    storage.saveChat(session("keep", [message("m1", "user", "important message")]));
    storage.close();

    // Corrupt it the way an interrupted write does: scribble over pages in the
    // middle of the file while leaving the header intact, so it still opens.
    const bytes = fs.readFileSync(dbPath);
    const from = Math.min(4096, bytes.length - 1);
    const to = Math.min(from + 3072, bytes.length);
    for (let i = from; i < to; i++) bytes[i] = 0x5a;
    fs.writeFileSync(dbPath, bytes);

    // Opening must not throw, and must not lose the conversation.
    expect(() => storage.init(dir)).not.toThrow();

    // And the database must be writable and readable again afterwards.
    expect(() => storage.loadChats()).not.toThrow();
    expect(() =>
      storage.saveChat(session("after", [message("m2", "user", "written after repair")])),
    ).not.toThrow();

    const after = storage.loadChats();
    expect(after.map((c) => c.id)).toContain("after");
    expect(after.find((c) => c.id === "after").messages[0].content).toBe(
      "written after repair",
    );

    // The damaged file is kept aside rather than silently deleted.
    const quarantined = fs.readdirSync(dir).filter((n) => n.includes(".corrupt-"));
    expect(quarantined.length).toBeGreaterThan(0);

    storage.close();
    fs.rmSync(dir, { recursive: true, force: true });
    storage.init(workdir);
  });

  it("starts cleanly when the database file is truncated garbage", () => {
    storage.close();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-garbage-"));
    fs.writeFileSync(path.join(dir, "draggy.db"), "this is not a database at all");

    expect(() => storage.init(dir)).not.toThrow();
    expect(() =>
      storage.saveChat(session("fresh", [message("m1", "user", "hello")])),
    ).not.toThrow();
    expect(storage.loadChats()).toHaveLength(1);

    storage.close();
    fs.rmSync(dir, { recursive: true, force: true });
    storage.init(workdir);
  });
});

describe("carrying a folded conversation across restarts", () => {
  const folded = {
    throughIndex: 4,
    summary: "Budget is 4200 GBP. Deadline 14 March.",
    updatedAt: 1700000000000,
  };

  it("saves and reads back a summary", () => {
    storage.saveChat(
      session("c1", [message("m1", "user", "hi")], { compaction: folded }),
    );

    const [chat] = storage.loadChats();
    expect(chat.compaction).toEqual(folded);
  });

  it("reads back nothing when a chat was never folded", () => {
    storage.saveChat(session("c2", [message("m1", "user", "hi")]));

    const [chat] = storage.loadChats();
    expect(chat.compaction).toBeNull();
  });

  it("clears a summary when the chat is saved again without one", () => {
    const chat = session("c3", [message("m1", "user", "hi")], {
      compaction: folded,
    });
    storage.saveChat(chat);
    storage.saveChat({ ...chat, compaction: null });

    expect(storage.loadChats()[0].compaction).toBeNull();
  });

  it("ignores a summary it cannot make sense of", () => {
    // Written by a future version, or half-written. Losing a summary costs one
    // idle generation to rebuild; failing the conversation costs the lot.
    storage.saveChat(
      session("c4", [message("m1", "user", "hi")], {
        compaction: { throughIndex: 4 },
      }),
    );

    expect(storage.loadChats()[0].compaction).toBeNull();
  });

  it("ignores a summary with no index to anchor it", () => {
    storage.saveChat(
      session("c5", [message("m1", "user", "hi")], {
        compaction: { summary: "notes with nowhere to sit" },
      }),
    );

    expect(storage.loadChats()[0].compaction).toBeNull();
  });
});
