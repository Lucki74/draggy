// Golden fixtures for the file, git and skill tools. Each case calls the Electron reference (electron/fsGuard.cjs,
// electron/fileOps.cjs, electron/checkpoints.cjs, electron/git.cjs, electron/skills.cjs) and checks what it returns.
// core/crates/tools/tests/fixtures_files.rs runs the same inputs against the Rust port, so both must agree.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../shared/fixtures/tools");

const guard = require("../../../electron/fsGuard.cjs") as {
  isDeniedName: (name: string) => boolean;
  isReadable: (target: string) => boolean;
  readText: (file: string, limit?: number) => unknown;
  resolveWithin: (roots: string[], requested: string | undefined, options: Record<string, boolean>) => unknown;
  setProtectedPaths: (paths: string[]) => void;
};
const fileOperations = require("../../../electron/fileOps.cjs") as {
  create: (deps: Record<string, unknown>) => Record<string, (...args: unknown[]) => unknown>;
};
const checkpoints = require("../../../electron/checkpoints.cjs") as {
  init: (userData: string) => string;
  keep: (contents: string) => string;
};
const gitTools = require("../../../electron/git.cjs") as {
  createGit: (deps: { run: (args: string[], cwd: string) => Promise<unknown> }) => {
    status: (root: string) => Promise<unknown>;
    diff: (root: string, options: Record<string, unknown>) => Promise<unknown>;
  };
  parseStatus: (output: string, prefix: string) => unknown;
  countChanges: (files: unknown[]) => unknown;
  toPathspec: (root: string, absolute: string) => string | null;
};
const logger = require("../../../electron/logger.cjs").log as Record<"info" | "warn" | "fail", (...parts: unknown[]) => unknown>;
const skills = require("../../../electron/skills.cjs") as {
  LIBRARY_ROOT: string;
  init: (userData: string, options: { libraryRoot: string }) => unknown;
  listSkills: (projectRoot: string | undefined, overrides: Record<string, boolean>) => unknown;
  readSkill: (id: string, projectRoot: string | undefined, options: Record<string, unknown>) => unknown;
  parseSkill: (text: string) => unknown;
  summarize: (description: string) => string;
};

// RUNNERS START
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Text built from a head, a fill repeated count times, and a tail, as a long output is. */
type Clip = { head: string; fill: string; count: number; tail: string };

/** The files, byte files, folders and links a case creates under its temp folder. `sized` files are zero bytes of that
 * length (sparse), `long` files are text built from a Clip, and `numbered` folders hold count empty files named stem+index. */
type Tree = {
  files?: Record<string, string>;
  bytes?: Record<string, number[]>;
  dirs?: string[];
  links?: Record<string, string>;
  sized?: Record<string, number>;
  long?: Record<string, Clip>;
  numbered?: Record<string, { count: number; stem: string }>;
};

/** Replaces {base} in every string of a fixture value with the case's temp folder. */
function fill(value: Json, base: string): Json {
  if (typeof value === "string") return value.replaceAll("{base}", base);
  if (Array.isArray(value)) return value.map((item) => fill(item, base));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item, base)]));
  }
  return value;
}

/** Puts the temp folder back as {base} in every string of a result, so paths compare across machines. */
function unfill(value: unknown, base: string): unknown {
  if (typeof value === "string") return value.split(base).join("{base}");
  if (Array.isArray(value)) return value.map((item) => unfill(item, base));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unfill(item, base)]));
  }
  return value;
}

