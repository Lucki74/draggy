import { registerTools } from "./registry";
import type { ToolSpec } from "./registry";
import { defaultProjectPath } from "../images/imageCommand";
import { applyImageProgress, finishImageStep, runImageJob } from "../images/imageJob";
import { imageFailure } from "../ai/engineErrors";
import { generateId } from "../utils";
import type { ImageRequest, ImageStepInfo, SearchStep } from "../types";

/** Pictures from the local image engine. The model gets back where the file went, never its bytes. */

const numberArg = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return value === undefined || value === null || value === "" || !Number.isFinite(parsed) ? undefined : parsed;
};

const generateImage: ToolSpec = {
  name: "generate_image",
  group: "image",
  description:
    "Draw a picture from a description with the local image engine. In a project it saves the file there; otherwise it goes to the user's created files. Describe the subject, style and composition in plain words.",
  parameters: {
    prompt: { type: "string", description: "What the picture shows, in detail: subject, setting, style, lighting." },
    path: {
      type: "string",
      description: "Projects only: where to save it, relative to the project folder, ending in .png, .jpg or .webp. Defaults to assets/generated/<name>.png.",
    },
    negative_prompt: { type: "string", description: "What the picture should not contain." },
    width: { type: "integer", description: "Width in pixels, a multiple of 64. Leave out for the model's default." },
    height: { type: "integer", description: "Height in pixels, a multiple of 64. Leave out for the model's default." },
    steps: { type: "integer", description: "Sampling steps. Leave out for the model's default." },
    seed: { type: "integer", description: "A seed, to make the same picture again. Leave out for a new one." },
    source: { type: "string", description: "Projects only: an existing picture in the project to start from, for a variation of it." },
    strength: { type: "number", description: "With source: how far to move away from it, 0 to 1. Defaults to 0.75." },
    overwrite: { type: "boolean", description: "Set to true only when the user asked to replace an existing file at that path." },
  },
  required: ["prompt"],
  usage: '{"prompt": "a watercolor fox in a snowy forest"} → saves a picture and says where',
  annotations: {},
  available: (environment) => Boolean(environment.imageReady),
  run: async (args, ctx) => {
    const prompt = String(args.prompt).trim();
    const inProject = Boolean(ctx.environment?.hasFolder);
    const workspaceId = ctx.workspaceId || "default";
    const target = inProject ? String(args.path || "").trim() || defaultProjectPath(prompt) : undefined;

    const requestId = generateId();
    const stepId = ctx.newId();
    let info: ImageStepInfo = {
      prompt,
      status: "loading-model",
      requestId,
      workspaceId: inProject ? workspaceId : undefined,
      width: numberArg(args.width),
      height: numberArg(args.height),
      startedAt: Date.now(),
    };
    const stepOf = (current: ImageStepInfo): SearchStep => ({
      id: stepId,
      type: "image",
      content: current.prompt,
      isComplete: !["loading-model", "queued", "generating"].includes(current.status),
      image: current,
    });

    ctx.pushStep(stepOf(info));

    const request: ImageRequest = {
      requestId,
      prompt,
      negativePrompt: args.negative_prompt ? String(args.negative_prompt) : undefined,
      width: numberArg(args.width),
      height: numberArg(args.height),
      steps: numberArg(args.steps),
      seed: numberArg(args.seed),
      strength: numberArg(args.strength),
      fitModel: true,
      init: inProject && args.source ? { kind: "project", workspaceId, path: String(args.source) } : undefined,
      destination: inProject
        ? { kind: "project", workspaceId, path: target as string, chatId: ctx.chatId, overwrite: args.overwrite === true || args.overwrite === "true" }
        : { kind: "chat" },
    };

    const result = await runImageJob(request, {
      signal: ctx.signal,
      onProgress: (progress) => {
        info = applyImageProgress(info, progress);
        ctx.patchStep(stepId, stepOf(info));
        ctx.syncSteps();
      },
    });

    info = finishImageStep(info, result, inProject ? "project" : "created", (failed) => imageFailure(failed, { markdown: true }));
    ctx.patchStep(stepId, {
      ...stepOf(info),
      ...(result.checkpointId !== undefined ? { checkpointId: result.checkpointId, filepath: result.path } : {}),
    });
    ctx.syncSteps();

    if (result.success) {
      const size = result.width && result.height ? ` (${result.width}x${result.height}, seed ${result.seed})` : "";
      return `TOOL RESULT (generate_image): Saved ${result.path}${size}. The user can already see the picture; do not describe it as if they cannot.`;
    }
    if (result.code === "E_CANCELLED") return "TOOL RESULT (generate_image): The user stopped the image before it was finished.";
    if (result.code === "E_EXISTS") {
      return `TOOL RESULT (generate_image): ${result.params?.path || target} already exists. Choose another path, or set overwrite to true only if the user asked to replace it.`;
    }
    return `TOOL RESULT (generate_image): Failed - ${result.error || result.code}`;
  },
};

export const IMAGE_TOOLS: ToolSpec[] = [generateImage];

export function registerImageTools(): void {
  registerTools(IMAGE_TOOLS);
}
