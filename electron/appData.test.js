import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { planAdoption, adoptFolder, MARKER, LEGACY_MARKER } =
  require("./appData.cjs");

let workdir;
let from;
let to;

const write = (dir, name, body) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), body);
};

/** A folder as the app itself would leave it. */
const withData = (dir, body = "every chat ever") => write(dir, MARKER, body);

/**
 * A folder as Electron leaves it before the app has stored anything: the
 * profile scaffolding is there, but none of the app's own data.
 */
const scaffolded = (dir) => {
  write(dir, "Preferences", "{}");
  write(dir, "Local State", "{}");
  fs.mkdirSync(path.join(dir, "Network"), { recursive: true });
};

beforeEach(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-appdata-test-"));
  from = path.join(workdir, "OldName");
  to = path.join(workdir, "NewName");
});

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("deciding whether to take over the old folder", () => {
  it("adopts a folder that holds the previous data", () => {
    withData(from);
    expect(planAdoption({ from, to })).toBe("adopt");
  });

  it("does nothing when there was no previous folder", () => {
    expect(planAdoption({ from, to })).toBe("none");
  });

  it("does nothing when the name did not actually change", () => {
    withData(from);
    expect(planAdoption({ from, to: from })).toBe("none");
  });

  it("ignores an old folder the app never actually stored anything in", () => {
    scaffolded(from);
    expect(planAdoption({ from, to })).toBe("none");
  });

  it("still adopts when the new folder is only Electron's scaffolding", () => {
    // Electron writes Preferences as it starts, so "has any file in it" would
    // strand every chat in the old folder for good.
    withData(from);
    scaffolded(to);
    expect(planAdoption({ from, to })).toBe("adopt");
  });

  it("never overwrites a new folder that holds real data", () => {
    withData(from, "older");
    withData(to, "newer");
    expect(planAdoption({ from, to })).toBe("keep-new");
  });
});

describe("carrying the folder over", () => {
  it("moves everything, leaving nothing behind", () => {
    withData(from);
    write(path.join(from, "created_files"), "report.docx", "a file");
    write(from, "library.db", "the index");

    const result = adoptFolder({ from, to });

    expect(result.moved).toBe(3);
    expect(fs.readFileSync(path.join(to, MARKER), "utf8")).toBe("every chat ever");
    expect(fs.existsSync(path.join(to, "created_files", "report.docx"))).toBe(true);
    expect(fs.existsSync(from)).toBe(false);
  });

  it("moves the data in around the scaffolding already there", () => {
    withData(from);
    write(path.join(from, "created_files"), "report.docx", "a file");
    scaffolded(to);

    const result = adoptFolder({ from, to });

    expect(fs.readFileSync(path.join(to, MARKER), "utf8")).toBe("every chat ever");
    expect(fs.existsSync(path.join(to, "created_files", "report.docx"))).toBe(true);
    // The newer scaffolding is the app's current session; it stays, and it
    // shares no name with the data, so nothing has to be skipped.
    expect(fs.existsSync(path.join(to, "Preferences"))).toBe(true);
    expect(result.moved).toBe(2);
    expect(fs.existsSync(from)).toBe(false);
  });

  it("keeps the newer data when the app has already run under the new name", () => {
    withData(from, "older");
    withData(to, "newer");

    const result = adoptFolder({ from, to });

    expect(result.moved).toBe(0);
    expect(fs.readFileSync(path.join(to, MARKER), "utf8")).toBe("newer");
    // The old data is still there to be recovered by hand if it mattered.
    expect(fs.existsSync(path.join(from, MARKER))).toBe(true);
  });

  it("leaves the old folder alone when it still holds something", () => {
    withData(from, "older");
    write(from, "notes.txt", "keep me");
    write(to, "notes.txt", "mine");

    const result = adoptFolder({ from, to });

    expect(result.message).toContain("already existed");
    expect(fs.readFileSync(path.join(to, MARKER), "utf8")).toBe("older");
    expect(fs.readFileSync(path.join(to, "notes.txt"), "utf8")).toBe("mine");
    expect(fs.existsSync(path.join(from, "notes.txt"))).toBe(true);
  });

  it("says what it did, so the log records it", () => {
    withData(from);
    expect(adoptFolder({ from, to }).message).toContain(from);
  });

  it("says nothing when there was nothing to do", () => {
    expect(adoptFolder({ from, to }).message).toBeNull();
  });

  it("gives up quietly rather than stopping the app from starting", () => {
    withData(from);

    const broken = {
      existsSync: fs.existsSync,
      readdirSync: fs.readdirSync,
      mkdirSync: fs.mkdirSync,
      renameSync: () => {
        throw new Error("the folder is in use");
      },
    };

    const result = adoptFolder({ fs: broken, from, to });

    expect(result.moved).toBe(0);
    expect(result.message).toContain("in use");
    // The old data is untouched, so a later attempt can still find it.
    expect(fs.existsSync(path.join(from, MARKER))).toBe(true);
  });

  it("keeps what it managed to move when it fails part-way", () => {
    withData(from);
    write(from, "library.db", "the index");

    let calls = 0;
    const flaky = {
      existsSync: fs.existsSync,
      readdirSync: fs.readdirSync,
      mkdirSync: fs.mkdirSync,
      renameSync: (a, b) => {
        if (++calls > 1) throw new Error("interrupted");
        fs.renameSync(a, b);
      },
    };

    const result = adoptFolder({ fs: flaky, from, to });

    expect(result.moved).toBe(1);
    expect(result.message).toContain("only partly");
    expect(fs.readdirSync(to)).toHaveLength(1);
  });

  it("survives a folder it cannot even look at", () => {
    const blind = {
      existsSync: () => {
        throw new Error("permission denied");
      },
    };

    expect(() => adoptFolder({ fs: blind, from, to })).not.toThrow();
    expect(adoptFolder({ fs: blind, from, to }).moved).toBe(0);
  });
});