/** Runs one case in a fresh temp folder. The result is plain JSON, so undefined fields drop out as they do in the fixture. */
async function inCase(raw: unknown, run: (input: never, base: string) => unknown): Promise<unknown> {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "draggy-fixture-")));
  try {
    const result = await run(fill(raw as Json, base) as never, base);
    return JSON.parse(JSON.stringify(unfill(result, base)));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

function writeFile(base: string, rel: string, data: Buffer): void {
  const file = path.join(base, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

function makeTree(base: string, tree: Tree | undefined): void {
  for (const dir of tree?.dirs ?? []) fs.mkdirSync(path.join(base, dir), { recursive: true });
  for (const [rel, text] of Object.entries(tree?.files ?? {})) writeFile(base, rel, Buffer.from(text, "utf8"));
  for (const [rel, bytes] of Object.entries(tree?.bytes ?? {})) writeFile(base, rel, Buffer.from(bytes));
  for (const [rel, target] of Object.entries(tree?.links ?? {})) {
    const link = path.join(base, rel);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link);
  }
  for (const [rel, length] of Object.entries(tree?.sized ?? {})) {
    writeFile(base, rel, Buffer.alloc(0));
    fs.truncateSync(path.join(base, rel), length);
  }
  for (const [rel, clip] of Object.entries(tree?.long ?? {})) {
    writeFile(base, rel, Buffer.from(clip.head + clip.fill.repeat(clip.count) + clip.tail, "utf8"));
  }
  for (const [dir, { count, stem }] of Object.entries(tree?.numbered ?? {})) {
    fs.mkdirSync(path.join(base, dir), { recursive: true });
    for (let index = 0; index < count; index++) {
      writeFile(base, `${dir}/${stem}${String(index).padStart(4, "0")}.txt`, Buffer.alloc(0));
    }
  }
}

type GuardCase = {
  tree: Tree;
  roots: string[];
  requested: string;
  options?: Record<string, boolean>;
  protected?: string[];
};

function resolveCase(input: GuardCase, base: string): unknown {
  makeTree(base, input.tree);
  guard.setProtectedPaths(input.protected ?? []);
  try {
    return guard.resolveWithin(input.roots, input.requested, input.options ?? {});
  } finally {
    guard.setProtectedPaths([]);
  }
}

function readTextCase(input: { tree: Tree; file: string; limit?: number }, base: string): unknown {
  makeTree(base, input.tree);
  return guard.readText(input.file, input.limit);
}

function readableCase(input: { path: string; protected: string[] }): boolean {
  guard.setProtectedPaths(input.protected);
  try {
    return guard.isReadable(input.path);
  } finally {
    guard.setProtectedPaths([]);
  }
}

function hashCase(input: { text: string }, base: string): string {
  checkpoints.init(path.join(base, "userdata"));
  return checkpoints.keep(input.text);
}

/** Files longer than this are listed in a case's state by their length, so a large file does not bloat the fixture. */
const STATE_TEXT_BYTES = 4096;

type Step = {
  call: "list" | "read" | "search" | "locate" | "write" | "edit" | "move" | "remove" | "revert" | "close" | "lose_version";
  workspace?: string;
  path?: string;
  from?: string;
  to?: string;
  contents?: string;
  find?: string;
  replace?: string;
  expected?: number;
  chat?: string;
  name?: string;
  text?: string;
  limit?: number | null;
  countOnly?: boolean;
  undo?: number;
  id?: number;
};

/** What a step can change beyond the folder: the workspaces still in reach, and the stored earlier versions. */
type StepEnv = { open: Set<string>; loseVersion: (id: number) => void };

/** A log line a case records: its level, its message, and the data without the null fields. */
type Line = { level: string; message: string; data: Record<string, unknown> };

/** The shape a case's outcome takes, so both ports answer with the same keys. */
type Outcome = { success: boolean; error?: string; [key: string]: unknown };

function refusal(result: { error?: unknown }): Outcome {
  return { success: false, error: String(result.error) };
}

async function runStep(
  ops: Record<string, (...args: unknown[]) => unknown>,
  step: Step,
  ids: (number | undefined)[],
  env: StepEnv,
): Promise<{ outcome: Outcome; checkpointId?: number }> {
  const workspace = step.workspace ?? "w1";
  switch (step.call) {
    case "list": {
      const result = ops.list(workspace, step.path) as { success: boolean; entries?: unknown[]; truncated?: boolean } & { error?: string };
      if (!result.success) return { outcome: refusal(result) };
      const entries = (result.entries as { name: string; isDirectory: boolean; size: number }[]).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory,
        size: entry.size,
      }));
      return { outcome: { success: true, entries, truncated: result.truncated === true } };
    }
    case "read": {
      const result = (await ops.read(workspace, step.path)) as Record<string, unknown>;
      if (!result.success) return { outcome: refusal(result as { error?: unknown }) };
      const kind = result.isMedia ? "media" : result.isImage ? "image" : "text";
      return {
        outcome: {
          success: true,
          kind,
          mime: (result.mime as string | undefined) ?? null,
          dataUrl: (result.dataUrl as string | undefined) ?? null,
          text: (result.text as string | undefined) ?? "",
          bytes: result.bytes as number,
        },
      };
    }
    case "search": {
      const result = (await ops.search(workspace, { name: step.name, text: step.text, limit: step.limit })) as Record<string, unknown>;
      if (!result.success) return { outcome: refusal(result as { error?: unknown }) };
      const hits = (result.hits as { path: string; name: string; line?: number; text?: string }[])
        .map((hit) => ({ path: hit.path, name: hit.name, line: hit.line, text: hit.text }))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : (a.line ?? 0) - (b.line ?? 0)));
      // A case about how many hits a limit allows counts them; the hits themselves depend on folder order.
      if (step.countOnly) return { outcome: { success: true, count: hits.length, truncated: result.truncated === true } };
      return { outcome: { success: true, hits, truncated: result.truncated === true } };
    }
    case "locate": {
      const result = (await ops.locate(workspace, step.path)) as Record<string, unknown>;
      return result.success ? { outcome: { success: true, path: result.path as string } } : { outcome: refusal(result as { error?: unknown }) };
    }
    case "write": {
      const result = (await ops.write(workspace, step.path, step.contents, step.chat)) as Record<string, unknown>;
      if (!result.success) return { outcome: refusal(result as { error?: unknown }) };
      return {
        outcome: { success: true, path: result.path, created: result.created, bytes: result.bytes, checkpointId: result.checkpointId },
        checkpointId: result.checkpointId as number,
      };
    }
    case "edit": {
      const result = (await ops.edit(workspace, step.path, step.find, step.replace, step.expected ?? 0, step.chat)) as Record<string, unknown>;
      if (!result.success) return { outcome: refusal(result as { error?: unknown }) };
      return {
        outcome: {
          success: true,
          path: result.path,
          checkpointId: result.checkpointId,
          replaced: result.replaced,
          before: result.before,
          after: result.after,
          bytes: result.bytes,
        },
        checkpointId: result.checkpointId as number,
      };
    }
    case "move": {
      const result = (await ops.move(workspace, step.from, step.to, step.chat)) as Record<string, unknown>;
      if (!result.success) return { outcome: refusal(result as { error?: unknown }) };
      return {
        outcome: { success: true, path: result.path, from: result.from, checkpointId: result.checkpointId },
        checkpointId: result.checkpointId as number,
      };
    }
    case "remove": {
      const result = (await ops.remove(workspace, step.path, step.chat)) as Record<string, unknown>;
      if (!result.success) return { outcome: refusal(result as { error?: unknown }) };
      return {
        outcome: { success: true, path: result.path, checkpointId: result.checkpointId },
        checkpointId: result.checkpointId as number,
      };
    }
    case "revert": {
      const id = step.id ?? ids[step.undo ?? -1];
      const result = (await ops.revert(id)) as Record<string, unknown>;
      if (!result.success) return { outcome: refusal(result as { error?: unknown }) };
      return {
        outcome: {
          success: true,
          path: result.path,
          from: (result.from as string | undefined) ?? null,
          workspaceId: (result.workspaceId as string | undefined) ?? null,
        },
      };
    }
    case "close": {
      env.open.delete(workspace);
      return { outcome: { success: true } };
    }
    case "lose_version": {
      env.loseVersion(step.id ?? ids[step.undo ?? -1] ?? -1);
      return { outcome: { success: true } };
    }
  }
}

