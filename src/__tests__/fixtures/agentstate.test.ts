// Golden fixtures for the agent state machines: compaction, context breakdown, resume, subagent, tool channel, live
// turns and the task manager. Each case is driven through the TypeScript reference below. core/crates/agent/tests/
// agentstate.rs runs the same JSON through the Rust port, so both must agree.
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHARS_PER_TOKEN,
  COMPACT_AT,
  KEEP_RECENT_MESSAGES,
  MIN_FOLD_MESSAGES,
  SUMMARY_CHAR_BUDGET,
  appendSummary,
  buildSummaryMessages,
  compactionSurvives,
  conversationChars,
  foldedTokens,
  messageChars,
  planCompaction,
  planManualCompaction,
  renderCompactionBlock,
  renderTranscript,
  runCompaction,
  trimSummary,
} from "../../agent/compaction";
import type { CompactionPlan } from "../../agent/compaction";
import {
  MIN_COMPACT_LIMIT,
  PAID_COMPACT_CAP,
  compactThreshold,
  contextDetails,
  describeContextWindow,
  formatTokenCount,
  maxLimitFor,
  measureBreakdown,
  parseTokenCount,
  tokensOf,
} from "../../agent/contextBreakdown";
import type { PromptParts } from "../../agent/contextBreakdown";
import { RESUME_BUDGET, buildResumeMessage, describeCompletedWork, joinContinuation } from "../../agent/resume";
import type { SearchStep } from "../../types";
import { EXPLORE_TIMEOUT_MS, explore, pickExploreModel } from "../../agent/subagent";
import type { ExploreRequest } from "../../agent/subagent";
import { chooseChannel, looksLikeCall, readRepair, repairPrompt, repairSchema } from "../../agent/toolChannel";
import type { ToolDefinition } from "../../tools/registry";
import { getLiveTurn, setLiveTurn } from "../../agent/liveTurn";
import type { LiveTurn } from "../../agent/liveTurn";
import { createTaskManager } from "../../agent/taskManager";
import type { TaskHost } from "../../agent/taskManager";
import type { AgentRequest, AgentHost, AgentResult, WireMessage } from "../../agent/agentLoop";
import { estimateChars, toWireMessage } from "../../agent/agentLoop";
import { describeEdit, describePlan, parsePlan, samePlan } from "../../plan/plan";
import type { PlanItem } from "../../plan/plan";
import { isRemote, providerOf, scopeToTarget } from "../../ai/providers";
import {
  describeSkills,
  loadedSkillIds,
  renderInvokedSkill,
  renderLoadedSkills,
  renderSkill,
  skillInvocation,
} from "../../skills/skills";
import type { InstalledSkill, LoadedSkill } from "../../types";
import type { AppSettings, ChatSession, Message, MessageVersion, MetricRow } from "../../types";
import type { Grant } from "../../agent/permissions";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../shared/fixtures/agentstate");

/** Turns the task manager started, in order, so a fixture can finish, fail or ask on one of them. */
const pending = vi.hoisted(() => {
  const turns: {
    request: AgentRequest;
    host: AgentHost;
    settled: boolean;
    resolve: (result: AgentResult) => void;
    reject: (error: Error) => void;
  }[] = [];
  return turns;
});

vi.mock("../../agent/agentLoop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../agent/agentLoop")>()),
  KEEP_ALIVE: "30m",
  runAgentTurn: (request: AgentRequest, host: AgentHost) =>
    new Promise<AgentResult>((resolve, reject) => {
      pending.push({ request, host, settled: false, resolve, reject });
    }),
}));

type Json = Record<string, unknown>;

/** JSON has no undefined: the value a driver returns is written and compared as its JSON form. */
const asJson = (value: unknown): unknown => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  pending.length = 0;
});

// ---------------------------------------------------------------------------------------------------------------
// agentLoop: the pure helpers of the turn loop. A case is told apart by its input's shape.
// ---------------------------------------------------------------------------------------------------------------

const PLAN_OPS = ["parsePlan", "samePlan", "describePlan", "describeEdit"];
const ROUTE_OPS = ["isRemote", "providerOf", "scopeToTarget"];
const SKILL_OPS = [
  "skillInvocation",
  "loadedSkillIds",
  "renderLoadedSkills",
  "renderInvokedSkill",
  "renderSkill",
  "describeSkills",
];