describe("the database the old name left behind", () => {
  /** A folder as the version before the rename left it. */
  const withLegacyData = (dir, body = "every chat ever") => {
    write(dir, LEGACY_MARKER, body);
    write(dir, `${LEGACY_MARKER}-wal`, "writes not yet checkpointed");
    write(dir, `${LEGACY_MARKER}-shm`, "shared memory index");
  };

  it("adopts a folder whose database still has the old name", () => {
    withLegacyData(from);
    expect(planAdoption({ from, to })).toBe("adopt");
  });

  it("carries the database over under the name the app now opens", () => {
    withLegacyData(from);
    adoptFolder({ from, to });

    expect(fs.readFileSync(path.join(to, MARKER), "utf8")).toBe("every chat ever");
    expect(fs.existsSync(path.join(to, LEGACY_MARKER))).toBe(false);
  });

  it("brings the write-ahead log with it, renamed to match", () => {
    // SQLite finds the -wal by the main file's name. Left behind under the old
    // one it is simply dropped, taking any uncheckpointed writes with it.
    withLegacyData(from);
    adoptFolder({ from, to });

    expect(fs.existsSync(path.join(to, `${MARKER}-wal`))).toBe(true);
    expect(fs.existsSync(path.join(to, `${MARKER}-shm`))).toBe(true);
    expect(fs.existsSync(path.join(to, `${LEGACY_MARKER}-wal`))).toBe(false);
  });

  it("leaves an old backup under the name it was filed as", () => {
    withLegacyData(from);
    write(from, `${LEGACY_MARKER}.backup-20260825`, "an archive, not a database");
    adoptFolder({ from, to });

    expect(fs.existsSync(path.join(to, `${LEGACY_MARKER}.backup-20260825`))).toBe(
      true,
    );
  });

  it("never lands on a current database that already exists", () => {
    withLegacyData(from, "older");
    withData(to, "newer");

    expect(planAdoption({ from, to })).toBe("keep-new");
    expect(adoptFolder({ from, to }).moved).toBe(0);
    expect(fs.readFileSync(path.join(to, MARKER), "utf8")).toBe("newer");
  });

  it("still ignores a folder the old version never stored anything in", () => {
    scaffolded(from);
    expect(planAdoption({ from, to })).toBe("none");
  });
});