/** Text a clip describes: its head, its fill repeated count times, then its tail. */
function clipText(clip: Clip): string {
  return clip.head + clip.fill.repeat(clip.count) + clip.tail;
}

/** The lines a case is checked for, by scope: the file tools, git's failures, and the skill layer's installs and switches. */
const LOGGED = new Map<string, Set<string>>([
  ["files", new Set(["file op done", "file op refused", "file op failed", "checkpoint created", "checkpoint restored"])],
  ["files.git", new Set(["status failed", "diff failed", "diff list failed"])],
  ["skills", new Set(["skill installed", "skill removed", "enabled skills changed"])],
]);

/** Records the INFO, WARN and ERROR lines a case is checked for. The reference passes an error as its own argument, which is not recorded. Returns the function that puts logging back. */
function captureLines(into: Line[]): () => void {
  const saved = { info: logger.info, warn: logger.warn, fail: logger.fail };
  const keep = (scope: unknown, message: unknown): boolean => LOGGED.get(String(scope))?.has(String(message)) === true;
  const record = (level: string, message: unknown, data: unknown) => {
    const fields = Object.entries((data ?? {}) as Record<string, unknown>).filter(([, value]) => value !== null && value !== undefined);
    into.push({ level, message: String(message), data: Object.fromEntries(fields) });
  };
  logger.info = (scope, message, data) => {
    if (keep(scope, message)) record("info", message, data);
  };
  logger.warn = (scope, message, data) => {
    if (keep(scope, message)) record("warn", message, data);
  };
  logger.fail = (scope, message, _error, data) => {
    if (keep(scope, message)) record("error", message, data);
  };
  return () => {
    logger.info = saved.info;
    logger.warn = saved.warn;
    logger.fail = saved.fail;
  };
}

