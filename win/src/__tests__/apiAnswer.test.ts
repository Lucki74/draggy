import { describe, expect, it, vi } from "vitest";
import { answerApiRequest, nextDelta, pickModel } from "../api/answer";
import type { AgentHost, AgentRequest, AgentResult } from "../agent/agentLoop";
import type { ApiCompletionRequest, AppSettings } from "../types";

/** A request from the local API, answered by the chat's own loop. What these pin down is what an
 * outside caller is and is not trusted with. */

const settings = {
  webMode: "auto",
  libraryEnabled: true,
  customInstructions: ["The user's own preference"],
} as unknown as AppSettings;

const request = (extra: Partial<ApiCompletionRequest> = {}): ApiCompletionRequest => ({
  model: "qwen3:8b",
  stream: false,
  messages: [
    { role: "system", content: "You are a code reviewer." },
    { role: "user", content: "Review this." },
  ],
  ...extra,
});

function fakeRun(patches: string[] = [], final = "Looks good.") {
  const seen: { request?: AgentRequest; host?: AgentHost } = {};

  const run = vi.fn(async (agentRequest: AgentRequest, host: AgentHost) => {
    seen.request = agentRequest;
    seen.host = host;
    for (const text of patches) host.onPatch({ content: text, textContent: text, steps: [] });

    return {
      content: final,
      textContent: final,
      steps: [],
      metrics: { promptTokens: 40, responseTokens: 5 },
      outOfContext: false,
      loops: 1,
      exhausted: false,
      aborted: false,
      toolCalls: {},
    } as unknown as AgentResult;
  });

  return { run, seen };
}

const deps = (extra = {}) => ({
  model: "llama3.2:3b",
  installed: ["qwen3:8b", "llama3.2:3b"],
  settings,
  t: (key: string) => key,
  signal: new AbortController().signal,
  ...extra,
});

describe("which model answers", () => {
  it("uses the one asked for when it is installed", () => {
    expect(pickModel("qwen3:8b", "llama3.2:3b", ["qwen3:8b"])).toBe("qwen3:8b");
  });

  it("falls back to Draggy's own for a name it does not have", () => {
    expect(pickModel("gpt-4o", "llama3.2:3b", ["qwen3:8b", "llama3.2:3b"])).toBe("llama3.2:3b");
    expect(pickModel("", "llama3.2:3b", ["qwen3:8b"])).toBe("llama3.2:3b");
  });

  it("trusts the name when the installed list could not be read", () => {
    expect(pickModel("qwen3:8b", "llama3.2:3b", null)).toBe("qwen3:8b");
  });
});

describe("what an outside caller gets", () => {
  it("runs the same loop with the caller's instructions, not the user's", async () => {
    const { run, seen } = fakeRun();

    const result = await answerApiRequest(request(), { ...deps(), run });

    expect(result).toEqual({ model: "qwen3:8b", content: "Looks good.", usage: { promptTokens: 40, responseTokens: 5 } });
    expect(seen.request?.settings.customInstructions).toEqual(["You are a code reviewer."]);
    expect(seen.request?.messages.map((message) => message.role)).toEqual(["user"]);
  });

  it("gets the web and nothing else: no folder, code, documents or extensions", async () => {
    const { run, seen } = fakeRun();

    await answerApiRequest(request(), { ...deps(), run });

    expect(seen.request?.environment).toMatchObject({
      hasFolder: false,
      codeExecution: false,
      libraryReady: false,
      hasSkills: false,
      hasGit: false,
      allowedGroups: ["web"],
    });
    expect(seen.request?.environment.projectRoot).toBeUndefined();
  });

  it("can only run what does not need the user's approval", async () => {
    const { run, seen } = fakeRun();

    await answerApiRequest(request(), { ...deps(), run });

    expect(seen.request?.permission).toEqual({ mode: "ask", grants: [] });
    expect(seen.host?.requestApproval).toBeUndefined();
  });

  it("refuses when Draggy has no model at all", async () => {
    const { run } = fakeRun();

    await expect(
      answerApiRequest(request({ model: "" }), { ...deps({ model: null }), run }),
    ).rejects.toThrow(/No model/);
    expect(run).not.toHaveBeenCalled();
  });

  it("gives up rather than answering a request that was cancelled", async () => {
    const controller = new AbortController();
    const { run } = fakeRun();
    controller.abort();

    await expect(answerApiRequest(request(), { ...deps({ signal: controller.signal }), run })).rejects.toThrow(
      /cancelled/,
    );
  });
});

describe("streaming", () => {
  it("sends only what is new each time", async () => {
    const { run } = fakeRun(["Loo", "Looks", "Looks good"], "Looks good.");
    const sent: string[] = [];

    await answerApiRequest(request({ stream: true }), { ...deps(), run, onText: (text) => sent.push(text) });

    expect(sent).toEqual(["Loo", "ks", " good", "."]);
    expect(sent.join("")).toBe("Looks good.");
  });

  it("never takes back words already sent", () => {
    expect(nextDelta("Hello wor", "Hello world")).toBe("ld");
    expect(nextDelta("Hello <tool", "Hello")).toBe("");
    expect(nextDelta("", "Hi")).toBe("Hi");
  });

  it("says which model is answering before the first word", async () => {
    const { run } = fakeRun(["Hi"]);
    const order: string[] = [];

    await answerApiRequest(request({ model: "gpt-4o" }), {
      ...deps(),
      run,
      onModel: (model) => order.push(`model:${model}`),
      onText: (text) => order.push(`text:${text}`),
    });

    expect(order[0]).toBe("model:llama3.2:3b");
  });
});
