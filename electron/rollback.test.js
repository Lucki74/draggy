import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

/**
 * Going back. Someone who installs 2.0 and then reinstalls 1.2.7 opens a
 * database that 2.0 has written to: new tables, new columns, a higher schema
 * version. 1.2.7 must open it and keep working, even if it cannot see what
 * 2.0 added. The storage module here is 1.2.7's own, byte for byte, checked in
 * under fixtures so the test does not depend on git history.
 */

const current = require("./storage.cjs");
const legacy = require("./fixtures/v1.2.7/storage.cjs");

let workdir;

beforeEach(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-rollback-"));
});

afterEach(() => {
  try {
    legacy.close();
  } catch {
    // Already closed, or never opened.
  }
  try {
    current.close();
  } catch {
    // Same.
  }
  fs.rmSync(workdir, { recursive: true, force: true });
});

/** A database 2.0 has used for a while: projects, a plan, statistics, a checkpoint. */
function writeWithTwoPointOh() {
  current.init(workdir);

  current.saveWorkspace({
    id: "project",
    name: "Thing",
    kind: "project",
    rootPath: workdir,
    permissionMode: "acceptEdits",
    settings: {},
  });

  current.saveChat({
    id: "from-2",
    title: "Written by 2.0",
    updatedAt: 2000,
    isOutOfContext: false,
    workspaceId: "project",
    plan: [{ id: "p1", text: "Do the thing", status: "doing" }],
    messages: [
      { id: "m1", role: "user", content: "hello from 2.0" },
      {
        id: "m2",
        role: "assistant",
        content: "hi",
        textContent: "hi",
        fold: { status: "done", tokens: 1200, at: 1 },
      },
    ],
  });

  current.recordMetric({
    recordedAt: 3000,
    model: "qwen3:8b",
    promptTokens: 10,
    responseTokens: 5,
    responseMs: 100,
    taskMs: 200,
    loops: 1,
    tools: { read_file: 1 },
  });

  current.addCheckpoint({
    workspaceId: "project",
    chatId: "from-2",
    path: path.join(workdir, "notes.md"),
    action: "write",
    beforeHash: null,
    afterHash: null,
  });

  current.close();
}

describe("opening a 2.0 database with 1.2.7", () => {
  it("opens without rebuilding or quarantining anything", () => {
    writeWithTwoPointOh();

    legacy.init(workdir);

    const quarantined = fs.readdirSync(workdir).filter((name) => name.includes("corrupt"));
    expect(quarantined).toEqual([]);
  });

  it("still shows the conversations", () => {
    writeWithTwoPointOh();

    legacy.init(workdir);
    const chats = legacy.loadChats();

    expect(chats).toHaveLength(1);
    expect(chats[0].title).toBe("Written by 2.0");
    expect(chats[0].messages.map((message) => message.content)).toEqual(["hello from 2.0", "hi"]);
  });

  it("can still save, search and delete", () => {
    writeWithTwoPointOh();

    legacy.init(workdir);
    legacy.saveChat({
      id: "from-1",
      title: "Written by 1.2.7 after going back",
      updatedAt: 4000,
      isOutOfContext: false,
      messages: [{ id: "x1", role: "user", content: "back on the old version" }],
    });

    expect(legacy.loadChats()).toHaveLength(2);
    expect(legacy.searchChats("old version").length).toBeGreaterThan(0);

    legacy.deleteChat("from-2");
    expect(legacy.loadChats().map((chat) => chat.id)).toEqual(["from-1"]);
  });

  it("leaves 2.0's data in place for when the user upgrades again", () => {
    writeWithTwoPointOh();

    legacy.init(workdir);
    legacy.saveChat({
      id: "from-1",
      title: "Written by 1.2.7",
      updatedAt: 4000,
      isOutOfContext: false,
      messages: [{ id: "x1", role: "user", content: "hi" }],
    });
    legacy.close();

    current.init(workdir);

    expect(current.listWorkspaces().map((workspace) => workspace.id)).toContain("project");
    expect(current.listMetrics()).toHaveLength(1);
    expect(current.loadChats().map((chat) => chat.id).sort()).toEqual(["from-1", "from-2"]);

    // A chat 1.2.7 wrote has no workspace; 2.0 puts it back in the default one.
    const adopted = current.loadChats().find((chat) => chat.id === "from-1");
    expect(adopted.workspaceId).toBe(current.DEFAULT_WORKSPACE_ID);
  });
});
