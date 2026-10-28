// Golden fixtures for the background-task text rules. Each case calls the Electron reference (electron/taskText.cjs)
// and checks what it returns. core/crates/tools/tests/fixtures_tasks.rs runs the same inputs against the Rust port,
// so both must agree.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../../shared/fixtures/tools");

const text = require("../../../electron/taskText.cjs") as {
  cleanOutput: (raw: string) => string;
  clipWithPointer: (raw: string, taskId: string | null) => { text: string; truncated: boolean };
  sliceSince: (raw: string, since: number) => { text: string; next: number };
  tailLines: (raw: string, count: number) => string;
  grepLines: (raw: string, pattern: string, limit?: number) => { text?: string; matches?: number; error?: string };
  supportsState: (shell: string) => boolean;
  stateEpilogue: (shell: string, marker: string) => string | null;
  parseState: (output: string, marker: string) => { output: string; state: unknown };
  envDiff: (before: Record<string, string>, after: Record<string, string>) => { set: Record<string, string>; unset: string[] };
  applyEnvDiff: (base: Record<string, string>, diff: { set: Record<string, string>; unset: string[] }) => Record<string, string>;
};

type Clip = { head: string; fill: string; count: number; tail: string; taskId: string | null };
type Read = { op: "since" | "tail" | "grep"; raw: string; since?: number | null; count?: number; pattern?: string; limit?: number };
type State = {
  op: "supports" | "epilogue" | "parse" | "diff" | "apply";
  shell?: string;
  marker?: string;
  output?: string;
  before?: Record<string, string>;
  after?: Record<string, string>;
  base?: Record<string, string>;
  diff?: { set: Record<string, string>; unset: string[] };
};

function read(input: Read): unknown {
  if (input.op === "since") return text.sliceSince(input.raw, input.since === null ? Number.NaN : (input.since as number));
  if (input.op === "tail") return { text: text.tailLines(input.raw, input.count as number) };
  const result = text.grepLines(input.raw, input.pattern as string, input.limit ?? 200);
  return result.error ? { error: result.error } : result;
}

function state(input: State): unknown {
  if (input.op === "supports") return { supported: text.supportsState(input.shell as string) };
  if (input.op === "epilogue") return { text: text.stateEpilogue(input.shell as string, input.marker as string) };
  if (input.op === "diff") return text.envDiff(input.before as Record<string, string>, input.after as Record<string, string>);
  if (input.op === "apply") return text.applyEnvDiff(input.base as Record<string, string>, input.diff as { set: Record<string, string>; unset: string[] });
  return text.parseState(input.output as string, input.marker as string);
}

const RUNNERS: Record<string, (input: unknown) => unknown> = {
  "task-clean.json": (input) => text.cleanOutput(input as string),
  "task-clip.json": (input) => {
    const clip = input as Clip;
    return text.clipWithPointer(clip.head + clip.fill.repeat(clip.count) + clip.tail, clip.taskId);
  },
  "task-read.json": (input) => read(input as Read),
  "task-state.json": (input) => state(input as State),
};

describe("tools task fixtures", () => {
  for (const file of fs.readdirSync(FIXTURE_DIR).filter((name) => /^task-.*\.json$/.test(name)).sort()) {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as {
      cases: { name: string; input: unknown; expected: unknown }[];
    };
    describe(file, () => {
      for (const testCase of fixture.cases) {
        it(testCase.name, () => {
          const runner = RUNNERS[file];
          if (!runner) throw new Error(`no runner for ${file}`);
          expect(runner(testCase.input)).toEqual(testCase.expected);
        });
      }
    });
  }
});
