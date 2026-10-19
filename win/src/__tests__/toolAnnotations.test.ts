import { beforeEach, describe, expect, it } from "vitest";
import { allTools, resetRegistry } from "../tools/registry";
import { registerBuiltinTools } from "../tools/builtin";
import { registerFileTools } from "../tools/files";
import { registerPlanTools } from "../tools/plan";
import { registerSkillTools } from "../tools/skills";
import { registerExploreTools } from "../tools/explore";
import { registerGitTools } from "../tools/git";
import { registerCommandTools } from "../tools/commands";
import { registerImageTools } from "../tools/image";

describe("Tool annotations quality and directory compliance", () => {
  beforeEach(() => {
    resetRegistry();
    registerBuiltinTools();
    registerFileTools();
    registerPlanTools();
    registerSkillTools();
    registerExploreTools();
    registerGitTools();
    registerCommandTools();
    registerImageTools();
  });

  it("registers all 38 tools", () => {
    const tools = allTools();
    expect(tools.length).toBe(38);
  });

  it("declares all four hints as explicit booleans on every tool", () => {
    const tools = allTools();

    for (const tool of tools) {
      const annotations = tool.annotations;
      expect(annotations, `tool ${tool.name} must have annotations`).toBeDefined();
      if (!annotations) continue;

      expect(
        typeof annotations.readOnlyHint,
        `tool ${tool.name} missing or non-boolean readOnlyHint`,
      ).toBe("boolean");

      expect(
        typeof annotations.destructiveHint,
        `tool ${tool.name} missing or non-boolean destructiveHint`,
      ).toBe("boolean");

      expect(
        typeof annotations.idempotentHint,
        `tool ${tool.name} missing or non-boolean idempotentHint`,
      ).toBe("boolean");

      expect(
        typeof annotations.openWorldHint,
        `tool ${tool.name} missing or non-boolean openWorldHint`,
      ).toBe("boolean");
    }
  });

  it("ensures readOnly tools are not marked destructive", () => {
    const tools = allTools();

    for (const tool of tools) {
      if (tool.annotations?.readOnlyHint === true) {
        expect(
          tool.annotations.destructiveHint,
          `tool ${tool.name} cannot be both readOnly and destructive`,
        ).toBe(false);
      }
    }
  });

  it("matches handler behavior for critical tool categories", () => {
    const byName = new Map(allTools().map((t) => [t.name, t]));

    const searchWeb = byName.get("search_web")!;
    expect(searchWeb.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });

    const readUrl = byName.get("read_url")!;
    expect(readUrl.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });

    const browserNavigate = byName.get("browser_navigate")!;
    expect(browserNavigate.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });

    const deleteFile = byName.get("delete_file")!;
    expect(deleteFile.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });

    const moveFile = byName.get("move_file")!;
    expect(moveFile.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });

    const editFile = byName.get("edit_file")!;
    expect(editFile.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });

    const runCommand = byName.get("run_command")!;
    expect(runCommand.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
  });
});
