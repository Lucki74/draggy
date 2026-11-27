import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerImageTools } from "../tools/image";
import { registerBuiltinTools } from "../tools/builtin";
import { annotationsFor, availableTools, resetRegistry, runTool, withoutTools } from "../tools/registry";
import type { ToolContext, ToolEnvironment } from "../tools/registry";
import { defaultProjectPath } from "../images/imageCommand";
import type { AppSettings, ImageProgress, ImageRequest, ImageResult, ImageStepInfo, SearchStep } from "../types";

/** The image tool as the model meets it: offered only when it can work, stopped
 * with the turn, and never carrying the picture's bytes into the conversation. */

const CHAT: ToolEnvironment = { webMode: "off", codeExecution: false, libraryReady: false, imageReady: true };
const CODE: ToolEnvironment = { ...CHAT, hasFolder: true, projectRoot: "C:\\projects\\site" };

interface FakeSd {
  requests: ImageRequest[];
  cancelled: string[];
  emit: (progress: ImageProgress) => void;
  finish: (result: ImageResult) => void;
  listeners: number;
}

function installSd(): FakeSd {
  const listeners = new Set<(progress: ImageProgress) => void>();
  let resolveCurrent: ((result: ImageResult) => void) | null = null;
  const fake: FakeSd = {
    requests: [],
    cancelled: [],
    emit: (progress) => listeners.forEach((listener) => listener(progress)),
    finish: (result) => resolveCurrent?.(result),
    get listeners() {
      return listeners.size;
    },
  };
  vi.stubGlobal("window", {
    draggy: {
      sd: {
        generate: (request: ImageRequest) => {
          fake.requests.push(request);
          return new Promise<ImageResult>((resolve) => {
            resolveCurrent = resolve;
          });
        },
        cancel: async (requestId: string) => {
          fake.cancelled.push(requestId);
          resolveCurrent?.({ success: false, code: "E_CANCELLED", error: "Cancelled" });
          return { success: true };
        },
        onProgress: (callback: (progress: ImageProgress) => void) => {
          listeners.add(callback);
          return () => listeners.delete(callback);
        },
      },
    },
  });
  vi.stubGlobal("document", { documentElement: { lang: "en" } });
  return fake;
}

