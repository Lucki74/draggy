// Runs the shared storage fixtures (shared/fixtures/storage/*.json) against electron/storage.cjs, the reference.
// core/crates/storage/tests/fixtures.rs reads the same files; a case must pass in both runners.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const storage = require("../../../electron/storage.cjs");
const legacy = require("../../../electron/fixtures/v1.2.7/storage.cjs");
const onboarding = require("../../../electron/onboarding.cjs");

const FIXTURES = fileURLToPath(new URL("../../../../shared/fixtures/storage/", import.meta.url));
const TEN_MINUTES = 10 * 60 * 1000;

interface Op {
  call: string;
  args?: unknown[];
}

interface DatabaseSpec {
  sql?: string[];
  file?: string;
  garbage?: string;
}

interface CaseInput {
  database?: DatabaseSpec;
  reader?: "legacy";
  ops?: Op[];
  fn?: string;
  args?: unknown[];
}

interface Chat {
  id: string;
  messages: { id: string; role: string; content?: unknown }[];
}

interface FixtureCase {
  name: string;
  input: CaseInput;
  expected: unknown;
}

interface FixtureFile {
  area: string;
  description: string;
  cases: FixtureCase[];
}

/** The subset of a storage module the runner calls. Both the current and the 1.2.7 module have it. */
interface StorageApi {
  init(dir: string): unknown;
  close(): void;
  [call: string]: unknown;
}

const files = fs
  .readdirSync(FIXTURES)
  .filter((name) => name.endsWith(".json"))
  .sort();

for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8")) as FixtureFile;

  describe(`storage fixtures: ${file}`, () => {
    for (const fixtureCase of fixture.cases) {
      it(fixtureCase.name, () => {
        expect(runCase(fixtureCase.input)).toEqual(matchers(fixtureCase.expected));
      });
    }
  });
}

