import { describe, expect, it } from "vitest";
import {
  HOOK_PAYLOAD_STRING_LIMIT,
  buildHookPayload,
  canContinueStop,
  clampTimeout,
  decideFromExit,
  hookFileDigest,
  hooksFor,
  isProjectHooksTrusted,
  parseHooksConfig,
  sanitizeHookEntries,
} from "../agent/hooks";

describe("parseHooksConfig", () => {
  it("reads entries per event with defaults", () => {
    const { hooks, errors } = parseHooksConfig({
      hooks: { PreToolUse: [{ matcher: "write_file|edit_file", command: "node check.js", timeout: 30 }], Stop: [{ command: "npm test" }] },
    });
    expect(errors).toEqual([]);
    expect(hooks).toEqual([
      { event: "PreToolUse", matcher: "write_file|edit_file", command: "node check.js", timeout: 30, enabled: true },
      { event: "Stop", matcher: "", command: "npm test", timeout: 60, enabled: true },
    ]);
  });

  it("skips bad entries and reports them", () => {
    const { hooks, errors } = parseHooksConfig({
      hooks: { PreToolUse: [{ command: "" }, { command: "ok", matcher: "(" }, "x"], Bogus: [], PostToolUse: "no" },
    });
    expect(hooks).toEqual([]);
    expect(errors).toHaveLength(5);
  });

  it("treats a missing or empty config as no hooks without errors", () => {
    expect(parseHooksConfig(undefined)).toEqual({ hooks: [], errors: [] });
    expect(parseHooksConfig({})).toEqual({ hooks: [], errors: [] });
  });

  it("keeps enabled false and clamps timeouts", () => {
    const { hooks } = parseHooksConfig({
      hooks: { SessionStart: [{ command: "a", enabled: false, timeout: 9999 }, { command: "b", timeout: -1 }] },
    });
    expect(hooks.map((hook) => [hook.enabled, hook.timeout])).toEqual([
      [false, 600],
      [true, 60],
    ]);
    expect(clampTimeout(0)).toBe(60);
  });
});

describe("hooksFor", () => {
  const { hooks } = parseHooksConfig({
    hooks: {
      PreToolUse: [
        { matcher: "write_file|edit_file", command: "a" },
        { matcher: "*", command: "b" },
        { command: "c", enabled: false },
        { matcher: "run_", command: "d" },
      ],
      Stop: [{ matcher: "nope", command: "e" }],
    },
  });

  it("matches tool names by regex", () => {
    expect(hooksFor(hooks, "PreToolUse", "edit_file").map((hook) => hook.command)).toEqual(["a", "b"]);
    expect(hooksFor(hooks, "PreToolUse", "run_command").map((hook) => hook.command)).toEqual(["b", "d"]);
  });

  it("ignores matcher on non-tool events", () => {
    expect(hooksFor(hooks, "Stop").map((hook) => hook.command)).toEqual(["e"]);
  });
});

describe("buildHookPayload", () => {
  it("drops tool fields on session and stop events", () => {
    const context = { session_id: "s1", cwd: "/p", permission_mode: "ask", tool_name: "x", stop_hook_active: false };
    expect(buildHookPayload("Stop", context)).toEqual({
      hook_event_name: "Stop",
      session_id: "s1",
      cwd: "/p",
      permission_mode: "ask",
      stop_hook_active: false,
    });
    expect(buildHookPayload("PreToolUse", context).tool_name).toBe("x");
  });
});

describe("decideFromExit", () => {
  it("exit 2 denies with stderr, then stdout", () => {
    expect(decideFromExit("PreToolUse", 2, "out", "no writes\n")).toEqual({ action: "deny", message: "no writes" });
    expect(decideFromExit("PreToolUse", 2, "out", "")).toEqual({ action: "deny", message: "out" });
  });

  it("other non-zero exits and timeouts are errors", () => {
    expect(decideFromExit("PreToolUse", 1, "", "boom").action).toBe("error");
    expect(decideFromExit("PreToolUse", null, "", "", true)).toEqual({ action: "error", message: "hook timed out" });
  });

  it("SessionStart stdout becomes context", () => {
    expect(decideFromExit("SessionStart", 0, " branch main \n", "")).toEqual({ action: "continue", context: "branch main" });
    expect(decideFromExit("PostToolUse", 0, "ignored", "")).toEqual({ action: "continue" });
  });
});

describe("stop loop and trust", () => {
  it("caps stop continues at three", () => {
    expect([0, 1, 2, 3].map(canContinueStop)).toEqual([true, true, true, false]);
  });

  it("digests file text and checks trust by exact match", async () => {
    const digest = await hookFileDigest('{"hooks":{}}');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(await hookFileDigest('{"hooks":{}}\n')).not.toBe(digest);
    expect(isProjectHooksTrusted(digest, digest)).toBe(true);
    expect(isProjectHooksTrusted(undefined, digest)).toBe(false);
    expect(isProjectHooksTrusted("old", digest)).toBe(false);
  });
});

describe("hook defaults", () => {
  it("never sets a timeout under one second", () => {
    const { hooks } = parseHooksConfig({ hooks: { Stop: [{ command: "a", timeout: 0.2 }] } });
    expect(hooks[0].timeout).toBe(1);
  });

  it("gives a Stop deny a default message", () => {
    expect(decideFromExit("Stop", 2, "", "")).toEqual({ action: "deny", message: "Stop hook blocked the finish." });
    expect(decideFromExit("PreToolUse", 2, "", "")).toEqual({ action: "deny", message: "Blocked by hook." });
  });
});

describe("buildHookPayload", () => {
  it("cuts long tool_response and tool_input strings and keeps short ones", () => {
    const big = "y".repeat(HOOK_PAYLOAD_STRING_LIMIT + 10);
    const payload = buildHookPayload("PostToolUse", {
      session_id: "c",
      cwd: "/p",
      permission_mode: "ask",
      tool_name: "run_command",
      tool_input: { command: "ls", blob: big },
      tool_response: big,
    });
    const input = payload.tool_input as { command: string; blob: string };
    expect(input.command).toBe("ls");
    expect(input.blob).toBe(`${"y".repeat(HOOK_PAYLOAD_STRING_LIMIT)}[cut]`);
    expect(payload.tool_response).toBe(`${"y".repeat(HOOK_PAYLOAD_STRING_LIMIT)}[cut]`);
  });
});

describe("sanitizeHookEntries", () => {
  it("drops hand-edited saved entries that would not parse", () => {
    const kept = sanitizeHookEntries([
      { event: "Stop", command: "npm test", timeout: 30, matcher: "", enabled: true },
      { event: "Stop", command: 42, timeout: NaN },
      { event: "Nope", command: "x" },
      "not an object",
    ]);
    expect(kept.map((entry) => entry.command)).toEqual(["npm test"]);
    expect(sanitizeHookEntries("bad")).toEqual([]);
  });
});