function harness(signal = new AbortController().signal, environment: ToolEnvironment = CHAT) {
  const steps: SearchStep[] = [];
  const context: ToolContext = {
    t: (key) => key,
    settings: {} as AppSettings,
    workspaceId: "project-7",
    chatId: "chat-1",
    environment,
    pushStep: (step) => steps.push(step),
    patchStep: (id, patch) => {
      const index = steps.findIndex((entry) => entry.id === id);
      if (index !== -1) steps[index] = { ...steps[index], ...patch };
    },
    syncSteps: () => {},
    newId: () => `step-${steps.length}`,
    signal,
    memo: new Map(),
  };
  return { context, steps };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetRegistry();
  registerImageTools();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("when the tool is offered", () => {
  it("is offered only once the engine and a model are both there", () => {
    expect(availableTools({ ...CHAT, imageReady: false }).map((tool) => tool.name)).toEqual([]);
    expect(availableTools(CHAT).map((tool) => tool.name)).toEqual(["generate_image"]);
  });

  it("costs a model without tool support nothing, since the tool is not offered", () => {
    expect(availableTools(withoutTools(CHAT))).toEqual([]);
  });

  it("is not reachable from the local API, which gets the web and nothing else", () => {
    registerBuiltinTools();
    const names = availableTools({ ...CHAT, allowedGroups: ["web"] }).map((tool) => tool.name);
    expect(names).not.toContain("generate_image");
  });

  it("does not claim to only read, so a project asks before it writes", () => {
    expect(annotationsFor("generate_image").readOnly).toBeFalsy();
    expect(annotationsFor("generate_image").sandboxed).toBeFalsy();
  });
});

describe("running it", () => {
  it("saves to the output folder in Chat and tells the model where, with no bytes", async () => {
    const sd = installSd();
    const { context, steps } = harness();

    const running = runTool("generate_image", { prompt: "a red fox" }, context, CHAT);
    await tick();
    expect(sd.requests[0].destination).toEqual({ kind: "chat" });
    expect(sd.requests[0].fitModel).toBe(true);
    sd.emit({ requestId: sd.requests[0].requestId, status: "generating" });
    expect(steps[0].image?.status).toBe("generating");

    sd.finish({ success: true, path: "C:\\data\\created_files\\fox.png", filename: "fox.png", width: 512, height: 512, seed: 7 });
    const reply = await running;

    expect(reply).toContain("Saved C:\\data\\created_files\\fox.png");
    expect(steps[0].image).toMatchObject({ status: "done", location: "created", filename: "fox.png", seed: 7 });
    expect(JSON.stringify(steps)).not.toMatch(/base64|data:image/);
    expect(reply).not.toMatch(/base64|data:image/);
    expect(sd.listeners).toBe(0);
  });

  it("saves into the project in Code, at the default path when none is given", async () => {
    const sd = installSd();
    const { context } = harness(undefined, CODE);

    const running = runTool("generate_image", { prompt: "Site Logo, flat" }, context, CODE);
    await tick();
    expect(sd.requests[0].destination).toEqual({
      kind: "project",
      workspaceId: "project-7",
      path: "assets/generated/site-logo-flat.png",
      chatId: "chat-1",
      overwrite: false,
    });
    sd.finish({ success: true, path: "C:\\projects\\site\\assets\\generated\\site-logo-flat.png", filename: "site-logo-flat.png" });
    await running;
  });

  it("saves into the chat's own folder when the chat has one", async () => {
    const sd = installSd();
    const withFolder: ToolEnvironment = { ...CHAT, chatFolder: true };
    const { context } = harness(undefined, withFolder);

    const running = runTool("generate_image", { prompt: "a red fox", path: "site/images/fox.png" }, context, withFolder);
    await tick();
    expect(sd.requests[0].destination).toEqual({
      kind: "project",
      workspaceId: "chat:chat-1",
      path: "site/images/fox.png",
      chatId: "chat-1",
      overwrite: false,
    });
    sd.finish({ success: true, path: "C:\\data\\chats\\chat-1\\site\\images\\fox.png", filename: "fox.png" });
    await running;
  });

  it("uses a picture in the project as the starting image, only in Code", async () => {
    const sd = installSd();
    const code = harness(undefined, CODE);
    const running = runTool("generate_image", { prompt: "night version", source: "public/day.png", strength: 0.5 }, code.context, CODE);
    await tick();
    expect(sd.requests[0].init).toEqual({ kind: "project", workspaceId: "project-7", path: "public/day.png" });
    expect(sd.requests[0].strength).toBe(0.5);
    sd.finish({ success: true, path: "x.png", filename: "x.png" });
    await running;

    const chat = harness();
    const again = runTool("generate_image", { prompt: "night", source: "C:/Windows/x.png" }, chat.context, CHAT);
    await tick();
    expect(sd.requests[1].init).toBeUndefined();
    sd.finish({ success: true, path: "y.png", filename: "y.png" });
    await again;
  });

  it("cancels the job when the turn is stopped", async () => {
    const sd = installSd();
    const controller = new AbortController();
    const { context, steps } = harness(controller.signal);

    const running = runTool("generate_image", { prompt: "slow" }, context, CHAT);
    await tick();
    controller.abort();
    const reply = await running;

    expect(sd.cancelled).toEqual([sd.requests[0].requestId]);
    expect(reply).toContain("stopped");
    expect(steps[0].image?.status).toBe("cancelled");
  });

  it("does not overwrite unless asked, and says how to", async () => {
    const sd = installSd();
    const { context } = harness(undefined, CODE);
    const running = runTool("generate_image", { prompt: "logo", path: "public/logo.png" }, context, CODE);
    await tick();
    sd.finish({ success: false, code: "E_EXISTS", error: "logo.png already exists", params: { path: "C:\\projects\\site\\public\\logo.png" } });
    expect(await running).toContain("overwrite to true only if the user asked");

    const again = runTool("generate_image", { prompt: "logo", path: "public/logo.png", overwrite: true }, context, CODE);
    await tick();
    expect(sd.requests[1].destination).toMatchObject({ overwrite: true });
    sd.finish({ success: true, path: "p", filename: "logo.png" });
    await again;
  });

  it("puts a failure into words on the card, with the article to read", async () => {
    const sd = installSd();
    const { context, steps } = harness();
    const running = runTool("generate_image", { prompt: "big" }, context, CHAT);
    await tick();
    sd.finish({ success: false, code: "E_VRAM", error: "Not enough memory", params: { needGB: "6.0" } });
    await running;
    expect(steps[0].image?.status).toBe("error");
    expect(steps[0].image?.error).toContain("6.0 GB");
    expect(steps[0].image?.error).toContain("https://draggy.org/error/image-out-of-memory");
  });
});

describe("a picture cut off by quitting", () => {
  it("opens as stopped, not drawing forever, in the reply and in its older versions", async () => {
    vi.stubGlobal("window", {});
    const { settleSession } = await import("../storage");
    const drawing = (status: ImageStepInfo["status"]): SearchStep => ({
      id: status,
      type: "image",
      content: "p",
      isComplete: false,
      image: { prompt: "p", status, requestId: "r", queuePosition: 2 },
    });
    const session = {
      id: "c",
      title: "t",
      updatedAt: 0,
      isGenerating: true,
      messages: [
        {
          id: "m",
          role: "assistant" as const,
          content: "",
          steps: [drawing("generating"), drawing("queued")],
          versions: [{ content: "", steps: [drawing("loading-model")] }],
        },
      ],
    };

    const settled = settleSession(session);
    const statuses = [
      ...(settled.messages[0].steps ?? []).map((step) => step.image?.status),
      ...(settled.messages[0].versions?.[0].steps ?? []).map((step) => step.image?.status),
    ];
    expect(statuses).toEqual(["cancelled", "cancelled", "cancelled"]);
    expect(settled.messages[0].steps?.every((step) => step.isComplete)).toBe(true);
    expect(settled.isGenerating).toBe(false);
  });

  it("leaves a finished picture exactly as it was", async () => {
    vi.stubGlobal("window", {});
    const { settleSession } = await import("../storage");
    const message = { id: "m", role: "assistant" as const, content: "", steps: [{ id: "s", type: "image" as const, content: "p", isComplete: true, image: { prompt: "p", status: "done" as const } }] };
    const session = { id: "c", title: "t", updatedAt: 0, isGenerating: false, messages: [message] };
    expect(settleSession(session).messages[0]).toBe(message);
  });
});

describe("defaultProjectPath", () => {
  it("names a project file after the prompt", () => {
    expect(defaultProjectPath("Hello, World!")).toBe("assets/generated/hello-world.png");
  });
});

describe("view_image", () => {
  it("is offered only to a chat model that can read pictures", () => {
    expect(availableTools({ ...CHAT, vision: true }).map((tool) => tool.name)).toEqual(["generate_image", "view_image"]);
    expect(availableTools({ ...CHAT, vision: false }).map((tool) => tool.name)).toEqual(["generate_image"]);
  });
});

describe("reference_image", () => {
  const tracked = [{ id: "img_1", origin: "generated" as const, messageId: "m", label: "a red fox", path: "C:/data/created_files/fox.png", location: "created" as const }];

  it("starts from a tracked picture at the low default strength and numbers the new one", async () => {
    const sd = installSd();
    const { context } = harness();
    context.images = tracked;
    const running = runTool("generate_image", { prompt: "a red fox with a hat", reference_image: "img_1" }, context, CHAT);
    await tick();
    expect(sd.requests[0].init).toEqual({ kind: "created", path: "C:/data/created_files/fox.png" });
    expect(sd.requests[0].strength).toBe(0.35);
    sd.finish({ success: true, path: "C:/data/created_files/fox-hat.png", filename: "fox-hat.png" });
    expect(await running).toContain("as img_2");
    expect(context.images).toHaveLength(2);
  });

  it("lets the model raise the strength", async () => {
    const sd = installSd();
    const { context } = harness();
    context.images = tracked;
    const running = runTool("generate_image", { prompt: "x", reference_image: "img_1", strength: 0.6 }, context, CHAT);
    await tick();
    expect(sd.requests[0].strength).toBe(0.6);
    sd.finish({ success: true, path: "C:/a.png", filename: "a.png" });
    await running;
  });

  it("refuses an unknown ID without drawing", async () => {
    const sd = installSd();
    const { context } = harness();
    context.images = tracked;
    const reply = await runTool("generate_image", { prompt: "x", reference_image: "img_9" }, context, CHAT);
    expect(reply).toContain("no picture img_9");
    expect(reply).toContain("img_1");
    expect(sd.requests).toHaveLength(0);
  });

  it("tells the model and the card when the reference was dropped", async () => {
    const sd = installSd();
    const { context, steps } = harness();
    context.images = tracked;
    const running = runTool("generate_image", { prompt: "x", reference_image: "img_1" }, context, CHAT);
    await tick();
    sd.finish({ success: true, path: "C:/a.png", filename: "a.png", referenceDropped: true });
    expect(await running).toContain("was not used");
    expect(steps[0].image?.referenceDropped).toBe(true);
  });
});