function loopCase(input: Json): unknown {
  if ("message" in input) {
    return toWireMessage(input.message as Message, input.allowImages as boolean, input.keepThinking as boolean);
  }
  if ("messages" in input && !("op" in input)) {
    return estimateChars(
      (input.messages as Json[]).map((message) => ({ role: "user", ...message }) as WireMessage),
      (input.toolChars as number | undefined) ?? 0,
    );
  }
  if (PLAN_OPS.includes(String(input.op))) {
    const items = (text: unknown) => parsePlan(String(text));
    switch (input.op) {
      case "parsePlan":
        return parsePlan(input.text as string);
      case "samePlan":
        return samePlan(items(input.left), items(input.right));
      case "describePlan":
        return describePlan(items(input.text));
      default:
        return describeEdit(items(input.text) as PlanItem[]);
    }
  }
  if (ROUTE_OPS.includes(String(input.op))) {
    switch (input.op) {
      case "isRemote":
        return isRemote(input.model as string);
      case "providerOf":
        return providerOf(input.model as string);
      default:
        return scopeToTarget(input.messages as Json[], input.model as string);
    }
  }
  if (SKILL_OPS.includes(String(input.op))) return skillCase(input);
  throw new Error(`no agentLoop case for ${JSON.stringify(input)}`);
}

/** The skill helpers. An invocation reads as the id it starts and the request that came with it. */
function skillCase(input: Json): unknown {
  switch (input.op) {
    case "skillInvocation": {
      const found = skillInvocation(input.text as string, input.skills as InstalledSkill[]);
      return found ? { id: found.skill.id, request: found.request } : null;
    }
    case "loadedSkillIds":
      return loadedSkillIds(input.messages as Message[], input.skills as InstalledSkill[]);
    case "renderLoadedSkills":
      return renderLoadedSkills(input.loaded as LoadedSkill[]);
    case "renderInvokedSkill":
      return renderInvokedSkill(input.skill as InstalledSkill, input.request as string);
    case "renderSkill":
      return renderSkill(input.skill as LoadedSkill);
    default:
      return describeSkills(input.skills as InstalledSkill[]);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// compaction
// ---------------------------------------------------------------------------------------------------------------

function compactionCase(input: Json): unknown {
  const messages = (input.messages ?? []) as Message[];
  const existing = (input.existing ?? null) as CompactionPyState | null;
  switch (input.op) {
    case "constants":
      return {
        CHARS_PER_TOKEN,
        COMPACT_AT,
        KEEP_RECENT_MESSAGES,
        MIN_FOLD_MESSAGES,
        SUMMARY_CHAR_BUDGET,
      };
    case "messageChars":
      return messageChars(input.message as Message);
    case "conversationChars":
      return conversationChars(messages, existing);
    case "planCompaction":
      return planCompaction(messages, {
        existing,
        budgetChars: input.budgetChars as number,
        ...(input.keepRecent !== undefined ? { keepRecent: input.keepRecent as number } : {}),
        ...(input.minFold !== undefined ? { minFold: input.minFold as number } : {}),
      });
    case "planManual":
      return planManualCompaction(messages, existing);
    case "foldedTokens":
      return foldedTokens(messages, input.plan as CompactionPlan);
    case "renderTranscript":
      return renderTranscript(messages);
    case "buildSummaryMessages":
      return buildSummaryMessages((input.previous ?? null) as string | null, input.slice as Message[]);
    case "appendSummary":
      return appendSummary((input.previous ?? null) as string | null, input.addition as string);
    case "trimSummary":
      return input.budget === undefined
        ? trimSummary(input.summary as string)
        : trimSummary(input.summary as string, input.budget as number);
    case "renderCompactionBlock":
      return renderCompactionBlock(input.state as CompactionPyState);
    case "compactionSurvives":
      return compactionSurvives(
        (input.state ?? null) as CompactionPyState | null,
        messages,
        input.editedIndex === undefined ? undefined : (input.editedIndex as number),
      );
    case "foldResult":
      return foldResult(input);
    case "requestBody":
      return requestBody(input);
    default:
      throw new Error(`no compaction op ${String(input.op)}`);
  }
}

type CompactionPyState = { throughIndex: number; summary: string; updatedAt: number };

/** A fold against a stubbed provider: the reply body and status the summariser answers with. */
async function foldResult(input: Json): Promise<unknown> {
  const messages = input.messages as Message[];
  const plan = input.plan as CompactionPlan;
  const existing = (input.existing ?? null) as CompactionPyState | null;
  const status = (input.status ?? 200) as number;
  const body = input.response as string;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status })),
  );
  const folded = await runCompaction({ model: "qwen-model", numCtx: 8192, messages, plan, existing });
  if (!folded) return null;
  return { throughIndex: folded.throughIndex, summary: folded.summary };
}

