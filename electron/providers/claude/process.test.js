import { EventEmitter } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { startClaude, sessionArgs, workFolder, FLAGS, QUIET, TOOL_TIMEOUT_MS } = require("./process.cjs");

let appData;
let cwd;
beforeEach(() => {
  appData = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-claude-"));
  cwd = path.join(appData, "work");
});
afterEach(() => fs.rmSync(appData, { recursive: true, force: true }));

/** A child that answers `initialize` as Claude Code does, and records every line it was sent. */
function fakeSpawn({ refuse = false } = {}) {
  const sent = [];
  const spawn = vi.fn(() => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn(() => setImmediate(() => child.emit("exit", null)));
    child.stdin.on("data", (chunk) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) {
        const message = JSON.parse(line);
        sent.push(message);
        if (message.request?.subtype === "initialize") {
          const response = refuse
            ? { subtype: "error", request_id: message.request_id, error: "no" }
            : { subtype: "success", request_id: message.request_id, response: { models: [{ value: "sonnet" }] } };
          child.stdout.write(`${JSON.stringify({ type: "control_response", response })}\n`);
        }
      }
    });
    spawn.child = child;
    return child;
  });
  return { spawn, sent };
}

const shell = {
  PATH: "/usr/bin",
  HOME: "/home/someone",
  ANTHROPIC_API_KEY: "sk-ant-from-the-shell",
  ANTHROPIC_BASE_URL: "https://proxy.example",
  CLAUDE_CODE_OAUTH_TOKEN: "not-ours",
  HTTPS_PROXY: "http://proxy.example",
};

const line = (message) => `${JSON.stringify(message)}\n`;

describe("claude process", () => {
  it("starts stripped, in its own folder, with nothing from the shell that could bill or proxy a turn", async () => {
    const { spawn } = fakeSpawn();
    const claude = await startClaude({ binary: "claude.exe", appData, instanceId: "a", args: ["--model", "sonnet"], spawn, parentEnv: shell, cwd });
    const [file, args, options] = spawn.mock.calls[0];
    expect(file).toBe("claude.exe");
    expect(args).toEqual([...FLAGS, "--model", "sonnet"]);
    for (const flag of ["--tools", "--setting-sources", "--strict-mcp-config", "--disable-slash-commands"]) expect(args).toContain(flag);
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args.join(" ")).not.toMatch(/bypassPermissions|dangerously-skip-permissions/);
    const home = path.join(appData, "claude", "a");
    expect(options.cwd).toBe(cwd);
    expect(options.env).toEqual({ PATH: "/usr/bin", HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: home, ...QUIET });
    expect(claude.init).toEqual({ models: [{ value: "sonnet" }] });
    await claude.stop();
  });

  it("registers Draggy's tools as an in-process server with a limit far above any approval wait", async () => {
    const { spawn, sent } = fakeSpawn();
    const claude = await startClaude({ binary: "claude", appData, instanceId: "a", spawn, parentEnv: {}, cwd });
    expect(sent[0]).toMatchObject({
      type: "control_request",
      request: { subtype: "initialize", sdkMcpServers: ["draggy"], sdkMcpServerConfigs: { draggy: { timeout: TOOL_TIMEOUT_MS } }, title: "Draggy" },
    });
    expect(TOOL_TIMEOUT_MS).toBeGreaterThanOrEqual(60 * 60 * 1000);
    await claude.stop();
  });

  it("answers the runtime's control requests, success and failure, and passes every other line on", async () => {
    const { spawn, sent } = fakeSpawn();
    const onMessage = vi.fn();
    const onControl = vi.fn(async (request) => {
      if (request.subtype === "can_use_tool") return { behavior: "allow", updatedInput: request.input };
      throw new Error("unknown request");
    });
    const claude = await startClaude({ binary: "claude", appData, instanceId: "a", spawn, parentEnv: {}, cwd, onMessage, onControl });
    const out = spawn.child.stdout;
    out.write(line({ type: "control_request", request_id: "r1", request: { subtype: "can_use_tool", tool_name: "mcp__draggy__read_file", input: { path: "a" } } }));
    out.write(line({ type: "control_request", request_id: "r2", request: { subtype: "mystery" } }));
    out.write(line({ type: "stream_event", event: { type: "message_start" } }));
    out.write("not json\n");
    await vi.waitFor(() => expect(sent.filter((m) => m.type === "control_response")).toHaveLength(2));
    expect(sent).toContainEqual({ type: "control_response", response: { subtype: "success", request_id: "r1", response: { behavior: "allow", updatedInput: { path: "a" } } } });
    expect(sent).toContainEqual({ type: "control_response", response: { subtype: "error", request_id: "r2", error: "unknown request" } });
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith({ type: "stream_event", event: { type: "message_start" } });

    claude.sendUser([{ type: "text", text: "hi" }]);
    expect(sent.at(-1)).toEqual({ type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] }, parent_tool_use_id: null, session_id: "" });
    await claude.stop();
  });

  it("stops the child when Claude Code refuses to start, and fails pending requests when it exits", async () => {
    const refused = fakeSpawn({ refuse: true });
    await expect(startClaude({ binary: "claude", appData, instanceId: "a", spawn: refused.spawn, parentEnv: {}, cwd })).rejects.toThrow("no");
    expect(refused.spawn.child.kill).toHaveBeenCalled();

    const { spawn } = fakeSpawn();
    const onExit = vi.fn();
    const claude = await startClaude({ binary: "claude", appData, instanceId: "a", spawn, parentEnv: {}, cwd, onExit });
    const usage = claude.request("get_usage");
    spawn.child.emit("exit", 1);
    await expect(usage).rejects.toThrow("Claude Code stopped");
    expect(onExit).toHaveBeenCalledWith(1);
  });

  it("works from a folder whose path holds no user name", () => {
    expect(workFolder("a", { platformName: "win32", env: { ProgramData: "D:\\ProgramData", USERNAME: "someone" } }))
      .toBe("D:\\ProgramData\\Draggy\\claude-a");
    expect(workFolder("a", { platformName: "win32", env: {} })).toBe("C:\\ProgramData\\Draggy\\claude-a");
    expect(workFolder("a", { platformName: "darwin", uid: 501 })).toBe("/tmp/draggy-501-claude-a");
    expect(workFolder("a", { platformName: "linux", uid: 1000 })).toBe("/tmp/draggy-1000-claude-a");
  });

  it("starts a session by id, resumes it, and forks it at a reply", () => {
    const base = { model: "sonnet", effort: "high", systemPrompt: "Be brief.", sessionId: "s1" };
    expect(sessionArgs(base)).toEqual([
      "--system-prompt", "Be brief.", "--model", "sonnet", "--effort", "high", "--thinking", "adaptive", "--session-id", "s1",
    ]);
    expect(sessionArgs({ ...base, thinking: false, resume: true }).slice(-4)).toEqual(["--thinking", "disabled", "--resume", "s1"]);
    expect(sessionArgs({ ...base, resume: true, at: "u9" }).slice(-4)).toEqual(["--resume", "s1", "--resume-session-at=u9", "--fork-session"]);
  });
});
