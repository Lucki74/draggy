import {
  KEEP_ALIVE,
  beginLlamaWork,
  contextSizeFor,
  getModelInfo,
  gpuShareFor,
  hasCapability,
  isCloudModel,
  isLoadedAt,
  mergeMetrics,
  needsTextModeTools,
  noteEngineStart,
  llamaIsBusy,
  onLlamaWork,
  peekContextSize,
  readMetrics,
  recalledCapabilities,
} from "../llama";
import type { GenerationMetrics } from "../llama";
import { buildSystemPrompt, currentTimeNote } from "../prompts";
import { loadProjectMemory } from "../project/load";
import {
  MAX_LISTED_SKILLS,
  describeSkills,
  loadSkills,
  loadedSkillIds,
  renderInvokedSkill,
  renderLoadedSkills,
  renderSkill,
  skillInvocation,
} from "../skills/skills";
import type { LoadedSkill } from "../types";
import { renderMemory } from "../project/memory";
import { CHARS_PER_TOKEN, renderCompactionBlock } from "./compaction";
import type { LiveTurn } from "./liveTurn";
import { measureBreakdown } from "./contextBreakdown";
import type { PromptParts } from "./contextBreakdown";
import {
  MAX_TOOL_LOOPS,
  STREAM_UI_INTERVAL_MS,
  TOOL_MARKER_OVERLAP,
  TOOL_MARKER_RE,
  detectToolCall,
  extractThought,
  parseToolCall,
  stripToolSyntax,
} from "../toolParsing";
import { buildResumeMessage, joinContinuation } from "./resume";
import { detectRepetition } from "./repetition";
import { ggufModelName } from "../ai/engineAdapter";
import { engineFailure, engineUnreachable } from "../ai/engineErrors";
import { ggufErrorMessage, sseToLlamaChunks, toLlamaMessages } from "../ai/llamaStream";
import {
  annotationsFor,
  availableTools,
  describeToolsForPrompt,
  runTool,
  toolDefinitions,
  withoutTools,
} from "../tools/registry";
import type { ToolContext, ToolDefinition, ToolEnvironment } from "../tools/registry";
import {
  chooseChannel,
  looksLikeCall,
  readRepair,
  repairPrompt,
  repairSchema,
} from "./toolChannel";
import type { RepairedCall } from "./toolChannel";
import {
  addGrant,
  decide,
  deniedByUser,
  refusalFor,
  grantsFor,
  targetFromArgs,
} from "./permissions";
import type { Grant } from "./permissions";
import { describeEdit, describePlan, samePlan } from "../plan/plan";
import type { PlanItem } from "../plan/plan";
import {
  loggedFetch,
  logLlamaInference,
  logLlamaMetrics,
  logStreamChunk,
  logAgentStep,
  logToolCall,
  newCorrelationId,
} from "../logger";
import { generateId, isBinary, safeJsonParse } from "../utils";
import type {
  AppSettings,
  ApprovalAnswer,
  CompactionState,
  Message,
  PermissionMode,
  SearchStep,
} from "../types";

// Re-exported for the screens that warm the model with the same value.
export { KEEP_ALIVE };

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

interface LlamaToolCall {
  id?: string;
  function: { name: string; arguments: Record<string, unknown> };
}

interface LlamaChunk {
  message?: {
    content?: string;
    thinking?: string;
    tool_calls?: LlamaToolCall[];
  };
  done?: boolean;
  done_reason?: string;
}

export interface WireMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** An earlier reply's reasoning, sent back so the model keeps reasoning. */
  thinking?: string;
  images?: string[];
  tool_calls?: LlamaToolCall[];
  tool_call_id?: string;
  tool_name?: string;
}

/** `keepThinking` sends a reply's reasoning back with it. With reasoning dropped from history,
 * Laguna wrote none at all; kept, it wrote 400 characters. */
export function toWireMessage(
  message: Message,
  allowImages: boolean,
  keepThinking = false,
): WireMessage {
  let content = message.content || "";
  const images: string[] = [];

  for (const attachment of message.attachments || []) {
    const extension = attachment.name.split(".").pop()?.toLowerCase() || "";
    const isImage =
      attachment.type.startsWith("image/") || IMAGE_EXTENSIONS.includes(extension);

    if (isImage && allowImages) {
      const base64 = (
        attachment.content.includes(",")
          ? attachment.content.slice(attachment.content.indexOf(",") + 1)
          : attachment.content
      ).trim();

      // Sending empty data makes the model reject the whole request with an
      // opaque error, so say plainly that the image could not be read instead.
      if (base64) {
        images.push(base64);
      } else {
        content += `

[Attached image: ${attachment.name}. The image data could not be read, so it was not sent.]`;
      }
    } else if (isImage) {
      content += `\n\n[Attached image: ${attachment.name}. This model cannot read images, so describe the limitation instead of guessing its contents.]`;
    } else if (attachment.type.startsWith("video/")) {
      content += `\n\n[Attached Video: ${attachment.name}]`;
    } else if (!isBinary(attachment.content)) {
      content += `\n\n--- ATTACHED FILE: ${attachment.name} ---\n${attachment.content}\n--- END ATTACHED FILE ---`;
    } else {
      content += `\n\n[Attached Binary File: ${attachment.name}]`;
    }
  }

  const thinking =
    keepThinking && message.role === "assistant"
      ? (message.steps ?? [])
          .filter((step) => step.type === "thinking" && step.content.trim())
          .map((step) => step.content)
          .join("\n\n")
      : "";

  return {
    role: message.role,
    content: content.trim() || " ",
    ...(thinking ? { thinking } : {}),
    ...(images.length > 0 ? { images } : {}),
  };
}

