import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const fileOperations = require("./fileOps.cjs");
const checkpoints = require("./checkpoints.cjs");

/**
 * What the file tools do once they are past the guard. The part worth testing
 * hardest is the undo: a change Draggy makes has to be reversible, or the
 * permission model is the only thing standing between a model and someone's
 * work.
 */

let root;
let userData;
let ops;
let rows;
let binned;

/** Enough of the storage module for the checkpoint rows to live somewhere. */
function fakeStorage() {
  const kept = new Map();
  let nextId = 1;

  return {
    rows: kept,
    addCheckpoint(entry) {
      const id = nextId++;
      kept.set(id, { ...entry, id, detail: entry.detail ?? null });
      return { success: true, id };
    },
    getCheckpoint(id) {
      return kept.get(Number(id)) || null;
    },
    dropCheckpoint(id) {
      kept.delete(Number(id));
      return { success: true };
    },
  };
}

beforeEach(() => {
  const base = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "draggy-ops-")),
  );

  root = path.join(base, "project");
  userData = path.join(base, "userdata");

  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(userData, { recursive: true });

  fs.writeFileSync(path.join(root, "notes.md"), "first line\nsecond line\n");
  fs.writeFileSync(path.join(root, "src", "App.tsx"), "const answer = 1;\n");

  checkpoints.init(userData);

  const storage = fakeStorage();
  rows = storage;
  binned = [];

  ops = fileOperations.create({
    roots: (workspaceId) => (workspaceId === "w1" ? [root] : []),
    storage,
    checkpoints,
    trash: async (target) => {
      binned.push(target);
      fs.rmSync(target, { force: true });
    },
  });
});

afterEach(() => {
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
});

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

describe("looking around", () => {
  it("lists folders before files", () => {
    const result = ops.list("w1", ".");

    expect(result.success).toBe(true);
    expect(result.entries.map((entry) => entry.name)).toEqual([
      "src",
      "notes.md",
    ]);
    expect(result.entries[0].isDirectory).toBe(true);
  });

  it("reads a file", () => {
    expect(ops.read("w1", "notes.md").text).toBe("first line\nsecond line\n");
  });

  it("refuses everything for a workspace with no folder", () => {
    expect(ops.read("other", "notes.md").success).toBe(false);
    expect(ops.list("other", ".").success).toBe(false);
    expect(ops.search("other", { text: "a" }).success).toBe(false);
  });
});

describe("writing", () => {
  it("creates a file and says so", () => {
    const result = ops.write("w1", "new.txt", "hello\n", "chat-1");

    expect(result.success).toBe(true);
    expect(result.created).toBe(true);
    expect(read("new.txt")).toBe("hello\n");
  });

  it("makes the folders on the way", () => {
    const result = ops.write("w1", "docs/deep/notes.md", "hi\n");

    expect(result.success).toBe(true);
    expect(read(path.join("docs", "deep", "notes.md"))).toBe("hi\n");
  });

  it("keeps what was there before", () => {
    ops.write("w1", "notes.md", "replaced\n", "chat-1");

    const entry = rows.getCheckpoint(1);
    expect(entry.beforeHash).toBeTruthy();
    expect(checkpoints.read(entry.beforeHash).toString("utf8")).toBe(
      "first line\nsecond line\n",
    );
  });

  it("still refuses a path outside the folder", () => {
    expect(ops.write("w1", "../escape.txt", "x").success).toBe(false);
  });
});

describe("editing", () => {
  it("replaces exactly what was asked for", () => {
    const result = ops.edit("w1", "notes.md", "second", "third", 1, "chat-1");

    expect(result.success).toBe(true);
    expect(result.replaced).toBe(1);
    expect(read("notes.md")).toBe("first line\nthird line\n");
  });

  it("hands back both versions, for the timeline to show", () => {
    const result = ops.edit("w1", "notes.md", "second", "third");

    expect(result.before).toContain("second line");
    expect(result.after).toContain("third line");
  });

  it("refuses text that is not there, and says what to do", () => {
    const result = ops.edit("w1", "notes.md", "nowhere", "x");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/copy the lines exactly/);
    expect(read("notes.md")).toBe("first line\nsecond line\n");
  });

  it("refuses text that appears more often than expected", () => {
    fs.writeFileSync(path.join(root, "twice.md"), "same\nsame\n");

    const result = ops.edit("w1", "twice.md", "same", "other");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/appears 2 times/);
    expect(read("twice.md")).toBe("same\nsame\n");
  });

  it("replaces every occurrence when the count is given", () => {
    fs.writeFileSync(path.join(root, "twice.md"), "same\nsame\n");

    const result = ops.edit("w1", "twice.md", "same", "other", 2);

    expect(result.success).toBe(true);
    expect(read("twice.md")).toBe("other\nother\n");
  });
});