function runCase(input: CaseInput): unknown {
  if (input.fn) return runPure(input.fn, input.args ?? []);

  const api: StorageApi = input.reader === "legacy" ? legacy : storage;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-storage-fixture-"));
  try {
    materialise(input.database, dir);
    api.init(dir);
    return runOps(api, dir, input.ops ?? []);
  } finally {
    api.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The onboarding decisions. A throw in the reference is recorded as `{ error }`, which the fixture expects. */
function runPure(fn: string, args: unknown[]): unknown {
  try {
    switch (fn) {
      case "planOnboarding":
        return onboarding.planOnboarding(args[0]);
      case "collectInputs":
        return onboarding.collectInputs(readers(args[0] as Record<string, unknown>));
      case "readRecord":
        return onboarding.readRecord(args[0]);
      case "recordOnStart":
        return onboarding.recordOnStart(args[0], new Date(args[1] as string));
      case "doneRecord":
        return onboarding.doneRecord(args[0], new Date(args[1] as string), args[2] ?? undefined);
      case "inProgressRecord":
        return onboarding.inProgressRecord(new Date(args[0] as string));
      default:
        throw new Error(`unknown fn ${fn}`);
    }
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/**
 * The reads a launch makes, as functions. A value is returned as it is; `{ "throws": message }` fails the read; an
 * absent key reads as undefined. The Rust runner maps the same spec onto its reader results.
 */
function readers(spec: Record<string, unknown>): Parameters<typeof onboarding.collectInputs>[0] {
  const reader = (key: string) => {
    if (!(key in spec)) return () => undefined;
    const value = spec[key];
    if (isThrow(value)) {
      return () => {
        throw new Error(value.throws);
      };
    }
    return () => value;
  };
  return {
    readRaw: reader("readRaw"),
    readSettings: reader("readSettings"),
    countModels: reader("countModels"),
    countChats: reader("countChats"),
    forced: Boolean(spec.forced),
  } as Parameters<typeof onboarding.collectInputs>[0];
}

function isThrow(value: unknown): value is { throws: string } {
  return value !== null && typeof value === "object" && !Array.isArray(value) && "throws" in value;
}

function materialise(database: DatabaseSpec | undefined, dir: string): void {
  if (!database) return;

  const target = path.join(dir, "draggy.db");
  if (database.sql) {
    const db = new DatabaseSync(target);
    try {
      db.exec(database.sql.join(";\n"));
    } finally {
      db.close();
    }
  }
  if (database.file) {
    fs.copyFileSync(path.join(FIXTURES, database.file), target);
    const blobs = path.join(FIXTURES, `${database.file.replace(/\.db$/, "")}-blobs`);
    if (fs.existsSync(blobs)) fs.cpSync(blobs, path.join(dir, "blobs"), { recursive: true });
  }
  if (database.garbage !== undefined) fs.writeFileSync(target, database.garbage);
}

/**
 * Runs the ops in order and returns each result. The pseudo-ops are the runner's own, shared with the Rust runner.
 * A storage call that throws is recorded as `{ "threw": true }`, the same way in both runners.
 */
function runOps(api: StorageApi, dir: string, ops: Op[]): unknown[] {
  return ops.map((entry) => {
    const args = entry.args ?? [];
    switch (entry.call) {
      case "reopen":
        api.close();
        api.init(dir);
        return null;
      case "close":
        api.close();
        return null;
      case "scribble": {
        const file = path.join(dir, "draggy.db");
        const bytes = fs.readFileSync(file);
        const from = args[0] as number;
        const to = Math.min(from + (args[1] as number), bytes.length);
        for (let i = from; i < to; i++) bytes[i] = args[2] as number;
        fs.writeFileSync(file, bytes);
        return null;
      }
      case "quarantined":
        return fs.readdirSync(dir).filter((name) => name.includes(".corrupt-")).length;
      case "payloadDepths":
        return (api.loadChats as () => Chat[])().map((chat) => ({
          id: chat.id,
          messages: chat.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            depth: depthOf(message),
          })),
        }));
      case "blobFiles":
        return listFiles(path.join(dir, "blobs"));
      case "deleteBlobFiles":
        fs.rmSync(path.join(dir, "blobs"), { recursive: true, force: true });
        fs.mkdirSync(path.join(dir, "blobs"));
        return null;
      case "sql": {
        const db = new DatabaseSync(path.join(dir, "draggy.db"));
        try {
          // Some Node 24 releases switch SQLite's defensive mode on, which refuses the DROP of a shadow table that
          // these cases use to damage the database on purpose.
          if (typeof db.enableDefensive === "function") db.enableDefensive(false);
          db.exec((args[0] as string[]).join(";\n"));
        } finally {
          db.close();
        }
        return null;
      }
      case "schema":
        return schemaDump(dir);
      case "query": {
        // Raw rows as stored, read on a second connection so the store stays open.
        const db = new DatabaseSync(path.join(dir, "draggy.db"), { readOnly: true });
        try {
          const statement = db.prepare(args[0] as string);
          statement.setReturnArrays(true);
          return statement.all();
        } finally {
          db.close();
        }
      }
      default:
        try {
          return (api[entry.call] as (...callArgs: unknown[]) => unknown)(...args);
        } catch {
          return { threw: true };
        }
    }
  });
}

/** Nesting depth of a JSON value: a scalar is zero, and an array or object is one more than its deepest child. */
function depthOf(value: unknown): number {
  if (value === null || typeof value !== "object") return 0;
  const children = Array.isArray(value) ? value : Object.values(value);
  return 1 + Math.max(0, ...children.map(depthOf));
}

/** Every file under a folder as a sorted path relative to it, with "/" separators. Empty when the folder is missing. */
function listFiles(root: string, prefix = ""): string[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? listFiles(path.join(root, entry.name), `${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`],
    )
    .sort();
}

/** `sqlite_master` with whitespace collapsed, and user_version. Read with a second connection, so the store stays open. */
function schemaDump(dir: string): unknown {
  const db = new DatabaseSync(path.join(dir, "draggy.db"), { readOnly: true });
  try {
    const rows = db
      .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name")
      .all() as { type: string; name: string; tbl_name: string; sql: string | null }[];
    const version = db.prepare("PRAGMA user_version").get() as { user_version: number };
    return {
      objects: rows.map((row) => ({
        type: row.type,
        name: row.name,
        tableName: row.tbl_name,
        sql: row.sql ? row.sql.replace(/\s+/g, " ").trim() : null,
      })),
      userVersion: version.user_version,
    };
  } finally {
    db.close();
  }
}

/**
 * `{"$any": "number"}` matches a finite number above zero, a stored timestamp the store did not leave at zero.
 * `{"$any": "now"}` matches a number within ten minutes of the clock, a timestamp the call set to now.
 */
function matchers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(matchers);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 1 && entries[0][0] === "$any") return stamp(entries[0][1]);
    return Object.fromEntries(entries.map(([key, item]) => [key, matchers(item)]));
  }
  return value;
}

function stamp(kind: unknown): unknown {
  const accept = kind === "now"
    ? (n: number) => Math.abs(n - Date.now()) <= TEN_MINUTES
    : kind === "number"
      ? (n: number) => n > 0
      : null;
  if (!accept) throw new Error(`unknown $any matcher ${String(kind)}`);
  return {
    asymmetricMatch: (actual: unknown) => typeof actual === "number" && Number.isFinite(actual) && accept(actual),
    toString: () => `$any ${String(kind)}`,
  };
}
