import { describe, expect, it } from "vitest";
import {
  initialMode,
  modeOf,
  patchForMode,
  projectsOf,
  runningInMode,
  settingsForMode,
  workspaceForMode,
  workspaceOfChat,
} from "../app/modes";
import { DEFAULT_WORKSPACE_ID } from "../workspaces";
import type { AppSettings, ChatSession, Workspace } from "../types";

const chats = { id: DEFAULT_WORKSPACE_ID, kind: "chat", name: "Chats" } as Workspace;
const alpha = { id: "alpha", kind: "project", name: "Alpha", rootPath: "C:\\alpha" } as Workspace;
const beta = { id: "beta", kind: "project", name: "Beta", rootPath: "C:\\beta" } as Workspace;
const all = [chats, alpha, beta];

const session = (id: string, workspaceId?: string) =>
  ({ id, title: id, messages: [], workspaceId }) as unknown as ChatSession;

describe("modes", () => {
  it("opens in the stored mode, or the one the last workspace implies", () => {
    expect(initialMode("code", DEFAULT_WORKSPACE_ID)).toBe("code");
    expect(initialMode("chat", "alpha")).toBe("chat");
    expect(initialMode(null, "alpha")).toBe("code");
    expect(initialMode(null, DEFAULT_WORKSPACE_ID)).toBe("chat");
    expect(initialMode("nonsense", null)).toBe("chat");
  });

  it("puts only folders with a path on the Code side", () => {
    const pathless = { id: "gone", kind: "project", name: "Gone" } as Workspace;

    expect(modeOf(alpha)).toBe("code");
    expect(modeOf(chats)).toBe("chat");
    expect(modeOf(pathless)).toBe("chat");
    expect(modeOf(undefined)).toBe("chat");
    expect(projectsOf([...all, pathless]).map((one) => one.id)).toEqual(["alpha", "beta"]);
  });

  it("lands on the chat workspace, the last project, or the first one", () => {
    expect(workspaceForMode("chat", all, "beta")).toBe(DEFAULT_WORKSPACE_ID);
    expect(workspaceForMode("code", all, "beta")).toBe("beta");
    expect(workspaceForMode("code", all, "removed")).toBe("alpha");
    expect(workspaceForMode("code", [chats], null)).toBeNull();
  });

  it("finds where a conversation lives, defaulting to chats", () => {
    const sessions = [session("one", "alpha"), session("two")];

    expect(workspaceOfChat(sessions, "one")).toBe("alpha");
    expect(workspaceOfChat(sessions, "two")).toBe(DEFAULT_WORKSPACE_ID);
    expect(workspaceOfChat(sessions, "unknown")).toBe(DEFAULT_WORKSPACE_ID);
  });

  const settings = {
    modelName: "qwen3:8b",
    customInstructions: ["answer briefly"],
    thinkingMode: "low",
    webMode: "on",
    codeModel: "qwen3-coder:30b",
    codeInstructions: ["use pnpm"],
    codeThinkingMode: "high",
    codeWebMode: "off",
  } as AppSettings;

  it("runs Chat with its own settings", () => {
    const chat = settingsForMode(settings, "chat");

    expect(chat.modelName).toBe("qwen3:8b");
    expect(chat.customInstructions).toEqual(["answer briefly"]);
    expect(chat.thinkingMode).toBe("low");
    expect(chat.webMode).toBe("on");
  });

  it("runs Code with Code's model, instructions, thinking and web", () => {
    const code = settingsForMode(settings, "code");

    expect(code.modelName).toBe("qwen3-coder:30b");
    expect(code.customInstructions).toEqual(["use pnpm"]);
    expect(code.thinkingMode).toBe("high");
    expect(code.webMode).toBe("off");
  });

  it("follows the chat model when Code has none of its own", () => {
    expect(settingsForMode({ ...settings, codeModel: "" }, "code").modelName).toBe("qwen3:8b");
  });

  it("writes a change made in Code to Code's own fields", () => {
    expect(patchForMode("code", { thinkingMode: "medium", webMode: "auto" })).toEqual({
      codeThinkingMode: "medium",
      codeWebMode: "auto",
    });
    expect(patchForMode("code", { modelName: "x" })).toEqual({ codeModel: "x" });
    expect(patchForMode("code", { compactLimit: 20000 })).toEqual({ compactLimit: 20000 });
    expect(patchForMode("chat", { thinkingMode: "high" })).toEqual({ thinkingMode: "high" });
  });

  it("keeps running project work out of Chat and chats out of Code", () => {
    const sessions = [session("plain"), session("build", "alpha"), session("tests", "beta")];
    const running = ["plain", "build", "tests"];

    expect(runningInMode(running, sessions, all, "chat")).toEqual(["plain"]);
    expect(runningInMode(running, sessions, all, "code")).toEqual(["build", "tests"]);
  });
});
