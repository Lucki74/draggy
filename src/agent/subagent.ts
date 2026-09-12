import { runAgentTurn } from "./agentLoop";
import type { AgentHost } from "./agentLoop";
import type { ToolEnvironment } from "../tools/registry";
import type { InstalledModel } from "../ollama";
import type { AppSettings, Message } from "../types";

/**
 * A second, smaller model sent to look something up. Exploring a project means
 * reading a dozen files to use two of them, and doing that in the main
 * conversation spends the context the answer needs on the search for it.
 *
 * What comes back is a summary. What it can do is read: the nested turn runs in
 * plan mode, which the permission engine already defines as "changes nothing".
 */

/** How long an exploration may run before the answer stops being worth it. */
export const EXPLORE_TIMEOUT_MS = 120000;

const EXPLORE_PROMPT = `You are looking something up for another assistant, not talking to a person.

Read what you need with the tools you have, then answer in at most fifteen lines: what you found, and the files and line numbers it is in. No preamble, no offer to help further, no code unless a few lines are the answer.

If the project does not contain what was asked about, say exactly that.`;

/**
 * The model that does the looking. A smaller one reads a directory listing as
 * well as a large one and returns in a third of the time, so the smallest
 * installed model that can still call tools wins. Ties go to the one already
 * running, which costs no load at all.
 */
export function pickExploreModel(
  installed: InstalledModel[],
  current: string,
): string {
  const capable = installed.filter(
    (model) =>
      model.capabilities.includes("tools") &&
      !model.capabilities.includes("embedding") &&
      model.size > 0,
  );

  if (capable.length === 0) return current;

  const running = capable.find((model) => model.name === current);
  const smallest = capable.reduce((best, model) =>
    model.size < best.size ? model : best,
  );

  // Only worth a second model if it is meaningfully smaller than the one
  // already loaded; otherwise the swap costs more than the search saves.
  if (running && smallest.size > running.size * 0.6) return current;

  return smallest.name;
}

export interface ExploreRequest {
  question: string;
  model: string;
  settings: AppSettings;
  environment: ToolEnvironment;
  workspaceId?: string;
  signal: AbortSignal;
}

/**
 * Runs the nested turn. The environment it is handed is the parent's with two
 * changes: read-only tools, and no way to start another exploration from
 * inside this one.
 */
export async function explore(request: ExploreRequest): Promise<string> {
  const environment: ToolEnvironment = {
    ...request.environment,
    readOnlyTools: true,
  };

  const messages: Message[] = [
    { id: "explore-1", role: "user", content: request.question },
  ];

  // Nothing it does reaches the conversation: no steps, no metrics, no plan.
  const host: AgentHost = {
    t: (key) => key,
    onPatch: () => {},
    onSteps: () => {},
    onOutOfContext: () => {},
  };

  const timer = new AbortController();
  const stop = setTimeout(() => timer.abort(), EXPLORE_TIMEOUT_MS);

  const linked = AbortSignal.any([request.signal, timer.signal]);

  try {
    const result = await runAgentTurn(
      {
        model: request.model,
        settings: {
          ...request.settings,
          // The looking is not the thinking, and a small model reasoning about
          // a directory listing is the slowest part of the whole exercise.
          thinkingMode: "low",
          customInstructions: [EXPLORE_PROMPT],
        },
        environment,
        messages,
        workspaceId: request.workspaceId,
        permission: { mode: "plan", grants: [] },
        signal: linked,
      },
      host,
    );

    const answer = result.textContent.trim();
    return answer || "That search came back with nothing.";
  } catch (error) {
    if (timer.signal.aborted) {
      return "That search took too long and was stopped. Ask something narrower.";
    }

    return `That search failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    clearTimeout(stop);
  }
}
