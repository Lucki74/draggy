// Golden fixtures for the agent logic: tool-call parsing, repetition, prompts and profiles, announcements, command
// rules and permissions. Each case calls the TypeScript reference. core/crates/agent/tests/fixtures.rs runs the same
// JSON through the Rust port, so both must agree.
// RUNNERS START
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TOOL_MARKER_OVERLAP,
  TOOL_MARKER_RE,
  createToolParser,
  extractFileStreamingArgs,
  extractThought,
  parseToolCall,
} from "../../toolParsing";
import { detectRepetition } from "../../agent/repetition";
import { announcesAction } from "../../agent/announcement";
import { commandCovered, commandGrantTargets, commandPrefix, commandSegments } from "../../agent/commandRules";
import {
  addGrant,
  decide,
  deniedByUser,
  grantCovers,
  grantsFor,
  refusalFor,
  targetFromArgs,
} from "../../agent/permissions";
import type { Grant, ToolAnnotations, Verdict } from "../../agent/permissions";
import { VOICE_SEARCH_MARKER, buildProjectPrompt, buildSystemPrompt, buildVoicePrompt, currentTimeNote } from "../../prompts";
import type { PromptMode } from "../../prompts";
import type { ProjectMemory } from "../../project/memory";
import { promptProfileFor } from "../../ai/providers";
import { registerTools, resetRegistry } from "../../tools/registry";
import type { ToolEnvironment, ToolSpec } from "../../tools/registry";
import type { AppSettings, InstalledSkill, PermissionMode, ProviderInstance, ProviderModel } from "../../types";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../../shared/fixtures/agent");

/** One fixture's input: plain JSON whose `op` names the function under test. */
type Fixture = { op: string; [field: string]: unknown };
type Golden = { area: string; description: string; cases: { name: string; input: Fixture; expected: unknown }[] };
type StubTool = { name: string; group: string; usage: string; required: string[] };

afterEach(() => {
  vi.restoreAllMocks();
  resetRegistry();
});

function text(input: Fixture, key: string): string {
  return input[key] as string;
}

/** A call read back the way the fixtures record it: `name` and `args`, each `null` when absent. */
function callOf(raw: string) {
  const parsed = parseToolCall(raw);
  return { name: parsed.name ?? null, args: parsed.args ?? null };
}

function runToolParsing(input: Fixture): unknown {
  const raw = text(input, "raw");
  switch (input.op) {
    case "detect":
      return createToolParser(input.names as string[]).detect(raw);
    case "detectParse": {
      const detected = createToolParser(input.names as string[]).detect(raw);
      return detected === null ? null : callOf(detected);
    }
    case "strip":
      return createToolParser(input.names as string[]).strip(raw);
    case "parse":
      return callOf(raw);
    case "thought":
      return extractThought(raw);
    case "markerIn":
      return TOOL_MARKER_RE.test(text(input, "text"));
    case "markerOverlap":
      return TOOL_MARKER_RE.test(text(input, "chunk").slice(-TOOL_MARKER_OVERLAP));
    case "markerAcross": {
      // The agent loop scans the text from the overlap before the new chunk, so a marker split at the boundary is seen.
      const first = text(input, "first");
      const scanFrom = Math.max(0, first.length - TOOL_MARKER_OVERLAP);
      return TOOL_MARKER_RE.test((first + text(input, "second")).slice(scanFrom));
    }
    case "markerOverlapWidth":
      return TOOL_MARKER_OVERLAP;
    case "fileArgs": {
      const args = extractFileStreamingArgs(raw);
      return { filename: args.filename ?? null, content: args.content ?? null };
    }
    default:
      throw new Error(`unknown toolParsing op ${input.op}`);
  }
}

function runRepetition(input: Fixture): unknown {
  const source = text(input, "text");
  if (input.op === "prefixLoops") {
    // Every code-point prefix of a streamed reply goes through the check. Rust walks the same points, since a
    // string there cannot end inside a surrogate pair.
    const flags: boolean[] = [];
    let end = 0;
    for (const character of source) {
      end += character.length;
      flags.push(detectRepetition(source.slice(0, end)).hasLoop);
    }
    return flags;
  }
  const result = detectRepetition(source);
  return {
    hasLoop: result.hasLoop,
    pattern: result.pattern ?? null,
    repeatCount: result.repeatCount ?? null,
    trimmedText: result.trimmedText,
  };
}