/** `toolChars` is the tool definitions sent with every request: thousands of tokens the window needs
 * room for, and the reason a small chat could land just over a bucket and be refused. */
export function estimateChars(messages: WireMessage[], toolChars = 0): number {
  return toolChars + messages.reduce(
    (total, message) =>
      total +
      message.content.length +
      (message.thinking?.length || 0) +
      (message.images?.length || 0) * 4000,
    0,
  );
}

export interface AgentSeed {
  content: string;
  textContent: string;
  steps: SearchStep[];
}

export interface AgentRequest {
  model: string;
  settings: AppSettings;
  environment: ToolEnvironment;
  messages: Message[];
  isContinuation?: boolean;
  seed?: AgentSeed | null;
  /** The older part of this conversation, already folded into notes. */
  compaction?: CompactionState | null;
  /** Which workspace this turn belongs to, and which conversation in it. */
  workspaceId?: string;
  chatId?: string;
  /** How much this turn may do on its own, and what the user has already allowed. Left out, the
   * turn runs unguarded, which is what a plain chat with no folder of its own has always done. */
  permission?: { mode: PermissionMode; grants?: Grant[] };
  /** What the model counted for this very prompt, measured just before, and the wire it was for.
   * The context meter starts from it instead of an estimate. */
  contextBase?: { tokens: number; chars: number } | null;
  signal: AbortSignal;
}

export interface ApprovalRequest {
  id: string;
  tool: string;
  target: string | null;
  /** Why this needs an answer, in the permission engine's words. */
  reason: string;
}

export interface AgentPatch {
  content: string;
  textContent: string;
  steps: SearchStep[];
}

export interface AgentHost {
  t: (key: string) => string;
  onPatch: (patch: AgentPatch) => void;
  onSteps: (steps: SearchStep[]) => void;
  onOutOfContext: (outOfContext: boolean) => void;
  onMetrics?: (metrics: GenerationMetrics | null) => void;
  /** Puts a call to the user and waits. Without it a turn that needs an answer has no one to ask,
   * and the call is refused rather than run unasked. */
  requestApproval?: (request: ApprovalRequest) => Promise<ApprovalAnswer>;
  /** A permission the user wants kept for this workspace, not just this task. */
  onGrant?: (grant: Grant) => void;
  /** Where a plan the model writes goes, and where the live one comes from. */
  onPlan?: (items: PlanItem[]) => void;
  getPlan?: () => PlanItem[] | null;
  /** Speed and context as the turn runs, a few times a second. */
  onLive?: (live: LiveTurn) => void;
}

export interface AgentResult {
  content: string;
  textContent: string;
  steps: SearchStep[];
  metrics: GenerationMetrics | null;
  outOfContext: boolean;
  loops: number;
  exhausted: boolean;
  aborted: boolean;
  /** How many times the model reached for each tool, refused calls included. */
  toolCalls: Record<string, number>;
}

const EXHAUSTED_MESSAGE =
  "I apologize, but I reached the maximum number of search steps without finding a definitive final answer.";

const FALLBACK_RESULT_CHARS = 2000;

export type TurnInput = Pick<
  AgentRequest,
  "model" | "settings" | "environment" | "messages" | "isContinuation" | "seed" | "compaction" | "workspaceId"
>;

/** Everything a turn sends before the model says a word: the prompt, the tools, the wire. Shared
 * with the context meter, so what it measures is exactly what a turn would send. */
export interface PreparedTurn {
  info: Awaited<ReturnType<typeof getModelInfo>>;
  nativeTools: boolean;
  nativeVision: boolean;
  hasThinkingCapability: boolean;
  nativeThinking: boolean;
  cleanStream: boolean;
  definitions: ToolDefinition[];
  promptParts: PromptParts;
  wire: WireMessage[];
  /** The skill this message started with a slash command, once it has loaded. */
  invokedSkill: { id: string; name: string } | null;
}

