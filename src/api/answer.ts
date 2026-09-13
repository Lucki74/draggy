import { runAgentTurn } from "../agent/agentLoop";
import { generateId } from "../utils";
import type { AgentHost, AgentRequest, AgentResult } from "../agent/agentLoop";
import type { ToolEnvironment } from "../tools/registry";
import type {
  ApiCompletionRequest,
  ApiCompletionResult,
  AppSettings,
  Message,
} from "../types";

/** A local API request, answered by the chat's loop but trusted only with the web: no folder, code,
 * documents, extensions, or anything needing approval. */

export interface AnswerDependencies {
  /** The model Draggy is using, for a request that names none it has. */
  model: string | null;
  /** What is installed, to tell a real model name from a client's default. */
  installed: string[] | null;
  settings: AppSettings;
  t: (key: string) => string;
  signal: AbortSignal;
  /** Text as it arrives, for a streamed reply. Only ever appended to. */
  onText?: (text: string) => void;
  /** Which model ended up answering. */
  onModel?: (model: string) => void;
  run?: (request: AgentRequest, host: AgentHost) => Promise<AgentResult>;
}

/** The model a request gets. A client configured for OpenAI sends "gpt-4o" by default; that means
 * "whatever you have", not a download. */
export function pickModel(
  requested: string,
  current: string | null,
  installed: string[] | null,
): string | null {
  const wanted = requested.trim();
  if (wanted && (installed === null || installed.includes(wanted))) return wanted;
  return current;
}

/** The next streamed piece. A stream cannot take words back, so if the loop rewrote sent text
 * nothing more goes until it grows past it again. */
export function nextDelta(sent: string, text: string): string {
  if (!text.startsWith(sent)) return "";
  return text.slice(sent.length);
}

export async function answerApiRequest(
  request: ApiCompletionRequest,
  deps: AnswerDependencies,
): Promise<ApiCompletionResult> {
  const model = pickModel(request.model, deps.model, deps.installed);
  if (!model) throw new Error("No model is selected in Draggy yet.");

  deps.onModel?.(model);

  // The caller's system messages are its instructions; the user's own custom
  // instructions are for the user's own conversations.
  const instructions = request.messages
    .filter((message) => message.role === "system" && message.content.trim())
    .map((message) => message.content);

  const messages: Message[] = request.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      id: generateId(),
      role: message.role,
      content: message.content,
      ...(message.role === "assistant" ? { textContent: message.content } : {}),
    }));

  const environment: ToolEnvironment = {
    webMode: deps.settings.webMode,
    codeExecution: false,
    libraryReady: false,
    hasFolder: false,
    hasSkills: false,
    hasGit: false,
    allowedGroups: ["web"],
  };

  let sent = "";
  const emit = (text: string | undefined) => {
    if (!deps.onText || typeof text !== "string") return;
    const delta = nextDelta(sent, text);
    if (!delta) return;
    sent += delta;
    deps.onText(delta);
  };

  const run = deps.run ?? runAgentTurn;

  const result = await run(
    {
      model,
      settings: { ...deps.settings, customInstructions: instructions },
      environment,
      messages,
      isContinuation: false,
      seed: null,
      compaction: null,
      // Ask mode with nobody to ask: anything that is not read-only is refused
      // with a message the model can pass on, rather than run.
      permission: { mode: "ask", grants: [] },
      signal: deps.signal,
    },
    {
      t: deps.t,
      onSteps: () => {},
      onOutOfContext: () => {},
      onPatch: (patch) => emit(patch.textContent),
    },
  );

  if (deps.signal.aborted) throw new Error("The request was cancelled.");

  emit(result.textContent);

  return {
    model,
    content: result.textContent,
    usage: {
      promptTokens: result.metrics?.promptTokens ?? 0,
      responseTokens: result.metrics?.responseTokens ?? 0,
    },
  };
}
