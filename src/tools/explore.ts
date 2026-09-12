import { registerTools } from "./registry";
import type { ToolSpec } from "./registry";
import { explore, pickExploreModel } from "../agent/subagent";
import { listInstalledModels } from "../ollama";

/**
 * Sending a smaller model to look something up. The point is context: a search
 * through twenty files costs the conversation nothing but the answer, because
 * the reading happens somewhere else and only the summary comes back.
 */

const exploreTool: ToolSpec = {
  name: "explore",
  group: "agent",
  description:
    "Send a second, smaller model to look something up in the project and report back. Use it for questions like where something is defined or how a part of the code fits together, when finding out would take several reads. It can only read, and it answers in a few lines.",
  parameters: {
    question: {
      type: "string",
      description:
        "What to find out, in one sentence, as you would ask a colleague who has the project open.",
    },
  },
  required: ["question"],
  usage:
    '{"question": "Where is the permission engine called from?"} → a short answer with the files it is in',
  annotations: { readOnly: true },
  // Only where there is something to explore, and never from inside an
  // exploration: one level is a search, two is a maze.
  available: (environment) =>
    Boolean(environment.hasFolder) && !environment.readOnlyTools,
  run: async (args, ctx) => {
    const question = String(args.question);
    const stepId = ctx.newId();

    ctx.pushStep({
      id: stepId,
      type: "searching",
      content: `${ctx.t("exploring")} ${question}`,
      isComplete: false,
    });

    const installed = await listInstalledModels().catch(() => []);
    const model = pickExploreModel(installed, ctx.settings.modelName);

    const answer = await explore({
      question,
      model,
      settings: ctx.settings,
      environment: ctx.environment ?? {
        webMode: ctx.settings.webMode,
        codeExecution: false,
        libraryReady: false,
        hasFolder: true,
        projectRoot: ctx.projectRoot,
      },
      workspaceId: ctx.workspaceId,
      signal: ctx.signal,
    });

    ctx.patchStep(stepId, {
      isComplete: true,
      content: `${ctx.t("explored")} ${question}`,
    });
    ctx.syncSteps();

    return `TOOL RESULT (explore):\n${answer}`;
  },
};

export const EXPLORE_TOOLS: ToolSpec[] = [exploreTool];

export function registerExploreTools(): void {
  registerTools(EXPLORE_TOOLS);
}
