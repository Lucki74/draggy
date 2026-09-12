import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_ID,
  createProject,
  fallbackWorkspace,
  folderName,
  isDefault,
  resolveSettings,
  sessionsIn,
  workspaceLabel,
} from "../workspaces";
import type { AppSettings, ChatSession, Workspace } from "../types";

const global = {
  modelName: "qwen3:8b",
  customInstructions: ["be brief"],
  thinkingMode: "medium",
  webMode: "auto",
  codeExecution: false,
  libraryEnabled: true,
  theme: "dark",
} as unknown as AppSettings;

function project(settings: Workspace["settings"] = {}): Workspace {
  return { ...createProject("Thing", "C:\\projects\\thing"), settings };
}

const chat = (id: string, workspaceId?: string): ChatSession => ({
  id,
  title: id,
  messages: [],
  updatedAt: 0,
  isGenerating: false,
  ...(workspaceId ? { workspaceId } : {}),
});

describe("naming a project", () => {
  it("takes the folder's own name when none is given", () => {
    expect(createProject("", "C:\\code\\draggy").name).toBe("draggy");
    expect(folderName("/home/someone/projects/api/")).toBe("api");
  });

  it("keeps a name the user typed", () => {
    expect(createProject("The good one", "C:\\code\\draggy").name).toBe(
      "The good one",
    );
  });

  it("starts a project where edits are allowed but nothing else is", () => {
    expect(createProject("x", "C:\\x").permissionMode).toBe("acceptEdits");
    expect(createProject("x", "C:\\x").kind).toBe("project");
  });
});

describe("telling the default workspace apart", () => {
  it("counts a missing workspace as the default one", () => {
    expect(isDefault(null)).toBe(true);
    expect(isDefault(fallbackWorkspace())).toBe(true);
    expect(isDefault(project())).toBe(false);
  });

  it("names it from the interface rather than from the row", () => {
    const t = (key: string) => (key === "defaultWorkspace" ? "Chats" : key);

    expect(workspaceLabel(fallbackWorkspace(), t)).toBe("Chats");
    expect(workspaceLabel(project(), t)).toBe("Thing");
    expect(workspaceLabel({ ...project(), name: "" }, t)).toBe("untitledProject");
  });
});

describe("the conversations of a workspace", () => {
  it("counts a chat with no workspace as the default one's", () => {
    const sessions = [chat("a"), chat("b", "w1"), chat("c", DEFAULT_WORKSPACE_ID)];

    expect(sessionsIn(sessions, DEFAULT_WORKSPACE_ID).map((s) => s.id)).toEqual([
      "a",
      "c",
    ]);
    expect(sessionsIn(sessions, "w1").map((s) => s.id)).toEqual(["b"]);
  });
});

describe("resolving settings", () => {
  it("hands back the app's own settings when nothing is overridden", () => {
    expect(resolveSettings(global, project())).toBe(global);
    expect(resolveSettings(global, null)).toBe(global);
  });

  it("lets a workspace change the model, the web and the instructions", () => {
    const resolved = resolveSettings(
      global,
      project({
        modelName: "qwen3:30b",
        webMode: "off",
        customInstructions: ["cite the file"],
      }),
    );

    expect(resolved.modelName).toBe("qwen3:30b");
    expect(resolved.webMode).toBe("off");
    expect(resolved.customInstructions).toEqual(["cite the file"]);
  });

  it("keeps everything it was not asked to change", () => {
    const resolved = resolveSettings(global, project({ webMode: "off" }));

    expect(resolved.modelName).toBe("qwen3:8b");
    expect(resolved.thinkingMode).toBe("medium");
    expect(resolved.libraryEnabled).toBe(true);
  });

  it("treats an emptied instruction list as a deliberate choice", () => {
    expect(
      resolveSettings(global, project({ customInstructions: [] })).customInstructions,
    ).toEqual([]);
  });

  it("takes a switch turned off, which is not the same as unset", () => {
    expect(resolveSettings(global, project({ libraryEnabled: false })).libraryEnabled).toBe(
      false,
    );
    expect(resolveSettings(global, project({ codeExecution: true })).codeExecution).toBe(
      true,
    );
  });

  it("ignores an empty model name, which means the app's model", () => {
    expect(resolveSettings(global, project({ modelName: "" })).modelName).toBe(
      "qwen3:8b",
    );
  });

  /**
   * The row is JSON written by an older or newer version, so it is not to be
   * trusted with anything but the settings a workspace is allowed to have.
   */
  it("refuses to change a setting that is the app's, not the workspace's", () => {
    const rogue = project({ theme: "light" } as Workspace["settings"]);

    expect(resolveSettings(global, rogue).theme).toBe("dark");
  });

  it("ignores a value of the wrong shape", () => {
    const broken = project({
      codeExecution: "yes",
      customInstructions: "be brief",
    } as unknown as Workspace["settings"]);

    const resolved = resolveSettings(global, broken);

    expect(resolved.codeExecution).toBe(false);
    expect(resolved.customInstructions).toEqual(["be brief"]);
  });
});