/** Ordered file operations against a fresh project folder, with an in-memory checkpoint store. */
async function opsCase(input: { tree: Tree; ops: Step[]; state?: boolean; logs?: boolean }, base: string): Promise<unknown> {
  const project = path.join(base, "project");
  fs.mkdirSync(project, { recursive: true });
  makeTree(base, input.tree);
  checkpoints.init(path.join(base, "userdata"));
  guard.setProtectedPaths([]);

  const rows = new Map<number, Record<string, unknown>>();
  let nextId = 1;
  const storage = {
    addCheckpoint: (entry: Record<string, unknown>) => {
      const id = nextId++;
      rows.set(id, { ...entry, id, detail: entry.detail ?? null });
      return { success: true, id };
    },
    getCheckpoint: (id: number) => rows.get(Number(id)) || null,
    dropCheckpoint: (id: number) => {
      rows.delete(Number(id));
      return { success: true };
    },
  };
  const open = new Set(["w1"]);
  const ops = fileOperations.create({
    roots: (workspaceId: string) => (open.has(workspaceId) ? [project] : []),
    storage,
    checkpoints,
    trash: async (target: string) => {
      fs.rmSync(target, { force: true });
    },
  });

  const results: Outcome[] = [];
  const ids: (number | undefined)[] = [];
  const lines: Line[] = [];
  const restore = input.logs ? captureLines(lines) : () => {};
  const env: StepEnv = {
    open,
    loseVersion: (id) => {
      const hash = rows.get(Number(id))?.beforeHash;
      if (typeof hash === "string" && hash) {
        fs.rmSync(path.join(base, "userdata", "checkpoints", hash.slice(0, 2), hash), { force: true });
      }
    },
  };
  try {
    for (const step of input.ops) {
      try {
        const { outcome, checkpointId } = await runStep(ops, step, ids, env);
        results.push(outcome);
        ids.push(checkpointId);
      } catch {
        // An operation that throws is an error to the caller; the case records that it threw.
        results.push({ success: false, thrown: true });
        ids.push(undefined);
      }
    }
  } finally {
    restore();
  }
  const logged = input.logs ? { logs: lines } : {};

  if (input.state === false) return { results, ...logged };
  const state: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const data = fs.readFileSync(full);
      const text = data.length > STATE_TEXT_BYTES ? `${data.length} bytes` : data.toString("utf8");
      state[path.relative(project, full).split(path.sep).join("/")] = text;
    }
  };
  walk(project);
  return { results, state, ...logged };
}

