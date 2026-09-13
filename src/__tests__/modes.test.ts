import { describe, expect, it } from "vitest";
import {
  initialMode,
  modeOf,
  projectsOf,
  runningInMode,
  workspaceForMode,
  workspaceOfChat,
} from "../app/modes";
import { DEFAULT_WORKSPACE_ID } from "../workspaces";
import type { ChatSession, Workspace } from "../types";

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

  it("keeps running project work out of Chat and chats out of Code", () => {
    const sessions = [session("plain"), session("build", "alpha"), session("tests", "beta")];
    const running = ["plain", "build", "tests"];

    expect(runningInMode(running, sessions, all, "chat")).toEqual(["plain"]);
    expect(runningInMode(running, sessions, all, "code")).toEqual(["build", "tests"]);
  });
});
