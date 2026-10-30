import { registerTools } from "./registry";
import type { ToolSpec } from "./registry";
import { defaultProjectPath } from "../images/imageCommand";
import { applyImageProgress, finishImageStep, runImageJob } from "../images/imageJob";
import { imageFailure } from "../ai/engineErrors";
import { generateId } from "../utils";
import { referenceFor, referenceStrength } from "../images/imageTracker";
import type { TrackedImage } from "../images/imageTracker";
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
    reference_image: {
      type: "string",
      description: "The ID of a picture in this chat (such as img_2) to start from, to change a small detail and keep the rest. Describe the whole picture with the change in prompt.",
    },
    strength: {
      type: "number",
      description: "With reference_image or source: how far to move away from it, 0 to 1. Defaults to 0.35 with reference_image, 0.75 with source. Raise it for a bigger change.",
    },
    overwrite: { type: "boolean", description: "Set to true only when the user asked to replace an existing file at that path." },
  },
  required: ["prompt"],
  usage: '{"prompt": "a watercolor fox in a snowy forest"} → saves a picture and says where',
  annotations: {
    readOnly: false,
    readOnlyHint: false,
    destructive: false,
    destructiveHint: false,
    idempotent: false,
    idempotentHint: false,
    openWorld: false,
    openWorldHint: false,
  },
  available: (environment) => Boolean(environment.imageReady),
  run: async (args, ctx) => {
    const prompt = String(args.prompt).trim();
    const inProject = Boolean(ctx.environment?.hasFolder);
    const workspaceId = ctx.workspaceId || "default";
    const target = inProject ? String(args.path || "").trim() || defaultProjectPath(prompt) : undefined;

    const images = ctx.images ?? [];
    const wantedReference = args.reference_image === undefined || args.reference_image === null || args.reference_image === "" ? null : String(args.reference_image);
    const reference = wantedReference ? referenceFor(images, wantedReference) : null;
    if (wantedReference && !reference) {
      const known = images.map((image) => image.id).join(", ");
      return `TOOL RESULT (generate_image): There is no picture ${wantedReference} in this chat.${known ? ` Pictures: ${known}.` : " No picture has been made or attached yet."}`;
    }

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
      reference: reference?.image.id,
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
      strength: referenceStrength(Boolean(reference), numberArg(args.strength)),
      fitModel: true,
      init: reference ? reference.init : inProject && args.source ? { kind: "project", workspaceId, path: String(args.source) } : undefined,
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
      const tracked: TrackedImage = {
        id: `img_${images.length + 1}`,
        origin: "generated",
        messageId: "",
        label: prompt,
        width: result.width,
        height: result.height,
        seed: result.seed,
        path: result.path,
        location: inProject ? "project" : "created",
        workspaceId: inProject ? workspaceId : undefined,
      };
      ctx.images = [...images, tracked];
      const size = result.width && result.height ? ` (${result.width}x${result.height}, seed ${result.seed})` : "";
      const dropped = result.referenceDropped
        ? ` The reference ${reference?.image.id ?? "picture"} was not used, because this image model cannot start from a picture or the file was gone, so it was drawn from the prompt alone. Tell the user.`
        : "";
      return `TOOL RESULT (generate_image): Saved ${result.path} as ${tracked.id}${size}. The user can already see the picture; do not describe it as if they cannot.${dropped}`;
    }
    if (result.code === "E_CANCELLED") return "TOOL RESULT (generate_image): The user stopped the image before it was finished.";
    if (result.code === "E_EXISTS") {
      return `TOOL RESULT (generate_image): ${result.params?.path || target} already exists. Choose another path, or set overwrite to true only if the user asked to replace it.`;
    }
    return `TOOL RESULT (generate_image): Failed - ${result.error || result.code}`;
  },
};

/** Pixels of a tracked picture as base64, or null when the file has gone. */
async function pixelsOf(image: TrackedImage): Promise<string | null> {
  const strip = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);
  if (image.dataUrl) return strip(image.dataUrl);
  if (!image.path) return null;
  if (image.location === "project") {
    const read = await window.electronAPI?.files.read(image.workspaceId || "default", image.path);
    return read?.success && read.dataUrl ? strip(read.dataUrl) : null;
  }
  try {
    const response = await fetch(`draggy://images/${encodeURIComponent(image.path.split(/[\\/]/).pop() ?? "")}`);
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  } catch {
    return null;
  }
}

const viewImage: ToolSpec = {
  name: "view_image",
  group: "image",
  description: "Look at one picture of this chat by its ID (such as img_2), for example to check a detail before changing it. The picture follows the result.",
  parameters: {
    id: { type: "string", description: "The picture's ID from the list of pictures in this chat." },
  },
  required: ["id"],
  usage: '{"id": "img_2"} → shows that picture',
  annotations: {
    readOnly: true,
    readOnlyHint: true,
    destructive: false,
    destructiveHint: false,
    idempotent: true,
    idempotentHint: true,
    openWorld: false,
    openWorldHint: false,
  },
  // Offered only to a chat model that can read pictures.
  available: (environment) => Boolean(environment.imageReady) && environment.vision === true,
  run: async (args, ctx) => {
    if (!ctx.vision || !ctx.attachImage) return "TOOL RESULT (view_image): This model cannot look at images. Rely on the prompts listed for each picture.";
    const id = String(args.id ?? "").trim();
    const found = (ctx.images ?? []).find((image) => image.id === id.toLowerCase());
    if (!found) return `TOOL RESULT (view_image): There is no picture ${id} in this chat.`;
    const data = await pixelsOf(found);
    if (!data) return `TOOL RESULT (view_image): ${found.id} can no longer be read; the file was moved or deleted.`;
    ctx.attachImage(data);
    return `TOOL RESULT (view_image): ${found.id}, ${found.label}. The image follows this message.`;
  },
};

export const IMAGE_TOOLS: ToolSpec[] = [generateImage, viewImage];

export function registerImageTools(): void {
  registerTools(IMAGE_TOOLS);
}