/** Parses a porcelain listing given as tokens, joined with NUL the way git writes them. */
function porcelainCase(input: { tokens: string[]; prefix: string }): unknown {
  return gitTools.parseStatus(input.tokens.join("\0"), input.prefix);
}

const SUBCOMMANDS = ["--version", "rev-parse", "config", "status", "diff"];

type ScriptedResponse = { code?: number; stdout?: string | Clip; tokens?: string[]; stderr?: string; missing?: boolean };

/** A git stand-in that answers from the case's responses and records every argv it was given, in order. */
function scriptedRun(responses: Record<string, ScriptedResponse>, calls: string[]) {
  return async (args: string[]): Promise<unknown> => {
    calls.push(args.join(" "));
    const sub = args.find((arg) => SUBCOMMANDS.includes(arg));
    const key = sub === "diff" && args.includes("--name-only") ? "diff --name-only" : sub;
    const response: ScriptedResponse =
      (key !== undefined ? responses[key] : undefined) ?? (sub !== undefined ? responses[sub] : undefined) ?? {};
    return {
      code: response.code ?? 0,
      stdout: response.tokens
        ? response.tokens.map((token) => `${token}\0`).join("")
        : typeof response.stdout === "object"
          ? clipText(response.stdout)
          : (response.stdout ?? ""),
      stderr: response.stderr ?? "",
      missing: response.missing ?? false,
    };
  };
}

async function statusCase(input: { responses: Record<string, ScriptedResponse>; root: string; logs?: boolean }): Promise<unknown> {
  const calls: string[] = [];
  const lines: Line[] = [];
  const restore = input.logs ? captureLines(lines) : () => {};
  try {
    const git = gitTools.createGit({ run: scriptedRun(input.responses, calls) });
    const result = await git.status(input.root);
    return { result, calls, logs: input.logs ? lines : undefined };
  } finally {
    restore();
  }
}

async function diffCase(input: {
  responses: Record<string, ScriptedResponse>;
  root: string;
  relative?: string;
  staged?: boolean;
  denied?: string[];
  logs?: boolean;
}): Promise<unknown> {
  const calls: string[] = [];
  const lines: Line[] = [];
  const restore = input.logs ? captureLines(lines) : () => {};
  try {
    const git = gitTools.createGit({ run: scriptedRun(input.responses, calls) });
    const denied = input.denied ?? [];
    const result = await git.diff(input.root, {
      relative: input.relative,
      staged: input.staged ?? false,
      allow: (absolute: string) => !denied.includes(path.relative(input.root, absolute)),
    });
    return { result, calls, logs: input.logs ? lines : undefined };
  } finally {
    restore();
  }
}

function listCase(input: { tree: Tree; project: boolean; overrides: Record<string, boolean> }, base: string): unknown {
  makeTree(base, input.tree);
  skills.init(path.join(base, "userdata"), { libraryRoot: path.join(base, "library") });
  return skills.listSkills(input.project ? path.join(base, "project") : undefined, input.overrides);
}

function readCase(
  input: { tree: Tree; project: boolean; id: string; overrides: Record<string, boolean>; enabledOnly: boolean; file: string | null },
  base: string,
): unknown {
  makeTree(base, input.tree);
  skills.init(path.join(base, "userdata"), { libraryRoot: path.join(base, "library") });
  return skills.readSkill(input.id, input.project ? path.join(base, "project") : undefined, {
    overrides: input.overrides,
    enabledOnly: input.enabledOnly,
    file: input.file,
  });
}

type SkillStep =
  | { call: "list"; overrides?: Record<string, boolean> }
  | { call: "install"; id: string; text: string }
  | { call: "remove"; id: string };

/** Ordered skill listings, installs and removals in a fresh user folder. The first step sets the baseline, so its lines
 * are not checked: the reference keeps its last listing across cases. Expected: {results, logs}. */