export async function prepareTurn(request: TurnInput): Promise<PreparedTurn> {
  const { model, messages } = request;

  const info = await getModelInfo(model);

  // A model that cannot call tools is given none, and one that cannot think is not asked to: the
  // composer shows both as off. A probe that got no answer proves nothing, so an unknown model is
  // left as it was asked for.
  const cannotUseTools = needsTextModeTools(info);
  const cannotThink = info !== null && !hasCapability(info, "thinking");
  const settings: AppSettings = {
    ...request.settings,
    ...(cannotUseTools ? { webMode: "off" as const } : {}),
    ...(cannotThink ? { thinkingMode: "low" as const } : {}),
  };
  const environment = cannotUseTools ? withoutTools(request.environment) : request.environment;

  // A probe that failed is not proof a model cannot call tools: the engine may
  // have been busy. What it said last time stands in.
  const capabilities = info
    ? info.capabilities
    : await recalledCapabilities(model);

  const nativeTools = info
    ? hasCapability(info, "tools")
    : chooseChannel(capabilities) === "native";
  const nativeVision = hasCapability(info, "vision");
  const hasThinkingCapability = hasCapability(info, "thinking");
  const nativeThinking = hasThinkingCapability && settings.thinkingMode !== "low";
  const cleanStream = nativeTools && nativeThinking;

  // Read every turn rather than once: a project whose rules changed halfway
  // through a conversation should be followed from the next message.
  const memory =
    environment.hasFolder && environment.projectRoot && request.workspaceId
      ? await loadProjectMemory(request.workspaceId, environment.projectRoot)
      : null;

  // A project is Code's; everything else is Chat's, and each side has its own skills switched on.
  const skills = environment.hasSkills
    ? await loadSkills(request.workspaceId || "default", environment.hasFolder ? "code" : "chat")
    : [];

  // "/code-review src/app.ts" loads that skill with the message, as a slash command should.
  const lastMessage = messages[messages.length - 1];
  const invoked =
    !request.isContinuation && lastMessage?.role === "user"
      ? skillInvocation(lastMessage.content, skills)
      : null;

  // A skill loaded anywhere in the conversation stays loaded, as its text would if tool results
  // were carried from turn to turn. Switched off since, it is dropped.
  const loadedSkills = await readLoadedSkills(
    request.workspaceId || "default",
    loadedSkillIds(messages, skills),
  );
  const loadedSection = renderLoadedSkills(loadedSkills);

  const systemPrompt = [
    buildSystemPrompt(settings, { nativeTools, nativeThinking }, environment, memory, skills),
    loadedSection,
  ]
    .filter(Boolean)
    .join("\n\n");
  const definitions = toolDefinitions(environment);

  const prefill = request.isContinuation
    ? (request.seed?.textContent ?? "")
    : "";

  // On a continuation the half-written reply moves to the very end: a model
  // completes a trailing assistant message but starts afresh after a user one.
  const history =
    request.isContinuation &&
    messages.length > 0 &&
    messages[messages.length - 1].role === "assistant"
      ? messages.slice(0, -1)
      : messages;

  // Messages the summary covers are not sent again, unless the summary no
  // longer fits: a record of messages that are gone is worse than nothing.
  const compaction =
    request.compaction && request.compaction.throughIndex < history.length
      ? request.compaction
      : null;

  const carried = compaction ? history.slice(compaction.throughIndex) : history;

  // What the fixed parts of the prompt cost, so the context view can say where
  // the window went rather than only how full it is.
  const memoryChars = memory ? renderMemory(memory).length : 0;
  const skillChars = describeSkills(skills).length;
  const loadedSkillChars = loadedSection.length;
  const catalogueChars = nativeTools ? 0 : describeToolsForPrompt(environment).length;

  const promptParts: PromptParts = {
    systemChars: Math.max(
      0,
      systemPrompt.length - memoryChars - skillChars - loadedSkillChars - catalogueChars,
    ),
    toolChars: nativeTools ? JSON.stringify(definitions).length : catalogueChars,
    memoryChars,
    skillChars,
    summaryChars: compaction ? renderCompactionBlock(compaction).length : 0,
    loadedSkillChars,
    loadedSkills: loadedSkills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      chars: renderSkill(skill).length,
    })),
    toolCount: availableTools(environment).length,
    skillCount: Math.min(
      skills.filter((skill) => skill.modelInvocable !== false).length,
      MAX_LISTED_SKILLS,
    ),
  };

  const wire: WireMessage[] = [
    { role: "system", content: systemPrompt },
    ...(compaction
      ? [{ role: "user" as const, content: renderCompactionBlock(compaction) }]
      : []),
    ...carried.map((message) => toWireMessage(message, nativeVision, nativeThinking)),
  ];

  if (request.isContinuation) {
    // Tool results only ever existed inside the turn that was cut off, so what
    // was actually done has to be rebuilt from the steps that survived.
    const resume = buildResumeMessage(request.seed?.steps ?? []);
    if (resume) wire.push({ role: "user", content: resume });

    wire.push({
      role: "user",
      content:
        "Your previous reply was cut off. Carry straight on from the exact character it stopped at, even if that is in the middle of a word or a sentence. Write only what comes next: no greeting, no preamble, no repetition of what you already wrote, and no repeating work you already finished.",
    });

    if (prefill) {
      wire.push({ role: "assistant", content: prefill });
    }
  }

  const lastUserIndex = wire.map((entry) => entry.role).lastIndexOf("user");

  const invokedSkill =
    invoked && loadedSkills.some((skill) => skill.id === invoked.skill.id) ? invoked.skill : null;

  if (invoked && invokedSkill && lastUserIndex !== -1) {
    wire[lastUserIndex] = {
      ...wire[lastUserIndex],
      content: `${wire[lastUserIndex].content}\n\n${renderInvokedSkill(invokedSkill, invoked.request)}`,
    };
  }

  // The clock goes at the tail, where changing it costs nothing. In the system
  // prompt it ended the cached prefix, re-evaluating the chat every turn.
  if (lastUserIndex !== -1) {
    wire[lastUserIndex] = {
      ...wire[lastUserIndex],
      content: `${wire[lastUserIndex].content}

${currentTimeNote()}`,
    };
  }

  return {
    info,
    nativeTools,
    nativeVision,
    hasThinkingCapability,
    nativeThinking,
    cleanStream,
    definitions,
    promptParts,
    wire,
    invokedSkill: invokedSkill ? { id: invokedSkill.id, name: invokedSkill.name } : null,
  };
}

/** The instructions of the skills a conversation loaded, skipping any that can no longer be read. */
async function readLoadedSkills(workspaceId: string, ids: string[]): Promise<LoadedSkill[]> {
  if (ids.length === 0) return [];

  const results = await Promise.all(
    ids.map((id) =>
      window.electronAPI?.skills?.read(workspaceId, id, { enabledOnly: true }).catch(() => undefined),
    ),
  );

  return results.flatMap((result) => (result?.success && result.skill ? [result.skill] : []));
}

export interface ContextMeasurement {
  /** What the model counted for the prompt: exact, not estimated. */
  tokens: number;
  /** The size of the wire it was counted for, to tell how much has been added since. */
  chars: number;
  window: number;
  parts: PromptParts;
}

/** How many tokens the model reads for this turn, asked of the model itself: a one-token reply to
 * the exact prompt a turn would send. Null whenever asking would cost a reply anything. */
