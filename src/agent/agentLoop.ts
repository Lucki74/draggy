import {
  KEEP_ALIVE,
  OLLAMA_HOST,
  contextSizeFor,
  getModelInfo,
  gpuShareFor,
  hasCapability,
  mergeMetrics,
  readMetrics,
} from "../ollama";
import type { GenerationMetrics } from "../ollama";
import { buildSystemPrompt, currentTimeNote } from "../prompts";
import { renderCompactionBlock } from "./compaction";
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
import { runTool, toolDefinitions } from "../tools/registry";
import type { ToolContext, ToolEnvironment } from "../tools/registry";
import { generateId, isBinary, safeJsonParse } from "../utils";
import type { AppSettings, CompactionState, Message, SearchStep } from "../types";

// Re-exported for the screens that warm the model with the same value.
export { KEEP_ALIVE };

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

interface OllamaChunk {
  message?: {
    content?: string;
    thinking?: string;
    tool_calls?: OllamaToolCall[];
  };
  done?: boolean;
  done_reason?: string;
}

export interface WireMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

export function toWireMessage(message: Message, allowImages: boolean): WireMessage {
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

  return {
    role: message.role,
    content: content.trim() || " ",
    ...(images.length > 0 ? { images } : {}),
  };
}

export function estimateChars(messages: WireMessage[]): number {
  return messages.reduce(
    (total, message) =>
      total + message.content.length + (message.images?.length || 0) * 4000,
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
  signal: AbortSignal;
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
}

const EXHAUSTED_MESSAGE =
  "I apologize, but I reached the maximum number of search steps without finding a definitive final answer.";

export async function runAgentTurn(
  request: AgentRequest,
  host: AgentHost,
): Promise<AgentResult> {
  const { model, settings, environment, messages, signal } = request;

  const steps: SearchStep[] = [...(request.seed?.steps ?? [])];

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

  const toolContext: ToolContext = {
    t: host.t,
    settings,
    pushStep,
    patchStep,
    syncSteps,
    newId: generateId,
    signal,
    memo: new Map<string, unknown>(),
  };

  const info = await getModelInfo(model);

  const nativeTools = hasCapability(info, "tools");
  const nativeVision = hasCapability(info, "vision");
  const hasThinkingCapability = hasCapability(info, "thinking");
  const nativeThinking = hasThinkingCapability && settings.thinkingMode !== "low";
  const cleanStream = nativeTools && nativeThinking;

  const systemPrompt = buildSystemPrompt(
    settings,
    { nativeTools, nativeThinking },
    environment,
  );
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

  const wire: WireMessage[] = [
    { role: "system", content: systemPrompt },
    ...(compaction
      ? [{ role: "user" as const, content: renderCompactionBlock(compaction) }]
      : []),
    ...carried.map((message) => toWireMessage(message, nativeVision)),
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

  // The clock goes at the tail, where changing it costs nothing. In the system
  // prompt it ended the cached prefix, re-evaluating the chat every turn.
  const lastUserIndex = wire.map((entry) => entry.role).lastIndexOf("user");
  if (lastUserIndex !== -1) {
    wire[lastUserIndex] = {
      ...wire[lastUserIndex],
      content: `${wire[lastUserIndex].content}

${currentTimeNote()}`,
    };
  }

  let loopCount = 0;
  let isFinished = false;
  let outOfContext = false;
  // Assigned on the first pass of the loop below, which always runs.
  let numCtx: number;
  let metrics: GenerationMetrics | null = null;

  let fullFinalContent = request.seed?.content ?? "";
  let fullFinalTextContent = request.seed?.textContent ?? "";

  /**
   * Trimming is right for a fresh reply and wrong for a continued one: that
   * space is the only thing keeping the joined words apart.
   */
  const cleanText = (raw: string): string => {
    const cleaned = cleanStream ? raw.trim() : stripToolSyntax(raw);
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

  while (!isFinished && loopCount < MAX_TOOL_LOOPS) {
    loopCount++;

    const loopController = new AbortController();
    const abortHandler = () => loopController.abort();
    signal.addEventListener("abort", abortHandler);

    const thinkStepId = generateId();
    let thinkStartTime: number | null = null;
    let thoughtTime: number | null = null;
    let firstTokenAt: number | null = null;

    pushStep({ id: thinkStepId, type: "thinking", content: "", isComplete: false });

    /**
     * Prose from this pass, shown as a step among the tool activity. On the
     * last pass the step is removed and the text becomes the reply.
     */
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
      estimateChars(wire),
      info?.contextLength ?? null,
    );

    const requestStart = performance.now();

    try {
      const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: true,
          keep_alive: KEEP_ALIVE,
          options: { num_ctx: numCtx, num_predict: -1 },
          messages: wire,
          // Explicit false, not merely the absence of true: left to its own
          // template a capable model reasons anyway, which Fast mode forbids.
          ...(hasThinkingCapability ? { think: nativeThinking } : {}),
          ...(nativeTools ? { tools: definitions } : {}),
        }),
        signal: loopController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const parsed = safeJsonParse<{ error?: string }>(errorText);
        throw new Error(
          `Ollama Error: ${parsed?.error || errorText || response.statusText}`,
        );
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response");

      const decoder = new TextDecoder();

      let rawChunk = "";
      let thinkingText = "";
      let currentThought = "";
      let textContent = "";
      let streamBuffer = "";
      let toolMatch: string | null = null;
      let maybeToolCall = false;
      let lastUpdateTime = performance.now();
      let lastEmittedLength = -1;

      const nativeCalls: OllamaToolCall[] = [];
      let finalChunk: Record<string, unknown> | null = null;

      const readChunk = (parsed: OllamaChunk) => {
        if (parsed.message?.tool_calls) nativeCalls.push(...parsed.message.tool_calls);
        if (parsed.done) {
          finalChunk = parsed as unknown as Record<string, unknown>;
          if (parsed.done_reason === "length") outOfContext = true;
        }
      };

      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;

          streamBuffer += decoder.decode(value, { stream: true });
          const lines = streamBuffer.split("\n");
          streamBuffer = lines.pop() || "";

          let added = "";
          let thinkingAdded = "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const parsed = safeJsonParse<OllamaChunk>(trimmed);
            if (!parsed) continue;
            if (parsed.message?.content) added += parsed.message.content;
            if (parsed.message?.thinking) thinkingAdded += parsed.message.thinking;
            readChunk(parsed);
          }

          if ((added || thinkingAdded) && firstTokenAt === null) {
            firstTokenAt = performance.now();
          }

          if (thinkingAdded) {
            if (thinkStartTime === null) thinkStartTime = performance.now();
            thinkingText += thinkingAdded;
          }

          if (added) {
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
          }
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.name !== "AbortError") throw error;
      }

      if (streamBuffer) {
        const parsed = safeJsonParse<OllamaChunk>(streamBuffer);
        if (parsed) {
          if (parsed.message?.content) rawChunk += parsed.message.content;
          if (parsed.message?.thinking) thinkingText += parsed.message.thinking;
          readChunk(parsed);
        }
      }

      if (finalChunk) {
        const turnMetrics = readMetrics(
          finalChunk,
          model,
          numCtx,
          firstTokenAt === null ? null : firstTokenAt - requestStart,
        );
        metrics = mergeMetrics(metrics, turnMetrics);
      }

      currentThought = nativeThinking
        ? thinkingText
        : (extractThought(rawChunk) ?? currentThought);
      if (!nativeTools && !toolMatch) toolMatch = detectToolCall(rawChunk);
      textContent = cleanText(rawChunk);

      const pendingCalls = nativeTools ? nativeCalls : [];
      const hasToolCall = nativeTools ? pendingCalls.length > 0 : toolMatch !== null;

      if (signal.aborted && !hasToolCall) {
        // Stopping mid-sentence should keep what was already written.
        if (textStepId !== null) dropStep(textStepId);
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

      host.onOutOfContext(outOfContext);

      if (!hasToolCall) {
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

      if (nativeTools) {
        wire.push({ role: "assistant", content: rawChunk, tool_calls: pendingCalls });

        for (const call of pendingCalls) {
          const result = await runTool(
            call.function?.name || "",
            call.function?.arguments || {},
            toolContext,
            environment,
          );
          wire.push({
            role: "tool",
            content: result,
            tool_name: call.function?.name || "",
          });
        }
      } else {
        wire.push({ role: "assistant", content: rawChunk });
        const { name, args } = parseToolCall(toolMatch as string);
        const result = await runTool(name || "", args || {}, toolContext, environment);
        wire.push({ role: "user", content: result });
      }
    } finally {
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
  }

  if (metrics) {
    metrics = { ...metrics, gpuPercent: await gpuShareFor(model) };
    host.onMetrics?.(metrics);
  }

  return {
    content: fullFinalContent,
    textContent: fullFinalTextContent,
    steps,
    metrics,
    outOfContext,
    loops: loopCount,
    exhausted,
    aborted: signal.aborted,
  };
}
