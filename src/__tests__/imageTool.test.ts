import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerImageTools } from "../tools/image";
import { registerBuiltinTools } from "../tools/builtin";
import { annotationsFor, availableTools, resetRegistry, runTool, withoutTools } from "../tools/registry";
import type { ToolContext, ToolEnvironment } from "../tools/registry";
import { createTaskManager } from "../agent/taskManager";
import type { TaskHost } from "../agent/taskManager";
import { parseImageCommand, defaultProjectPath } from "../images/imageCommand";
import type { AppSettings, ChatSession, ImageProgress, ImageRequest, ImageResult, ImageStepInfo, MessageVersion, SearchStep } from "../types";

/** The image tool and /image as the model and the user meet them: offered only when it can work, stopped
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
    electronAPI: {
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

describe("/image", () => {
  it("reads flags on either side of the prompt", () => {
    expect(parseImageCommand('--size 768x512 a cat on a "red" sofa --seed 42 --to "public/my cat.png" --hires')).toEqual({
      prompt: "a cat on a red sofa",
      width: 768,
      height: 512,
      seed: 42,
      to: "public/my cat.png",
      hires: true,
      overwrite: false,
      lora: [],
    });
  });

  it("collects several LoRAs and a negative prompt", () => {
    const parsed = parseImageCommand('portrait --lora ink:0.6 --lora grain --negative "blurry, text"');
    expect(parsed).toMatchObject({ prompt: "portrait", lora: ["ink:0.6", "grain"], negative: "blurry, text" });
  });

  it("refuses an unknown flag or a bad value, and an empty prompt", () => {
    expect(parseImageCommand("cat --colour red")).toEqual({ error: "flag", flag: "--colour" });
    expect(parseImageCommand("cat --size big")).toEqual({ error: "flag", flag: "--size big" });
    expect(parseImageCommand("--seed 3")).toEqual({ error: "empty" });
  });

  it("names a project file after the prompt", () => {
    expect(defaultProjectPath("Hello, World!")).toBe("assets/generated/hello-world.png");
  });
});

describe("/image in a conversation", () => {
  function createHost(environment: ToolEnvironment = CHAT) {
    const sessions = new Map<string, ChatSession>();
    const host: TaskHost = {
      getModel: () => "qwen3:8b",
      getSettings: () => ({ customInstructions: [] }) as unknown as AppSettings,
      getEnvironment: () => environment,
      getWorkspaceId: () => "project-7",
      getPermission: () => ({ mode: "auto" as const, grants: [] }),
      onGrant: () => {},
      getSession: (chatId) => sessions.get(chatId),
      addSession: (session) => sessions.set(session.id, session),
      updateSession: (chatId, updater) => {
        const session = sessions.get(chatId);
        if (session) sessions.set(chatId, updater(session));
      },
      patchActiveMessage: (chatId, patch: Partial<MessageVersion>) => {
        const session = sessions.get(chatId);
        if (!session) return;
        const messages = session.messages.slice();
        messages[messages.length - 1] = { ...messages[messages.length - 1], ...patch };
        sessions.set(chatId, { ...session, messages });
      },
      t: (key) => key,
    };
    return { sessions, host };
  }

  it("draws with no model turn and keeps only the path in history", async () => {
    const sd = installSd();
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);

    manager.image("chat-9", "a lighthouse --seed 5");
    await tick();
    expect(manager.isRunning("chat-9")).toBe(true);
    expect(sessions.get("chat-9")?.messages[0].content).toBe("/image a lighthouse --seed 5");
    expect(sd.requests[0]).toMatchObject({ prompt: "a lighthouse", seed: 5, destination: { kind: "chat" } });

    sd.finish({ success: true, path: "C:\\data\\created_files\\l.png", filename: "l.png", width: 512, height: 512, seed: 5 });
    await tick();

    const reply = sessions.get("chat-9")?.messages[1];
    expect(reply?.steps?.[0].image).toMatchObject({ status: "done", filename: "l.png" });
    expect(reply?.content).toBe("imageReply");
    expect(manager.isRunning("chat-9")).toBe(false);
    expect(sessions.get("chat-9")?.isGenerating).toBe(false);
    expect(JSON.stringify(sessions.get("chat-9"))).not.toMatch(/base64/);
  });

  it("draws again on regenerate, rather than sending /image to the chat model", async () => {
    const sd = installSd();
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);

    manager.image("chat-9", "a boat");
    await tick();
    sd.finish({ success: true, path: "p", filename: "boat.png" });
    await tick();

    manager.regenerate("chat-9");
    await tick();
    expect(sd.requests).toHaveLength(2);
    expect(sd.requests[1].prompt).toBe("a boat");
    expect(sessions.get("chat-9")?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    sd.finish({ success: true, path: "p", filename: "boat-2.png" });
  });

  it("stops like any other turn", async () => {
    const sd = installSd();
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);

    manager.image("chat-9", "slow one");
    await tick();
    manager.stop("chat-9");
    await tick();

    expect(sd.cancelled).toEqual([sd.requests[0].requestId]);
    expect(sessions.get("chat-9")?.messages[1].steps?.[0].image?.status).toBe("cancelled");
  });

  it("uses an attached picture as the starting image", async () => {
    const sd = installSd();
    const { host } = createHost();
    const manager = createTaskManager(host);
    manager.image("chat-9", "make it night", [{ name: "day.png", type: "image/png", content: "iVBORw0KGgo" }]);
    await tick();
    expect(sd.requests[0].init).toEqual({ kind: "attachment", dataUrl: "data:image/png;base64,iVBORw0KGgo" });
    sd.finish({ success: true, path: "p", filename: "n.png" });
  });

  it("saves into the project from Code, and answers a bad flag without drawing", async () => {
    const sd = installSd();
    const { sessions, host } = createHost(CODE);
    const manager = createTaskManager(host);

    manager.image("chat-9", "favicon --to public/favicon.png");
    await tick();
    expect(sd.requests[0].destination).toMatchObject({ kind: "project", path: "public/favicon.png", workspaceId: "project-7" });
    sd.finish({ success: true, path: "p", filename: "favicon.png" });
    await tick();

    manager.image("chat-9", "--wat");
    expect(sd.requests).toHaveLength(1);
    expect(sessions.get("chat-9")?.messages.at(-1)?.content).toBe("imageCommandBadFlag");
  });
});