/** The chat request a fold sends for a plan, captured from the stubbed provider. */
async function requestBody(input: Json): Promise<unknown> {
  let captured: unknown = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "notes" } }] }), { status: 200 });
    }),
  );
  await runCompaction({
    model: input.model as string,
    numCtx: 8192,
    messages: input.messages as Message[],
    plan: input.plan as CompactionPlan,
  });
  return captured;
}

// ---------------------------------------------------------------------------------------------------------------
// contextBreakdown
// ---------------------------------------------------------------------------------------------------------------

function contextCase(input: Json): unknown {
  switch (input.op) {
    case "tokensOf":
      return tokensOf(input.chars as number);
    case "measureBreakdown":
      return measureBreakdown(input.parts as PromptParts, input.measured as number, (input.conversationChars ?? 0) as number);
    case "describeContextWindow":
      return describeContextWindow(input.input as Parameters<typeof describeContextWindow>[0]);
    case "compactThreshold":
      return compactThreshold(
        input.window as number,
        (input.limit ?? null) as number | null,
        Boolean(input.paid),
      );
    case "maxLimitFor":
      return maxLimitFor(input.window as number);
    case "parseTokenCount": {
      const parsed = parseTokenCount(input.raw as string);
      return parsed === undefined ? "undefined" : parsed;
    }
    case "formatTokenCount":
      return formatTokenCount(input.tokens as number);
    case "contextDetails":
      return contextDetails((input.parts ?? null) as PromptParts | null, input.loaded as { id: string; name: string }[]);
    case "constants":
      return { PAID_COMPACT_CAP, MIN_COMPACT_LIMIT };
    default:
      throw new Error(`no contextBreakdown op ${String(input.op)}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// resume
// ---------------------------------------------------------------------------------------------------------------

function resumeCase(input: Json): unknown {
  const steps = (input.steps ?? []) as SearchStep[];
  switch (input.op) {
    case "describeCompletedWork":
      return describeCompletedWork(steps, input.budget as number | undefined);
    case "buildResumeMessage":
      return buildResumeMessage(steps);
    case "joinContinuation":
      return joinContinuation(input.before as string, input.after as string);
    case "constants":
      return { RESUME_BUDGET };
    default:
      throw new Error(`no resume op ${String(input.op)}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// subagent
// ---------------------------------------------------------------------------------------------------------------

/** One explore call against the task-level mock: the nested turn answers, fails, or runs past its timeout. */
async function exploreCase(input: Json): Promise<unknown> {
  const request: ExploreRequest = {
    question: input.question as string,
    model: "qwen3:8b",
    settings: { customInstructions: [] } as unknown as AppSettings,
    environment: { webMode: "off", codeExecution: false, libraryReady: false },
    signal: new AbortController().signal,
  };

  const mode = input.mode as string;
  if (mode === "timeout") vi.useFakeTimers();

  // The nested turn is started synchronously, before explore first awaits.
  const answer = explore(request);
  const turn = pending[pending.length - 1];

  if (mode === "answer") {
    turn.resolve({ textContent: input.text as string } as unknown as AgentResult);
  } else if (mode === "error") {
    turn.reject(new Error(input.message as string));
  } else if (mode === "timeout") {
    vi.advanceTimersByTime(EXPLORE_TIMEOUT_MS);
    turn.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
  }

  const result = await answer;
  vi.useRealTimers();
  return result;
}

function subagentCase(input: Json): unknown {
  switch (input.op) {
    case "pickExploreModel":
      return pickExploreModel(input.installed as never, input.current as string);
    case "constants":
      return { EXPLORE_TIMEOUT_MS };
    default:
      throw new Error(`no subagent op ${String(input.op)}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// toolChannel
// ---------------------------------------------------------------------------------------------------------------

function toolChannelCase(input: Json): unknown {
  switch (input.op) {
    case "chooseChannel":
      return chooseChannel((input.capabilities ?? undefined) as string[] | undefined);
    case "repairSchema":
      return repairSchema(input.definitions as ToolDefinition[]);
    case "repairPrompt":
      return repairPrompt(input.broken as string);
    case "readRepair":
      return readRepair(input.raw as string);
    case "looksLikeCall":
      return looksLikeCall(input.text as string, input.names as string[]);
    default:
      throw new Error(`no toolChannel op ${String(input.op)}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// liveTurn: an ordered list of set calls, then the value each queried chat reads back.
// ---------------------------------------------------------------------------------------------------------------

function liveTurnCase(input: Json): unknown {
  const ops = input.ops as { chatId: string; live: LiveTurn | null }[];
  const query = input.query as string[];
  // The store is module-wide, so every chat a case names starts empty.
  for (const chatId of [...ops.map((step) => step.chatId), ...query]) setLiveTurn(chatId, null);
  for (const step of ops) {
    setLiveTurn(step.chatId, step.live);
  }
  const read: Record<string, unknown> = {};
  for (const chatId of input.query as string[]) {
    read[chatId] = getLiveTurn(chatId);
  }
  return read;
}

// ---------------------------------------------------------------------------------------------------------------
// taskManager: an op list over one manager, then the projected final state.
// ---------------------------------------------------------------------------------------------------------------

const settings = { customInstructions: [] } as unknown as AppSettings;

type TaskOp = Json & { op: string };

function createHost(model: string | null, workspaceId: string, sessions: ChatSession[]) {
  const store = new Map<string, ChatSession>();
  for (const session of sessions) store.set(session.id, structuredClone(session));
  const granted: Grant[] = [];
  const recorded: MetricRow[] = [];

  const host: TaskHost = {
    getModel: () => model,
    getSettings: () => settings,
    getEnvironment: () => ({ webMode: "off", codeExecution: false, libraryReady: false }),
    getWorkspaceId: () => workspaceId,
    getPermission: () => ({ mode: "auto", grants: [] }),
    onGrant: (grant) => granted.push(grant),
    getSession: (chatId) => store.get(chatId),
    addSession: (session) => store.set(session.id, session),
    updateSession: (chatId, updater) => {
      const session = store.get(chatId);
      if (session) store.set(chatId, updater(session));
    },
    patchActiveMessage: (chatId, patch: Partial<MessageVersion>, sessionPatch?: Partial<ChatSession>) => {
      const session = store.get(chatId);
      if (!session) return;
      const messages = session.messages.slice();
      if (messages.length > 0) {
        const last = messages[messages.length - 1];
        messages[messages.length - 1] = { ...last, ...patch } as Message;
      }
      store.set(chatId, { ...session, ...sessionPatch, messages });
    },
    recordMetrics: (row) => recorded.push(row),
    t: (key) => key,
  };

  return { store, host, recorded, granted };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const stepTypes = (steps: { type: string }[] | undefined) => (steps ? steps.map((step) => step.type) : null);

/** The part of a session the fixture pins: what a person would see, without ids or clock readings. */
function projectSession(session: ChatSession) {
  return {
    id: session.id,
    workspaceId: session.workspaceId ?? null,
    isGenerating: session.isGenerating,
    isOutOfContext: Boolean(session.isOutOfContext),
    compaction: session.compaction
      ? { throughIndex: session.compaction.throughIndex, summary: session.compaction.summary }
      : null,
    messages: session.messages.map((message) => ({
      role: message.role,
      content: message.content,
      failed: Boolean(message.failed),
      textContent: message.textContent ?? null,
      steps: stepTypes(message.steps),
      providerState: message.provider_state ?? null,
      fold: message.fold?.status ?? null,
      currentVersionIndex: message.currentVersionIndex ?? null,
      versions: (message.versions ?? []).map((version) => ({
        content: version.content,
        steps: stepTypes(version.steps),
        providerState: version.provider_state ?? null,
      })),
    })),
  };
}

async function taskCase(input: Json): Promise<unknown> {
  const { store, host, recorded, granted } = createHost(
    (input.model ?? null) as string | null,
    (input.workspaceId ?? "default") as string,
    (input.sessions ?? []) as ChatSession[],
  );
  const manager = createTaskManager(host);
  const answers: Record<string, unknown> = {};
  const seen: { chatId: string; contents: string[] }[] = [];

  const turnFor = (chatId: string) => {
    for (let index = pending.length - 1; index >= 0; index--) {
      if (pending[index].request.chatId === chatId) return pending[index];
    }
    throw new Error(`no turn for ${chatId}`);
  };

  for (const op of input.ops as TaskOp[]) {
    switch (op.op) {
      case "send":
        manager.send(op.chatId as string, op.content as string, op.attachments as never);
        break;
      case "regenerate":
        manager.regenerate(op.chatId as string, op.index as number | undefined);
        break;
      case "editMessage":
        manager.editMessage(op.chatId as string, op.index as number, op.content as string);
        break;
      case "switchVersion":
        manager.switchVersion(op.chatId as string, op.index as number, op.version as number);
        break;
      case "continue":
        manager.continueGeneration(op.chatId as string);
        break;
      case "finish": {
        const turn = pending.find((item) => item.request.chatId === op.chatId && !item.settled);
        if (!turn) throw new Error(`nothing to finish for ${String(op.chatId)}`);
        turn.settled = true;
        turn.resolve({
          steps: [],
          textContent: "",
          exhausted: false,
          outOfContext: false,
          aborted: false,
          loops: 0,
          toolCalls: {},
          ...(op.result as Json),
        } as unknown as AgentResult);
        await flush();
        break;
      }
      case "fail": {
        const turn = pending.find((item) => item.request.chatId === op.chatId && !item.settled);
        if (!turn) throw new Error(`nothing to fail for ${String(op.chatId)}`);
        turn.settled = true;
        const error = op.abort ? Object.assign(new Error("aborted"), { name: "AbortError" }) : new Error(op.message as string);
        turn.reject(error);
        await flush();
        break;
      }
      case "ask": {
        const turn = turnFor(op.chatId as string);
        const answer = turn.host.requestApproval!({
          id: op.approvalId as string,
          tool: "write_file",
          target: "notes.md",
          reason: "This changes something outside Draggy.",
        } as never);
        answers[op.approvalId as string] = "pending";
        void answer.then((value) => {
          answers[op.approvalId as string] = value;
        });
        break;
      }
      case "answer":
        manager.answerApproval(op.approvalId as string, op.answer as never);
        await flush();
        break;
      case "grant": {
        const turn = turnFor(op.chatId as string);
        turn.host.onGrant!(op.grant as Grant);
        break;
      }
      case "seen": {
        const turn = turnFor(op.chatId as string);
        seen.push({ chatId: op.chatId as string, contents: turn.request.messages.map((message) => message.content) });
        break;
      }
      case "stop":
        manager.stop(op.chatId as string);
        break;
      case "stopAll":
        manager.stopAll();
        break;
      default:
        throw new Error(`no task op ${op.op}`);
    }
  }

  await flush();
  await flush();

  const sessions = [...store.values()].sort((a, b) => a.id.localeCompare(b.id)).map(projectSession);
  return {
    sessions,
    running: [...manager.running()],
    granted,
    answers,
    recorded: recorded.map((row) => ({
      chatId: row.chatId,
      model: row.model,
      promptTokens: row.promptTokens,
      responseTokens: row.responseTokens,
      responseMs: row.responseMs,
      firstTokenMs: row.firstTokenMs ?? null,
      loadMs: row.loadMs,
      loops: row.loops,
      tools: row.tools,
    })),
    seen,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Dispatch and runner
// ---------------------------------------------------------------------------------------------------------------

/** Runs one fixture case through the TypeScript reference and returns its JSON-form result. */
export async function driveCase(area: string, input: Json): Promise<unknown> {
  // Each case starts from the same empty mocks, whether or not the test runner ran a hook between cases.
  pending.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  switch (area) {
    case "compaction":
      return asJson(await compactionCase(input));
    case "contextBreakdown":
      return asJson(contextCase(input));
    case "resume":
      return asJson(resumeCase(input));
    case "subagent":
      return asJson(input.op === "explore" ? await exploreCase(input) : subagentCase(input));
    case "toolChannel":
      return asJson(toolChannelCase(input));
    case "liveTurn":
      return asJson(liveTurnCase(input));
    case "taskManager":
      return asJson(await taskCase(input));
    case "agentLoop":
      return asJson(loopCase(input));
    default:
      throw new Error(`no driver for ${area}`);
  }
}

const areas = fs.existsSync(FIXTURE_DIR) ? fs.readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".json")) : [];

describe("agentstate golden fixtures", () => {
  it("has a fixture file for every area", () => {
    expect(areas.length).toBeGreaterThan(0);
  });

  for (const file of areas) {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as {
      area: string;
      cases: { name: string; input: Json; expected: unknown }[];
    };

    describe(file, () => {
      for (const testCase of fixture.cases) {
        it(testCase.name, async () => {
          const actual = await driveCase(fixture.area, testCase.input);
          expect(actual).toEqual(testCase.expected);
        });
      }
    });
  }
});