export async function measureTurn(
  input: TurnInput,
  options: { signal: AbortSignal; allowLoad: boolean },
): Promise<ContextMeasurement | null> {
  if (isCloudModel(input.model) || llamaIsBusy()) return null;

  const turn = await prepareTurn(input);
  const chars = estimateChars(turn.wire);
  // The window has to hold the tool definitions too; the checkpoint below counts the wire alone.
  const windowChars = estimateChars(turn.wire, turn.nativeTools ? JSON.stringify(turn.definitions).length : 0);
  // A user-fixed window overrides the automatic bucket; null means let Draggy choose.
  const maxContext = turn.info?.contextLength ?? null;
  const fixedContext = input.settings.fixedContextSize ?? null;

  // A look that may not load the model must not grow the window either, or a later turn reloads.
  const numCtx = options.allowLoad
    ? contextSizeFor(input.model, windowChars, maxContext, fixedContext)
    : peekContextSize(input.model, windowChars, maxContext, fixedContext);

  if (!options.allowLoad && (await isLoadedAt(input.model, numCtx)) !== true) return null;
  if (options.signal.aborted || llamaIsBusy()) return null;

  if (options.allowLoad && typeof window !== "undefined" && window.electronAPI?.gguf) {
    const warmStart = await window.electronAPI.gguf.start({
      modelPath: ggufModelName(input.model),
      contextSize: numCtx,
    });
    if (!warmStart?.success && !warmStart?.alreadyRunning) return null;
    noteEngineStart(input.model, warmStart);
  }

  // Gives way the moment a reply starts. What it evaluated stays cached, so that reply loses nothing.
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal.addEventListener("abort", abort);
  const stopWatching = onLlamaWork(() => {
    if (llamaIsBusy()) controller.abort();
  });

  try {
    const response = await loggedFetch("http://127.0.0.1:11435/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ggufModelName(input.model),
        stream: false,
        max_tokens: 1,
        messages: toLlamaMessages(turn.wire),
        ...(turn.nativeTools ? { tools: turn.definitions } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const body = safeJsonParse<{ usage?: { prompt_tokens?: number } }>(await response.text());
    const tokens = Number(body?.usage?.prompt_tokens) || 0;
    return tokens > 0 ? { tokens, chars, window: numCtx, parts: turn.promptParts } : null;
  } catch {
    return null;
  } finally {
    stopWatching();
    options.signal.removeEventListener("abort", abort);
  }
}

/** How often the speed line and the meter hear from a running turn. */
const LIVE_INTERVAL_MS = 250;

export async function runAgentTurn(request: AgentRequest, host: AgentHost): Promise<AgentResult> {
  const end = beginLlamaWork();
  try {
    return await runTurn(request, host);
  } finally {
    end();
  }
}

async function runTurn(request: AgentRequest, host: AgentHost): Promise<AgentResult> {
  const { model, settings, environment, signal } = request;
  // One id for every pass and tool round-trip in this turn, so its log lines join back together.
  const correlationId = newCorrelationId();

  const mode: PermissionMode = request.permission?.mode ?? "auto";
  const steps: SearchStep[] = [...(request.seed?.steps ?? [])];

  logAgentStep(
    "turn_start",
    {
      model,
      mode,
      hasProjectRoot: Boolean(environment.projectRoot),
      initialSteps: steps.length,
    },
    correlationId,
  );

  const syncSteps = () => host.onSteps([...steps]);

  const pushStep = (step: SearchStep) => {
    steps.push(step);
    syncSteps();
  };

  const patchStep = (id: string, patch: Partial<SearchStep>) => {
    const index = steps.findIndex((entry) => entry.id === id);
    if (index !== -1) steps[index] = { ...steps[index], ...patch };
  };

  const dropStep = (id: string) => {
    const index = steps.findIndex((entry) => entry.id === id);
    if (index !== -1) steps.splice(index, 1);
  };

  const finishIncompleteSteps = () => {
    let changed = false;
    for (let i = steps.length - 1; i >= 0; i--) {
      if (!steps[i].isComplete) {
        if (steps[i].type === "loading") {
          steps.splice(i, 1);
        } else {
          steps[i] = { ...steps[i], isComplete: true };
        }
        changed = true;
      }
    }
    if (changed) syncSteps();
  };

  const toolContext: ToolContext = {
    t: host.t,
    settings,
    workspaceId: request.workspaceId,
    chatId: request.chatId,
    projectRoot: environment.projectRoot,
    environment,
    // The model knows what it just wrote, so a plan it sets itself is not an
    // edit to be told about on the next pass.
    onPlan: (items) => {
      lastSeenPlan = items;
      host.onPlan?.(items);
    },
    pushStep,
    patchStep,
    syncSteps,
    newId: generateId,
    signal,
    memo: new Map<string, unknown>(),
  };

  /** The plan as the model last saw it, so only the user's edits are reported. */
  let lastSeenPlan: PlanItem[] | null = null;

  let grants: Grant[] = [...(request.permission?.grants ?? [])];

  /** For the statistics page: which tools this turn reached for, and how often. */
  const toolCalls: Record<string, number> = {};

  /** Every tool call goes through here. A forbidden call returns an ordinary result, because a
   * refused model carries on and a model handed an exception stops. */
  async function runGuardedTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    if (signal.aborted) return "Tool execution cancelled.";
    toolCalls[name] = (toolCalls[name] ?? 0) + 1;

    const target = targetFromArgs(args);
    const annotations = annotationsFor(name);
    const verdict = decide({ mode, tool: name, annotations, target, grants });
    const kind = annotations.executes ? ("command" as const) : undefined;
    // What "always" would remember, shown on the card so the user knows before choosing.
    const remembered = grantsFor(name, target, annotations);

    if (verdict.decision === "allow") {
      const toolStart = performance.now();
      logToolCall(name, "start", args, correlationId);
      try {
        const abortPromise = new Promise<string>((resolve) => {
          signal.addEventListener("abort", () => resolve("Tool execution cancelled."), { once: true });
        });
        const toolOutput = await Promise.race([
          runTool(name, args, toolContext, environment),
          abortPromise,
        ]);
        logToolCall(name, "complete", { durationMs: performance.now() - toolStart }, correlationId);
        return toolOutput;
      } catch (err) {
        logToolCall(
          name,
          "error",
          { durationMs: performance.now() - toolStart, error: (err as Error).message },
          correlationId,
        );
        throw err;
      }
    }

    const stepId = generateId();

    if (verdict.decision === "deny") {
      logToolCall(name, "error", { reason: verdict.reason, verdict: "deny" }, correlationId);
      pushStep({
        id: stepId,
        type: "approval",
        content: host.t("toolRefused"),
        isComplete: true,
        answer: "no",
        approval: { id: stepId, tool: name, target, reason: verdict.reason, kind },
      });
      return refusalFor(name, verdict);
    }

    // Nobody to ask, or the user has already stopped the turn.
    if (!host.requestApproval || signal.aborted) {
      return refusalFor(name, verdict);
    }

    pushStep({
      id: stepId,
      type: "approval",
      content: host.t("approvalNeeded"),
      isComplete: false,
      approval: {
        id: stepId,
        tool: name,
        target,
        reason: verdict.reason,
        kind,
        allows: kind ? remembered.map((grant) => grant.target ?? "") : undefined,
      },
    });

    const answer = await host.requestApproval({
      id: stepId,
      tool: name,
      target,
      reason: verdict.reason,
    });

    patchStep(stepId, { answer, isComplete: true });
    syncSteps();

    if (answer === "no") return deniedByUser(name);

    // "once" leaves nothing behind: the next call of the same tool asks again.
    if (answer === "task" || answer === "workspace") {
      for (const grant of remembered) grants = addGrant(grants, grant);
    }
    if (answer === "workspace") {
      for (const grant of remembered) host.onGrant?.(grant);
    }

    return runTool(name, args, toolContext, environment);
  }

  /** One repair per turn for a malformed call: asked again with a JSON schema, so the sampler
   * can only produce a valid call. Costs one short request. */
  let repairsLeft = 1;

  async function repairCall(
    broken: string,
    definitions: ToolDefinition[],
    abort: AbortSignal,
  ): Promise<RepairedCall> {
    if (repairsLeft <= 0) return {};
    repairsLeft--;

    try {
      const response = await loggedFetch("http://127.0.0.1:11435/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ggufModelName(model),
          stream: false,
          max_tokens: 500,
          response_format: { type: "json_schema", json_schema: { name: "tool_call", schema: repairSchema(definitions) } },
          messages: [
            ...wire,
            { role: "user", content: repairPrompt(broken) },
          ],
        }),
        signal: abort,
      });

      if (!response.ok) return {};

      const body = safeJsonParse<{ choices?: { message?: { content?: string } }[] }>(
        await response.text(),
      );

      return readRepair(body?.choices?.[0]?.message?.content ?? "");
    } catch {
      // A repair that fails leaves the turn exactly as it was: the reply is
      // shown as written, which is what happened before this existed.
      return {};
    }
  }

  const {
    info,
    nativeTools,
    hasThinkingCapability,
    nativeThinking,
    cleanStream,
    definitions,
    promptParts,
    wire,
    invokedSkill,
  } = await prepareTurn(request);

  // A slash command's skill shows where it loaded, as one the model asked for does.
  if (invokedSkill) {
    pushStep({
      id: generateId(),
      type: "skill",
      content: `${host.t("usedSkill")} **${invokedSkill.name}**`,
      isComplete: true,
      skill: invokedSkill.id,
    });
  }

  let loopCount = 0;
  let isFinished = false;
  let outOfContext = false;
  // Assigned on the first pass of the loop below, which always runs.
  let numCtx: number;
  let metrics: GenerationMetrics | null = null;

  // Stream chunks stand in for tokens until a pass ends and the engine gives the real counts. Chunks
  // run a little under tokens, so each pass corrects the ratio for the next.
  let contextCheckpoint = request.contextBase ?? null;
  let finishedTokens = 0;
  let tokensPerChunk = 1;
  let liveRate = 0;
  let liveAt = 0;

  const emitLive = (passChunks: number, passStartedAt: number | null, exact = false) => {
    if (!host.onLive) return;
    const now = performance.now();
    if (!exact && now - liveAt < LIVE_INTERVAL_MS) return;
    liveAt = now;

    const streamed = passChunks * tokensPerChunk;
    if (passStartedAt !== null && passChunks > 1 && now > passStartedAt) {
      liveRate = streamed / ((now - passStartedAt) / 1000);
    }

    const wireChars = estimateChars(wire);
    // Nothing added since the model last counted: that count still stands exactly.
    const unchanged = contextCheckpoint !== null && passChunks === 0 && wireChars === contextCheckpoint.chars;
    const known = contextCheckpoint
      ? contextCheckpoint.tokens + Math.max(0, wireChars - contextCheckpoint.chars) / CHARS_PER_TOKEN
      : wireChars / CHARS_PER_TOKEN;

    host.onLive({
      responseTokens: Math.round(finishedTokens + streamed),
      tokensPerSecond: liveRate,
      contextTokens: Math.round(
        (exact || unchanged) && contextCheckpoint ? contextCheckpoint.tokens : known + streamed,
      ),
      contextExact: (exact || unchanged) && contextCheckpoint !== null,
      contextWindow: numCtx,
    });
  };

  let fullFinalContent = request.seed?.content ?? "";
  let fullFinalTextContent = request.seed?.textContent ?? "";

  /** Trimming is right for a fresh reply and wrong for a continued one: that space is the only
   * thing keeping the joined words apart. Runaway repetition loops are trimmed first. */
  const cleanText = (raw: string): string => {
    const trimmed = detectRepetition(raw).trimmedText;
    const cleaned = cleanStream ? trimmed.trim() : stripToolSyntax(trimmed);
    if (!cleaned || !request.isContinuation) return cleaned;
    return /^\s/.test(raw) ? " " + cleaned : cleaned;
  };

  const combine = (raw: string, text: string): AgentPatch => ({
    content: fullFinalContent + raw,
    // No separator: a reply cut off mid-word has to be completed, not
    // continued on a new line.
    textContent: joinContinuation(fullFinalTextContent, text),
    steps: [...steps],
  });

  let lastThought = "";
  let lastToolResult = "";
  let answerAsked = false;

  while (!isFinished && loopCount < MAX_TOOL_LOOPS) {
    if (signal.aborted) {
      finishIncompleteSteps();
      host.onPatch(combine("", ""));
      return {
        content: fullFinalContent,
        textContent: fullFinalTextContent,
        steps,
        metrics,
        outOfContext,
        loops: loopCount,
        exhausted: false,
        aborted: true,
        toolCalls,
      };
    }

    loopCount++;

    /** The plan, if any. First pass it catches the model up, which is also how a resumed task
     * restarts; after that only the user's edits are sent. */
    const livePlan = host.getPlan?.() ?? null;

    if (livePlan && livePlan.length > 0 && !samePlan(lastSeenPlan ?? [], livePlan)) {
      wire.push({
        role: "user",
        content:
          lastSeenPlan === null ? describePlan(livePlan) : describeEdit(livePlan),
      });
      lastSeenPlan = livePlan;
    }

    const loopController = new AbortController();
    const abortHandler = () => loopController.abort();
    if (signal.aborted) {
      loopController.abort();
    } else {
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    const thinkStepId = generateId();
    let thinkStartTime: number | null = null;
    let thoughtTime: number | null = null;
    let firstTokenAt: number | null = null;

    pushStep({ id: thinkStepId, type: "thinking", content: "", isComplete: false });

    /** Prose from this pass, shown as a step among the tool activity. On the last pass the step is
     * removed and the text becomes the reply. */
    let textStepId: string | null = null;

    const showText = (value: string) => {
      if (!value.trim()) return;

      if (textStepId === null) {
        textStepId = generateId();
        pushStep({ id: textStepId, type: "text", content: value, isComplete: false });
        return;
      }

      patchStep(textStepId, { content: value });
    };

    // Recomputed each pass as tool results arrive, and asked of the shared
    // tally: a disagreement with the warm-up costs a full reload.
    numCtx = contextSizeFor(
      model,
      estimateChars(wire, nativeTools ? JSON.stringify(definitions).length : 0),
      info?.contextLength ?? null,
      settings.fixedContextSize ?? null,
    );
    // The meter has a figure from the start of each pass, not only once tokens arrive.
    emitLive(0, null);

    // A load is the long silence before the first token, and all it used to
    // show was the typing dots: 15 to 26 s for a 20 GB model on an 8 GB card.
    const loadStepId =
      (await isLoadedAt(model, numCtx)) === false ? generateId() : null;
    if (loadStepId !== null) {
      pushStep({
        id: loadStepId,
        type: "loading",
        content: host.t("loadingModel").replace("{model}", model).replace("{seconds}", "0.0"),
        isComplete: false,
        model,
        startedAt: Date.now(),
      });
    }

    let loading = loadStepId !== null;
    const doneLoading = () => {
      if (!loading) return;
      loading = false;
      dropStep(loadStepId as string);
      syncSteps();
    };

    const requestStart = performance.now();

    logLlamaInference({ model, numCtx, stream: true, nativeThinking, nativeTools }, correlationId);

    try {
      if (typeof window !== "undefined" && window.electronAPI?.gguf) {
        const started = await window.electronAPI.gguf.start({
          modelPath: ggufModelName(model),
          contextSize: numCtx,
        });
        if (!started?.success && !started?.alreadyRunning) {
          throw new Error(engineFailure(started, { markdown: true }));
        }
        noteEngineStart(model, started);
      }

      const requestBody = JSON.stringify({
        model: ggufModelName(model),
        stream: true,
        options: { num_ctx: numCtx, num_predict: -1 },
        messages: toLlamaMessages(wire),
        // llama-server ignores `think`; the template option is what switches the reasoning on or off.
        ...(hasThinkingCapability
          ? { think: nativeThinking, chat_template_kwargs: { enable_thinking: nativeThinking } }
          : {}),
        ...(nativeTools ? { tools: definitions } : {}),
      });

      let response: Response;
      try {
        response = await loggedFetch(
          "http://127.0.0.1:11435/v1/chat/completions",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: requestBody,
            signal: loopController.signal,
          },
          correlationId,
        );
      } catch (error) {
        // A refused connection is a TypeError; an abort must keep its own name so stopping stays quiet.
        if (error instanceof TypeError) {
          throw new Error(engineUnreachable({ markdown: true }), { cause: error });
        }
        throw error;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(engineFailure(ggufErrorMessage(errorText, response.statusText), { markdown: true }));
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response");

      let rawChunk = "";
      let thinkingText = "";
      let currentThought = "";
      let textContent = "";
      let toolMatch: string | null = null;
      let maybeToolCall = false;
      let lastUpdateTime = performance.now();
      let lastEmittedLength = -1;

      const nativeCalls: LlamaToolCall[] = [];
      let passChunks = 0;
      let finalChunk: Record<string, unknown> | null = null;

      const readChunk = (parsed: LlamaChunk) => {
        if (parsed.message?.tool_calls) nativeCalls.push(...parsed.message.tool_calls);
        if (parsed.done) {
          finalChunk = { ...(finalChunk || {}), ...(parsed as unknown as Record<string, unknown>) };
          if (parsed.done_reason === "length") outOfContext = true;
        }
      };

      const readStream = async function* () {
        for await (const chunk of sseToLlamaChunks(reader)) {
          yield chunk as LlamaChunk;
        }
      };

      try {
        for await (const parsed of readStream()) {
          doneLoading();
          const added = parsed.message?.content || "";
          const thinkingAdded = parsed.message?.thinking || "";
          if (added || thinkingAdded) passChunks++;
          readChunk(parsed);

          if ((added || thinkingAdded) && firstTokenAt === null) {
            firstTokenAt = performance.now();
          }

          if (thinkingAdded) {
            if (thinkStartTime === null) thinkStartTime = performance.now();
            thinkingText += thinkingAdded;
          }

          if (added) {
            logStreamChunk(added, correlationId);

            if (nativeThinking && thinkStartTime !== null && thoughtTime === null) {
              thoughtTime = (performance.now() - thinkStartTime) / 1000;
            }

            const scanFrom = Math.max(0, rawChunk.length - TOOL_MARKER_OVERLAP);
            rawChunk += added;

            if (!nativeThinking) {
              if (thinkStartTime === null && /<\/?think>/i.test(rawChunk)) {
                thinkStartTime = performance.now();
              }
              if (
                thoughtTime === null &&
                thinkStartTime !== null &&
                rawChunk.includes("</think>")
              ) {
                thoughtTime = (performance.now() - thinkStartTime) / 1000;
              }
            }

            if (
              !nativeTools &&
              !maybeToolCall &&
              TOOL_MARKER_RE.test(rawChunk.slice(scanFrom))
            ) {
              maybeToolCall = true;
            }

            // Break degenerate model repetition loops before runaway output.
            const loopCheck = detectRepetition(rawChunk);
            if (loopCheck.hasLoop) {
              rawChunk = loopCheck.trimmedText;
              loopController.abort();
              break;
            }
          }

          if (!nativeTools && maybeToolCall) {
            toolMatch = detectToolCall(rawChunk);
            if (toolMatch) {
              loopController.abort();
              break;
            }
          }

          const now = performance.now();
          const emitted = rawChunk.length + thinkingText.length;

          if (
            now - lastUpdateTime > STREAM_UI_INTERVAL_MS &&
            emitted !== lastEmittedLength
          ) {
            lastUpdateTime = now;
            lastEmittedLength = emitted;

            currentThought = nativeThinking
              ? thinkingText
              : (extractThought(rawChunk) ?? currentThought);
            textContent = cleanText(rawChunk);

            patchStep(thinkStepId, {
              content: currentThought,
              thoughtTime:
                thoughtTime ??
                (thinkStartTime !== null
                  ? (performance.now() - thinkStartTime) / 1000
                  : undefined),
            });

            // The reply body only ever holds text from passes that are already
            // finished; whatever is being written now belongs to the timeline.
            showText(textContent);
            host.onPatch(combine("", ""));
            emitLive(passChunks, firstTokenAt);
          }
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.name !== "AbortError") throw error;
      }

      if (finalChunk) {
        const turnMetrics = readMetrics(
          finalChunk,
          model,
          numCtx,
          firstTokenAt === null ? null : firstTokenAt - requestStart,
        );
        if (turnMetrics) logLlamaMetrics(turnMetrics, correlationId);
        metrics = mergeMetrics(metrics, turnMetrics);

        // The real counts for this pass: the checkpoint the meter and the speed line snap to.
        const counts = finalChunk as Record<string, unknown>;
        const promptTokens = Number(counts.prompt_eval_count) || 0;
        const writtenTokens = Number(counts.eval_count) || 0;
        if (passChunks > 0 && writtenTokens > 0) {
          tokensPerChunk = Math.min(1.5, Math.max(1, writtenTokens / passChunks));
        }
        finishedTokens += writtenTokens || passChunks;
        if (turnMetrics && turnMetrics.tokensPerSecond > 0) liveRate = turnMetrics.tokensPerSecond;
        if (promptTokens > 0) {
          contextCheckpoint = {
            tokens: promptTokens + writtenTokens,
            chars: estimateChars(wire) + rawChunk.length + thinkingText.length,
          };
        }
        emitLive(0, null, true);
      }

      currentThought = nativeThinking
        ? thinkingText
        : (extractThought(rawChunk) ?? currentThought);
      if (!nativeTools && !toolMatch) toolMatch = detectToolCall(rawChunk);
      const postLoop = detectRepetition(rawChunk);
      if (postLoop.hasLoop) rawChunk = postLoop.trimmedText;
      textContent = cleanText(rawChunk);

      // A reply that was trying to be a tool call and came out mangled: worth
      // one constrained retry before it is shown to the user as prose.
      if (
        !nativeTools &&
        toolMatch === null &&
        looksLikeCall(rawChunk, definitions.map((one) => one.function.name))
      ) {
        const repaired = await repairCall(
          rawChunk,
          definitions,
          loopController.signal,
        );
        if (repaired.name) {
          toolMatch = JSON.stringify({
            name: repaired.name,
            args: repaired.args ?? {},
          });
        }
      }

      const pendingCalls = nativeTools ? nativeCalls : [];
      const hasToolCall = nativeTools ? pendingCalls.length > 0 : toolMatch !== null;

      if (signal.aborted) {
        // Stopping mid-sentence should keep what was already written.
        if (textStepId !== null) dropStep(textStepId);
        finishIncompleteSteps();
        host.onPatch(combine("", ""));
        return {
          content: fullFinalContent + rawChunk,
          textContent: textContent
            ? joinContinuation(fullFinalTextContent, textContent)
            : fullFinalTextContent,
          steps,
          metrics,
          outOfContext,
          loops: loopCount,
          exhausted: false,
          aborted: true,
          toolCalls,
        };
      }

      if (thinkStartTime !== null && thoughtTime === null) {
        thoughtTime = (performance.now() - thinkStartTime) / 1000;
      }

      const thinkIndex = steps.findIndex((entry) => entry.id === thinkStepId);
      if (thinkIndex !== -1) {
        if (!currentThought.trim()) {
          steps.splice(thinkIndex, 1);
        } else {
          steps[thinkIndex] = {
            ...steps[thinkIndex],
            content: currentThought,
            thoughtTime: thoughtTime || 0,
            isComplete: true,
          };
        }
      }

      // A retry pass that reasons nothing must not wipe the thought the fallback reply is built from.
      if (currentThought.trim()) lastThought = currentThought;
      host.onOutOfContext(outOfContext);

      if (!hasToolCall) {
        // Asked once only: a model that stays silent twice would otherwise burn every remaining loop.
        if (
          !textContent.trim() &&
          !answerAsked &&
          loopCount < MAX_TOOL_LOOPS &&
          (thinkingText.trim() || wire.some((m) => m.role === "tool"))
        ) {
          answerAsked = true;
          const kept = nativeThinking && thinkingText.trim() ? { thinking: thinkingText } : {};
          wire.push({ role: "assistant", content: rawChunk || " ", ...kept });
          wire.push({
            role: "user",
            content:
              "Please provide your final answer to the user based on your reasoning and the gathered information.",
          });
          continue;
        }

        // Nothing follows this, so it is the reply. It moves out of the
        // timeline and into the message body.
        if (textStepId !== null) dropStep(textStepId);

        isFinished = true;
        fullFinalContent += rawChunk;
        if (textContent) {
          fullFinalTextContent = joinContinuation(fullFinalTextContent, textContent);
        }
        host.onPatch(combine("", ""));
        continue;
      }

      // A tool call follows, so this text stays where the model wrote it.
      showText(textContent);
      if (textStepId !== null) {
        patchStep(textStepId, { content: textContent, isComplete: true });
      }

      fullFinalContent += rawChunk + "\n";
      host.onPatch(combine("", ""));

      // The reasoning goes back with the call, since a model that cannot see
      // it reasoned before one stops reasoning before the next.
      const kept = nativeThinking && thinkingText.trim() ? { thinking: thinkingText } : {};

      if (nativeTools) {
        wire.push({ role: "assistant", content: rawChunk, ...kept, tool_calls: pendingCalls });

        for (const call of pendingCalls) {
          if (signal.aborted) break;
          const result = await runGuardedTool(
            call.function?.name || "",
            call.function?.arguments || {},
          );
          if (signal.aborted) break;
          lastToolResult = result;
          wire.push({
            role: "tool",
            content: result,
            tool_call_id: call.id,
            tool_name: call.function?.name || "",
          });
        }
      } else {
        wire.push({ role: "assistant", content: rawChunk, ...kept });
        let { name, args } = parseToolCall(toolMatch as string);

        if (!name && !signal.aborted) {
          const repaired = await repairCall(
            toolMatch as string,
            definitions,
            loopController.signal,
          );
          name = repaired.name;
          args = repaired.args;
        }

        if (!signal.aborted) {
          const result = await runGuardedTool(name || "", args || {});
          lastToolResult = result;
          wire.push({ role: "user", content: result });
        }
      }

      if (signal.aborted) {
        if (textStepId !== null) dropStep(textStepId);
        finishIncompleteSteps();
        host.onPatch(combine("", ""));
        return {
          content: fullFinalContent + rawChunk,
          textContent: textContent
            ? joinContinuation(fullFinalTextContent, textContent)
            : fullFinalTextContent,
          steps,
          metrics,
          outOfContext,
          loops: loopCount,
          exhausted: false,
          aborted: true,
          toolCalls,
        };
      }

      // Tool results went in after the last count, so until the next pass ends this is an estimate.
      emitLive(0, null);
    } finally {
      doneLoading();
      signal.removeEventListener("abort", abortHandler);
    }
  }

  const exhausted = !isFinished && loopCount >= MAX_TOOL_LOOPS;

  if (exhausted) {
    for (let i = 0; i < steps.length; i++) {
      if (!steps[i].isComplete) steps[i] = { ...steps[i], isComplete: true };
    }
    if (!fullFinalTextContent) fullFinalTextContent = EXHAUSTED_MESSAGE;
    host.onSteps([...steps]);
  } else if (!fullFinalTextContent.trim() && !signal.aborted) {
    // A blank bubble reads as a crash; the thought, or failing that the tool output, beats it.
    fullFinalTextContent = lastThought.trim() || lastToolResult.trim().slice(0, FALLBACK_RESULT_CHARS);
  }

  if (!signal.aborted) host.onPatch(combine("", ""));

  if (metrics) {
    metrics = {
      ...metrics,
      gpuPercent: await gpuShareFor(model),
      breakdown: measureBreakdown(
        promptParts,
        metrics.promptTokens + metrics.responseTokens,
      ),
    };
    host.onMetrics?.(metrics);
  }

  logAgentStep(
    "turn_complete",
    {
      loops: loopCount,
      outOfContext,
      exhausted,
      aborted: signal.aborted,
      toolCalls,
      totalTokens: metrics ? metrics.promptTokens + metrics.responseTokens : 0,
    },
    correlationId,
  );

  return {
    content: fullFinalContent,
    textContent: fullFinalTextContent,
    steps,
    metrics,
    outOfContext,
    loops: loopCount,
    exhausted,
    aborted: signal.aborted,
    toolCalls,
  };
}
