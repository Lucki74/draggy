import { describe, expect, it, vi } from "vitest";
import type { CustomCommand, CustomSource } from "../chat/customCommands";
import { resolveAgentPolicy, type AgentParent } from "../chat/agentPolicy";

const parent: AgentParent = {
  mode: "ask",
  tools: ["read", "grep", "edit"],
  models: ["local-small", "local-large"],
};

function agent(source: CustomSource, extra: Partial<CustomCommand> = {}): CustomCommand {
  return { id: "helper", kind: "agent", source, description: "Helps", body: "Be brief.", ...extra };
}

describe("resolveAgentPolicy", () => {
  it("inherits the chat when the agent sets nothing", () => {
    expect(resolveAgentPolicy(agent("project"), parent)).toEqual({
      model: undefined,
      tools: ["read", "grep", "edit"],
      permissions: "ask",
      errors: [],
    });
  });

  it("keeps only tools the chat already has and reports the rest", () => {
    const policy = resolveAgentPolicy(agent("project", { tools: ["grep", "shell"] }), parent);
    expect(policy.tools).toEqual(["grep"]);
    expect(policy.errors).toEqual(["unknown tools: shell"]);
  });

  it("never widens tools past the chat", () => {
    const policy = resolveAgentPolicy(agent("user", { tools: ["read", "edit", "shell"] }), { ...parent, tools: ["read"] });
    expect(policy.tools).toEqual(["read"]);
  });

  it("accepts an enabled model and rejects one that is not enabled", () => {
    expect(resolveAgentPolicy(agent("project", { model: "local-large" }), parent).model).toBe("local-large");
    const bad = resolveAgentPolicy(agent("project", { model: "cloud-x" }), parent);
    expect(bad.model).toBeUndefined();
    expect(bad.errors).toEqual(['model "cloud-x" is not enabled']);
  });

  it("lets a project agent narrow permissions", () => {
    const policy = resolveAgentPolicy(agent("project", { permissions: "plan" }), parent);
    expect(policy.permissions).toBe("plan");
    expect(policy.errors).toEqual([]);
  });

  it("refuses a project agent that tries to raise permissions", () => {
    const policy = resolveAgentPolicy(agent("project", { permissions: "turbo" }), parent);
    expect(policy.permissions).toBe("ask");
    expect(policy.errors).toEqual(["agent cannot raise permissions above ask"]);
  });

  it("clamps a user agent to the chat's mode too", () => {
    const policy = resolveAgentPolicy(agent("user", { permissions: "turbo" }), parent);
    expect(policy.permissions).toBe("ask");
    expect(policy.errors).toEqual(["agent cannot raise permissions above ask"]);
  });

  it("resolves a turn for a typed agent line and ignores commands and plain text", async () => {
    const { agentTurnFor } = await import("../chat/agentPolicy");
    const commands = [agent("project", { id: "helper", tools: ["read"], model: "local-small", permissions: "plan" })];
    const canUse = async () => true;
    const tools = ["read", "write"];
    expect(await agentTurnFor("/helper check it", commands, "auto", canUse, tools)).toEqual({
      id: "helper", model: "local-small", tools: ["read"], permissions: "plan", errors: [],
    });
    expect(await agentTurnFor("/other x", commands, "auto", canUse, tools)).toBeNull();
    expect(await agentTurnFor("hello /helper", commands, "auto", canUse, tools)).toBeNull();
    expect(await agentTurnFor(undefined, commands, "auto", canUse, tools)).toBeNull();
  });

  it("drops an unusable model and keeps the chat's own", async () => {
    const { agentTurnFor } = await import("../chat/agentPolicy");
    const commands = [agent("project", { id: "helper", model: "gone" })];
    const turn = await agentTurnFor("/helper", commands, "auto", async () => false, ["read"]);
    expect(turn?.model).toBeUndefined();
    expect(turn?.errors).toEqual(['model "gone" is not enabled']);
  });

  it("never gives an agent a tool the chat does not have, and says so", async () => {
    const { agentTurnFor } = await import("../chat/agentPolicy");
    const commands = [agent("project", { id: "helper", tools: ["read", "write"] })];
    const turn = await agentTurnFor("/helper", commands, "auto", async () => true, ["read"]);
    expect(turn?.tools).toEqual(["read"]);
    expect(turn?.errors).toEqual(["unknown tools: write"]);
  });

  it("does not send an agent turn whose model is invalid, and returns the error", async () => {
    const { startAgentSend } = await import("../chat/agentPolicy");
    const commands = [agent("project", { id: "helper", model: "gone" })];
    const send = vi.fn();
    const errors = await startAgentSend("/helper", commands, "auto", async () => false, ["read"], send);
    expect(send).not.toHaveBeenCalled();
    expect(errors).toEqual(['model "gone" is not enabled']);
  });

  it("never lets a project agent take a builtin command name", async () => {
    const { agentTurnFor } = await import("../chat/agentPolicy");
    const commands = [agent("project", { id: "compact", model: undefined })];
    expect(await agentTurnFor("/compact", commands, "auto", async () => true, ["read"])).toBeNull();
  });

  it("sends a valid agent turn and returns no errors", async () => {
    const { startAgentSend } = await import("../chat/agentPolicy");
    const commands = [agent("project", { id: "helper", tools: ["read"] })];
    const send = vi.fn();
    expect(await startAgentSend("/helper", commands, "auto", async () => true, ["read"], send)).toEqual([]);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: "helper", tools: ["read"] }));
  });

  it("reports a failure in the send path instead of letting it escape", async () => {
    const { startAgentSend } = await import("../chat/agentPolicy");
    const commands = [agent("project", { id: "helper" })];
    const errors = await startAgentSend("/helper", commands, "auto", async () => true, [], () => {
      throw new Error("boom");
    });
    expect(errors).toEqual(["boom"]);
  });

  it("narrows a request for a mode and never widens", async () => {
    const { narrowPermission } = await import("../chat/agentPolicy");
    expect(narrowPermission("auto", "plan")).toBe("plan");
    expect(narrowPermission("plan", "turbo")).toBe("plan");
    expect(narrowPermission("ask", undefined)).toBe("ask");
  });

  it("rejects unknown permission values, including prototype names", () => {
    for (const value of ["allow-all", "toString"]) {
      const policy = resolveAgentPolicy(agent("project", { permissions: value }), parent);
      expect(policy.permissions).toBe("ask");
      expect(policy.errors).toEqual([`unknown permission mode "${value}"`]);
    }
  });
});
