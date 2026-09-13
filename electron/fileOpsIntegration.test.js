import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const fileOperations = require("./fileOps.cjs");
const checkpoints = require("./checkpoints.cjs");
const storage = require("./storage.cjs");

/**
 * The file tools wired the way main.cjs wires them: the real database and the
 * real checkpoint store, not the fakes the unit tests use. A mismatch between
 * the SQL and the values bound to it only shows up here, which is exactly how
 * a checkpoint insert with one column missing went unnoticed.
 */

let base;
let root;
let ops;

beforeEach(() => {
  base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "draggy-ops-real-")));
  root = path.join(base, "project");
  const userData = path.join(base, "userdata");

  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(root, "notes.md"), "first\n");

  storage.init(userData);
  storage.saveWorkspace({ id: "w1", name: "Project", kind: "project", rootPath: root, settings: {} });
  checkpoints.init(userData);

  ops = fileOperations.create({
    roots: (workspaceId) => {
      const workspace = storage.getWorkspace(workspaceId);
      return workspace?.rootPath ? [workspace.rootPath] : [];
    },
    storage,
    checkpoints,
    trash: async (target) => fs.rmSync(target, { force: true }),
  });
});

afterEach(() => {
  storage.close();
  fs.rmSync(base, { recursive: true, force: true });
});

describe("every change is kept in the real database", () => {
  it("writes a file and can undo it", async () => {
    const written = ops.write("w1", "notes.md", "second\n", "chat-1");

    expect(written.success).toBe(true);
    expect(storage.getCheckpoint(written.checkpointId)).toMatchObject({
      workspaceId: "w1",
      chatId: "chat-1",
      action: "write",
    });

    expect((await ops.revert(written.checkpointId)).success).toBe(true);
    expect(fs.readFileSync(path.join(root, "notes.md"), "utf8")).toBe("first\n");
  });

  it("edits a file and can undo it", async () => {
    const edited = ops.edit("w1", "notes.md", "first", "changed", 1, "chat-1");

    expect(edited.success).toBe(true);
    expect((await ops.revert(edited.checkpointId)).success).toBe(true);
    expect(fs.readFileSync(path.join(root, "notes.md"), "utf8")).toBe("first\n");
  });

  it("moves a file, keeping where it came from, and can move it back", async () => {
    const moved = ops.move("w1", "notes.md", "docs/notes.md", "chat-1");

    expect(moved.success).toBe(true);
    expect(storage.getCheckpoint(moved.checkpointId).detail).toBe(path.join(root, "notes.md"));

    expect((await ops.revert(moved.checkpointId)).success).toBe(true);
    expect(fs.existsSync(path.join(root, "notes.md"))).toBe(true);
  });

  it("deletes a file and can bring it back", async () => {
    const removed = await ops.remove("w1", "notes.md", "chat-1");

    expect(removed.success).toBe(true);
    expect((await ops.revert(removed.checkpointId)).success).toBe(true);
    expect(fs.readFileSync(path.join(root, "notes.md"), "utf8")).toBe("first\n");
  });

  it("names every stored version a checkpoint still needs, so cleanup keeps them", () => {
    const written = ops.write("w1", "notes.md", "second\n", "chat-1");
    const entry = storage.getCheckpoint(written.checkpointId);

    const hashes = storage.checkpointHashes();

    expect(hashes).toContain(entry.beforeHash);
    expect(hashes).toContain(entry.afterHash);
  });

  it("lists the changes for the workspace, newest first, and forgets undone ones", async () => {
    const first = ops.write("w1", "a.md", "a\n", "chat-1");
    const second = ops.write("w1", "b.md", "b\n", "chat-1");

    expect(storage.listCheckpoints("w1").map((entry) => entry.id)).toEqual([
      second.checkpointId,
      first.checkpointId,
    ]);

    await ops.revert(second.checkpointId);
    expect(storage.listCheckpoints("w1").map((entry) => entry.id)).toEqual([first.checkpointId]);
  });
});
