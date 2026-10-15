// Golden fixtures for the shell tool's pure helpers. Each case calls the Electron reference (electron/commands.cjs,
// electron/platform.cjs) and checks what it returns. core/crates/tools/tests/fixtures_shell.rs runs the same inputs
// against the Rust port, so both must agree.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../shared/fixtures/tools");

const commands = require("../../../electron/commands.cjs") as {
  shellInvocation: (command: string, requested: string | undefined, options: Record<string, unknown>) => Record<string, unknown>;
  clip: (text: string) => { text: string; truncated: boolean };
  timeoutFor: (value: unknown) => number;
};
const platform = require("../../../electron/platform.cjs") as { defaultShellEnv: () => Record<string, string | undefined> };

type Invocation = {
  command: string;
  shell: string | null;
  env?: Record<string, string>;
  existing?: string[];
  installed?: Record<string, string>;
};
type Clip = { head: string; fill: string; count: number; tail: string };

// RUNNERS START
/** shellInvocation with the platform, environment and lookups fixed by the case, as the fixture describes them. */
function shellInvocation(input: Invocation): unknown {
  const result = commands.shellInvocation(input.command, input.shell ?? undefined, {
    platform: "linux",
    env: input.env ?? {},
    exists: (candidate: string) => (input.existing ?? []).includes(candidate),
    find: (name: string) => input.installed?.[name] ?? null,
  });
  return result.error !== undefined ? { error: result.error } : result;
}

/** The output a case describes: its head, the fill repeated, and its tail. */
function longText(input: Clip): string {
  return input.head + input.fill.repeat(input.count) + input.tail;
}

/** defaultShellEnv's PATH with the process PATH set to the case's value (null for unset), then restored. */
function defaultPath(current: string | null): string {
  const saved = process.env.PATH;
  try {
    if (current === null) delete process.env.PATH;
    else process.env.PATH = current;
    return String(platform.defaultShellEnv().PATH);
  } finally {
    if (saved === undefined) delete process.env.PATH;
    else process.env.PATH = saved;
  }
}

const RUNNERS: Record<string, (input: unknown) => unknown> = {
  "shell-invocation.json": (input) => shellInvocation(input as Invocation),
  "shell-clip.json": (input) => commands.clip(longText(input as Clip)),
  "shell-timeout.json": (input) => commands.timeoutFor(input === null ? undefined : input),
  "shell-env.json": (input) => ({ PATH: defaultPath((input as { PATH: string | null }).PATH) }),
};
// RUNNERS END

describe("tools shell fixtures", () => {
  for (const file of fs.readdirSync(FIXTURE_DIR).filter((name) => /^shell-.*\.json$/.test(name)).sort()) {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as {
      cases: { name: string; input: unknown; expected: unknown }[];
    };
    describe(file, () => {
      for (const testCase of fixture.cases) {
        // The Homebrew and /usr/local additions are for POSIX shells; a Windows host keeps its PATH as it is.
        it.skipIf(process.platform === "win32" && file === "shell-env.json")(testCase.name, () => {
          const runner = RUNNERS[file];
          if (!runner) throw new Error(`no runner for ${file}`);
          expect(runner(testCase.input)).toEqual(testCase.expected);
        });
      }
    });
  }
});
