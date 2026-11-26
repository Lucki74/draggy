import { describe, expect, it } from "vitest";
import { decide } from "../agent/permissions";
import { rulesFor } from "../agent/permissionRules";
import type { PermissionRule } from "../types";

const exec = { executes: true };
const edit = {};

function rule(effect: "allow" | "deny", kind: PermissionRule["kind"], value: string, workspaceId?: string): PermissionRule {
  return { effect, kind, value, ...(workspaceId ? { workspaceId } : {}) };
}

describe("never allow", () => {
  it("refuses a matching command in every mode, auto included", () => {
    const rules = [rule("deny", "command", "git push")];
    for (const mode of ["ask", "acceptEdits", "turbo", "auto"] as const) {
      expect(decide({ mode, tool: "run_command", annotations: exec, target: "git push origin main", rules }).decision).toBe("deny");
    }
  });

  it("refuses the command when it is chained after another", () => {
    const rules = [rule("deny", "command", "rm")];
    expect(decide({ mode: "auto", tool: "run_command", annotations: exec, target: "ls && rm -rf build", rules }).decision).toBe("deny");
  });

  it("does not catch a command that only starts with the same letters", () => {
    const rules = [rule("deny", "command", "rm")];
    expect(decide({ mode: "auto", tool: "run_command", annotations: exec, target: "rmdir build", rules }).decision).toBe("allow");
  });

  it("wins over an earlier always", () => {
    const rules = [rule("deny", "command", "npm publish")];
    const grants = [{ tool: "run_command", target: "npm" }];
    expect(decide({ mode: "ask", tool: "run_command", annotations: exec, target: "npm publish", grants, rules }).decision).toBe("deny");
  });

  it("refuses reads and writes inside a blocked folder", () => {
    const rules = [rule("deny", "path", "C:/work/secrets")];
    expect(decide({ mode: "auto", tool: "read_file", annotations: { readOnly: true }, target: "C:\\work\\secrets\\key.txt", rules }).decision).toBe("deny");
    expect(decide({ mode: "auto", tool: "read_file", annotations: { readOnly: true }, target: "C:/work/secretsplus/a.txt", rules }).decision).toBe("allow");
  });

  it("refuses a site and its subdomains", () => {
    const rules = [rule("deny", "site", "example.com")];
    expect(decide({ mode: "auto", tool: "fetch_url", annotations: { readOnly: true }, target: "https://docs.example.com/a", rules }).decision).toBe("deny");
    expect(decide({ mode: "auto", tool: "fetch_url", annotations: { readOnly: true }, target: "https://notexample.com", rules }).decision).toBe("allow");
  });

  it("refuses a tool by name", () => {
    const rules = [rule("deny", "tool", "write_file")];
    expect(decide({ mode: "turbo", tool: "write_file", annotations: edit, target: "a.txt", rules }).decision).toBe("deny");
  });
});

describe("always allow", () => {
  it("lets a command run without asking", () => {
    const rules = [rule("allow", "command", "npm test")];
    expect(decide({ mode: "ask", tool: "run_command", annotations: exec, target: "npm test -- --watch", rules }).decision).toBe("allow");
    expect(decide({ mode: "ask", tool: "run_command", annotations: exec, target: "npm test && curl x", rules }).decision).toBe("ask");
  });

  it("lets edits inside a folder through", () => {
    const rules = [rule("allow", "path", "C:/work/app/src")];
    expect(decide({ mode: "ask", tool: "edit_file", annotations: edit, target: "C:/work/app/src/a.ts", rules }).decision).toBe("allow");
    expect(decide({ mode: "ask", tool: "edit_file", annotations: edit, target: "C:/work/app/b.ts", rules }).decision).toBe("ask");
  });

  it("does not open plan mode", () => {
    const rules = [rule("allow", "tool", "write_file")];
    expect(decide({ mode: "plan", tool: "write_file", annotations: edit, target: "a.txt", rules }).decision).toBe("deny");
  });
});

describe("rulesFor", () => {
  it("keeps global rules and the project's own, and reads relative paths from its folder", () => {
    const all = [rule("deny", "path", "secrets"), rule("allow", "tool", "x", "other"), rule("allow", "tool", "y", "here")];
    const kept = rulesFor(all, { id: "here", rootPath: "C:/work/app" });
    expect(kept.map((one) => one.value)).toEqual(["C:/work/app/secrets", "y"]);
  });

  it("tolerates a broken setting", () => {
    expect(rulesFor(undefined, null)).toEqual([]);
  });
});