function runCommandRules(input: Fixture): unknown {
  switch (input.op) {
    case "segments":
      return commandSegments(input.command as string | null);
    case "prefix":
      return commandPrefix(text(input, "segment"));
    case "targets":
      return commandGrantTargets(input.command as string | null);
    case "covered":
      return commandCovered(input.allowed as string[], input.command as string | null);
    default:
      throw new Error(`unknown commandRules op ${input.op}`);
  }
}

function runPermissions(input: Fixture): unknown {
  const tool = text(input, "tool");
  switch (input.op) {
    case "decide": {
      const verdict = decide({
        mode: input.mode as PermissionMode,
        tool,
        annotations: (input.annotations ?? {}) as ToolAnnotations,
        target: (input.target ?? null) as string | null,
        grants: (input.grants ?? []) as Grant[],
      });
      return { decision: verdict.decision, reason: verdict.reason };
    }
    case "grantCovers":
      return grantCovers(input.grant as Grant, tool, (input.target ?? null) as string | null);
    case "addGrant":
      return addGrant(input.grants as Grant[], input.grant as Grant);
    case "grantsFor":
      return grantsFor(tool, (input.target ?? null) as string | null, (input.annotations ?? {}) as ToolAnnotations);
    case "targetFromArgs":
      return targetFromArgs(input.args as Record<string, unknown>);
    case "refusal":
      return refusalFor(tool, input.verdict as Verdict);
    case "denied":
      return deniedByUser(tool);
    default:
      throw new Error(`unknown permissions op ${input.op}`);
  }
}

/** Registers the turn's tools as bare stubs, so `availableTools` returns exactly the list the fixture records. */
function stubTools(tools: StubTool[]): void {
  resetRegistry();
  registerTools(tools.map((tool) => ({ ...tool, description: "", parameters: {}, run: async () => "" }) as unknown as ToolSpec));
}

function runSystem(input: Fixture): string {
  stubTools(input.tools as StubTool[]);
  const date = vi.spyOn(Date.prototype, "toLocaleDateString").mockReturnValue(text(input, "date"));
  try {
    return buildSystemPrompt(
      input.settings as AppSettings,
      input.mode as PromptMode,
      input.environment as ToolEnvironment,
      (input.memory ?? null) as ProjectMemory | null,
      (input.skills ?? []) as InstalledSkill[],
    );
  } finally {
    date.mockRestore();
    resetRegistry();
  }
}

function runPrompts(input: Fixture): unknown {
  switch (input.op) {
    case "system":
      return runSystem(input);
    case "time": {
      const time = vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue(text(input, "time"));
      try {
        return currentTimeNote();
      } finally {
        time.mockRestore();
      }
    }
    case "project":
      return buildProjectPrompt(text(input, "root"));
    case "voice":
      return buildVoicePrompt(input.searchEnabled as boolean, input.cues as string[]);
    case "voiceSearch":
      return text(input, "text").split("\n")[0].match(VOICE_SEARCH_MARKER)?.[1] ?? null;
    default:
      throw new Error(`unknown prompts op ${input.op}`);
  }
}

function runProfile(input: Fixture): unknown {
  return promptProfileFor(
    text(input, "model"),
    (input.instance ?? null) as Pick<ProviderInstance, "kind" | "promptProfile"> | null,
    (input.listed ?? null) as Pick<ProviderModel, "id" | "contextLength"> | null,
  );
}

function run(file: string, input: Fixture): unknown {
  switch (file) {
    case "toolParsing":
      return runToolParsing(input);
    case "repetition":
      return runRepetition(input);
    case "announcement":
      return announcesAction(text(input, "text"));
    case "commandRules":
      return runCommandRules(input);
    case "permissions":
      return runPermissions(input);
    case "prompts":
      return runPrompts(input);
    case "promptProfile":
      return runProfile(input);
    default:
      throw new Error(`no runner for ${file}`);
  }
}

for (const file of fs.readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".json")).sort()) {
  const golden = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as Golden;
  describe(`agent fixtures: ${golden.area}/${file}`, () => {
    for (const fixture of golden.cases) {
      it(fixture.name, () => {
        expect(run(file.replace(/\.json$/, ""), fixture.input)).toEqual(fixture.expected);
      });
    }
  });
}