describe("moving and deleting", () => {
  it("moves a file", () => {
    const result = ops.move("w1", "notes.md", "docs/notes.md", "chat-1");

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(root, "notes.md"))).toBe(false);
    expect(read(path.join("docs", "notes.md"))).toBe("first line\nsecond line\n");
  });

  it("refuses to write over something already there", () => {
    const result = ops.move("w1", "notes.md", "src/App.tsx");

    expect(result.success).toBe(false);
    expect(read("notes.md")).toBeTruthy();
  });

  it("puts a deletion in the bin rather than destroying it", async () => {
    const result = await ops.remove("w1", "notes.md", "chat-1");

    expect(result.success).toBe(true);
    expect(binned).toHaveLength(1);
    expect(rows.getCheckpoint(result.checkpointId).beforeHash).toBeTruthy();
  });

  it("refuses to delete a folder", async () => {
    const result = await ops.remove("w1", "src");

    expect(result.success).toBe(false);
    expect(fs.existsSync(path.join(root, "src"))).toBe(true);
  });
});

describe("undoing what Draggy did", () => {
  it("puts an edited file back", async () => {
    const edit = ops.edit("w1", "notes.md", "second", "third");

    const undone = await ops.revert(edit.checkpointId);

    expect(undone.success).toBe(true);
    expect(read("notes.md")).toBe("first line\nsecond line\n");
  });

  it("takes away a file that was created", async () => {
    const written = ops.write("w1", "new.txt", "hello\n");

    const undone = await ops.revert(written.checkpointId);

    expect(undone.success).toBe(true);
    expect(fs.existsSync(path.join(root, "new.txt"))).toBe(false);
  });

  it("brings back a file that was deleted", async () => {
    const removed = await ops.remove("w1", "notes.md");
    expect(fs.existsSync(path.join(root, "notes.md"))).toBe(false);

    const undone = await ops.revert(removed.checkpointId);

    expect(undone.success).toBe(true);
    expect(read("notes.md")).toBe("first line\nsecond line\n");
  });

  it("moves a file back where it came from", async () => {
    const moved = ops.move("w1", "notes.md", "docs/notes.md");

    const undone = await ops.revert(moved.checkpointId);

    expect(undone.success).toBe(true);
    expect(read("notes.md")).toBe("first line\nsecond line\n");
    expect(fs.existsSync(path.join(root, "docs", "notes.md"))).toBe(false);
  });

  it("forgets the change once it has been undone", async () => {
    const edit = ops.edit("w1", "notes.md", "second", "third");

    await ops.revert(edit.checkpointId);

    expect(rows.getCheckpoint(edit.checkpointId)).toBeNull();
    expect((await ops.revert(edit.checkpointId)).success).toBe(false);
  });

  it("refuses to undo into a folder the workspace no longer has", async () => {
    const edit = ops.edit("w1", "notes.md", "second", "third");

    // The project was closed: the row is still there, the reach is not.
    rows.rows.get(edit.checkpointId).workspaceId = "other";

    const undone = await ops.revert(edit.checkpointId);

    expect(undone.success).toBe(false);
    expect(read("notes.md")).toBe("first line\nthird line\n");
  });
});

describe("searching", () => {
  it("finds text and says which line it is on", () => {
    const result = ops.search("w1", { text: "answer" });

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].name).toBe("App.tsx");
    expect(result.hits[0].line).toBe(1);
  });

  it("finds files by name", () => {
    const result = ops.search("w1", { name: ".tsx" });

    expect(result.hits.map((hit) => hit.name)).toEqual(["App.tsx"]);
  });

  it("walks past generated folders", () => {
    const modules = path.join(root, "node_modules", "thing");
    fs.mkdirSync(modules, { recursive: true });
    fs.writeFileSync(path.join(modules, "index.js"), "const answer = 2;\n");

    const result = ops.search("w1", { text: "answer" });

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].path).not.toContain("node_modules");
  });

  it("needs something to look for", () => {
    expect(ops.search("w1", {}).success).toBe(false);
  });
});

describe("undoing a change to something that is not text", () => {
  it("brings a deleted file back byte for byte", async () => {
    // The bug this covers: a checkpoint kept as utf8 turns an image into
    // mangled text, and undoing the deletion restores a broken file.
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x0d]);
    fs.writeFileSync(path.join(root, "logo.png"), bytes);

    const removed = await ops.remove("w1", "logo.png");
    const undone = await ops.revert(removed.checkpointId);

    expect(undone.success).toBe(true);
    expect(fs.readFileSync(path.join(root, "logo.png"))).toEqual(bytes);
  });
});

describe("searching is not a way around the guard", () => {
  it("does not read credentials it walks past", () => {
    // The hole this closes: resolveWithin refuses .env by name, so a search
    // that read one would be the way around it.
    fs.writeFileSync(path.join(root, ".env"), "API_KEY=hunter2\n");

    const result = ops.search("w1", { text: "hunter2" });

    expect(result.success).toBe(true);
    expect(result.hits).toEqual([]);
  });

  it("does not walk into a credential folder", () => {
    fs.mkdirSync(path.join(root, ".ssh"), { recursive: true });
    fs.writeFileSync(path.join(root, ".ssh", "id_rsa"), "PRIVATE KEY\n");

    expect(ops.search("w1", { text: "PRIVATE KEY" }).hits).toEqual([]);
    expect(ops.search("w1", { name: "id_rsa" }).hits).toEqual([]);
  });
});