function skillsLogCase(input: { steps: SkillStep[] }, base: string): unknown {
  skills.init(path.join(base, "userdata"), { libraryRoot: path.join(base, "library") });
  const lines: Line[] = [];
  const restore = captureLines(lines);
  const results: unknown[] = [];
  try {
    input.steps.forEach((step, index) => {
      if (step.call === "install") {
        writeFile(base, `userdata/skills/${step.id}/SKILL.md`, Buffer.from(step.text, "utf8"));
        results.push({ success: true });
      } else if (step.call === "remove") {
        fs.rmSync(path.join(base, "userdata", "skills", step.id), { recursive: true, force: true });
        results.push({ success: true });
      } else {
        const listing = skills.listSkills(undefined, step.overrides ?? {}) as { id: string; enabled: boolean }[];
        results.push({ skills: listing.map((skill) => ({ id: skill.id, enabled: skill.enabled })) });
      }
      if (index === 0) lines.length = 0;
    });
  } finally {
    restore();
  }
  return { results, logs: lines };
}

/** The skills the shipped library lists, as the app lists them. Folder paths are left out: they differ per machine. */
function libraryCase(base: string): unknown {
  skills.init(path.join(base, "userdata"), { libraryRoot: skills.LIBRARY_ROOT });
  const listing = skills.listSkills(undefined, {}) as Record<string, unknown>[];
  return listing.map((entry) => Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "path")));
}

const RUNNERS: Record<string, (input: never, base: string) => unknown> = {
  "skills-library.json": (_input, base) => libraryCase(base),
  "files-search.json": (input, base) => opsCase(input as never, base),
  "files-revert.json": (input, base) => opsCase(input as never, base),
  "files-logs.json": (input, base) => opsCase(input as never, base),
  "skills-files.json": (input, base) => readCase(input as never, base),
  "skills-log.json": (input, base) => skillsLogCase(input as never, base),
  "files-guard.json": (input, base) => resolveCase(input as GuardCase, base),
  "files-read-text.json": (input, base) => readTextCase(input as never, base),
  "files-denied-names.json": (input) => guard.isDeniedName((input as { name: string }).name),
  "files-readable.json": (input) => readableCase(input as never),
  "files-checkpoint-hash.json": (input, base) => hashCase(input as never, base),
  "files-ops.json": (input, base) => opsCase(input as never, base),
  "git-porcelain.json": (input) => porcelainCase(input as never),
  "git-counts.json": (input) => gitTools.countChanges((input as { files: unknown[] }).files),
  "git-pathspec.json": (input) => {
    const { root, absolute } = input as { root: string; absolute: string };
    return gitTools.toPathspec(root, absolute);
  },
  "git-status.json": (input) => statusCase(input as never),
  "git-diff.json": (input) => diffCase(input as never),
  "skills-frontmatter.json": (input) => skills.parseSkill((input as { text: string }).text),
  "skills-summary.json": (input) => skills.summarize((input as { description: string }).description),
  "skills-list.json": (input, base) => listCase(input as never, base),
  "skills-read.json": (input, base) => readCase(input as never, base),
  "files-collation.json": (input) => {
    const { a, b } = input as { a: string; b: string };
    return Math.sign(a.localeCompare(b, "en"));
  },
};
// RUNNERS END

describe("tools file, git and skill fixtures", () => {
  const names = fs
    .readdirSync(FIXTURE_DIR)
    .filter((name) => /^(files|git|skills)-.*\.json$/.test(name))
    .sort();
  for (const file of names) {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as {
      cases: { name: string; input: unknown; expected: unknown }[];
    };
    describe(file, () => {
      for (const testCase of fixture.cases) {
        it(testCase.name, async () => {
          const runner = RUNNERS[file];
          if (!runner) throw new Error(`no runner for ${file}`);
          expect(await inCase(testCase.input, runner)).toEqual(testCase.expected);
        });
      }
    });
  }
});
