/** One Claude Code process per conversation, speaking stream-json over stdio with every built-in stripped
 * (claude/MODE.md §3). Draggy answers the runtime's control requests itself, tools included. */
const fs = require("node:fs");
const path = require("node:path");
const platform = require("../../platform.cjs");
const { accountEnv } = require("../account/env.cjs");
const { drainStderr, splitLines, DEFAULT_MAX_LINE_BYTES } = require("../rpc.cjs");

const SERVER = "draggy";
const TOOL_PREFIX = `mcp__${SERVER}__`;
// A pending tool call waits on the user's approval, so the runtime's per-call limit sits far above any wait.
const TOOL_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const FLAGS = [
  "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
  "--tools", "", "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands",
  "--permission-prompt-tool", "stdio",
  "--mcp-config", JSON.stringify({ mcpServers: { [SERVER]: { type: "sdk", name: SERVER } } }),
];

const QUIET = {
  DISABLE_TELEMETRY: "1",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  DISABLE_ERROR_REPORTING: "1",
  DISABLE_AUTOUPDATER: "1",
};

/** The runtime tells the model its working folder, so it is one whose path holds no user name (MODE.md §3). */
function workFolder(instanceId, { platformName = process.platform, env = process.env, uid = process.getuid?.() } = {}) {
  if (platformName === "win32") return path.win32.join(env.ProgramData || "C:\\ProgramData", "Draggy", `claude-${instanceId}`);
  return path.posix.join("/tmp", `draggy-${uid}-claude-${instanceId}`);
}

/** Session flags for one start: a new session gets its id, a stored one is resumed, and `at` forks it there. */
function sessionArgs({ model, effort, thinking = true, systemPrompt, sessionId, resume = false, at }) {
  const args = ["--system-prompt", systemPrompt ?? ""];
  if (model) args.push("--model", model);
  if (effort) args.push("--effort", effort);
  args.push("--thinking", thinking ? "adaptive" : "disabled");
  if (!resume) args.push("--session-id", sessionId);
  else if (at) args.push("--resume", sessionId, `--resume-session-at=${at}`, "--fork-session");
  else args.push("--resume", sessionId);
  return args;
}

/** Resolves once `initialize` is answered; `onControl` answers the runtime's own requests. */
async function startClaude({
  binary,
  appData,
  instanceId,
  args = [],
  onMessage = () => {},
  onControl = async () => ({}),
  onExit = () => {},
  log = () => {},
  spawn = platform.spawnHidden,
  parentEnv = process.env,
  cwd = workFolder(instanceId),
}) {
  const { env, home } = accountEnv({ runtime: "claude", appData, instanceId, parent: parentEnv, extra: QUIET });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  const child = spawn(binary, [...FLAGS, ...args], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  drainStderr(child.stderr, log);

  const pending = new Map();
  let nextId = 1;
  let exited = false;
  const write = (message) => {
    if (!exited) child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  async function answer({ request_id, request }) {
    try {
      const response = await onControl(request);
      write({ type: "control_response", response: { subtype: "success", request_id, response } });
    } catch (error) {
      write({ type: "control_response", response: { subtype: "error", request_id, error: error.message } });
    }
  }

  splitLines(child.stdout, DEFAULT_MAX_LINE_BYTES, (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      log(`claude wrote a line that is not JSON (${line.length} chars)`);
      return;
    }
    if (message.type === "control_request") return void answer(message);
    if (message.type === "control_response") {
      const { request_id, subtype, response, error } = message.response ?? {};
      const waiter = pending.get(request_id);
      if (!waiter) return;
      pending.delete(request_id);
      if (subtype === "success") waiter.resolve(response ?? {});
      else waiter.reject(new Error(error || "Claude Code refused the request"));
      return;
    }
    if (message.type === "control_cancel_request") return;
    onMessage(message);
  }, (bytes) => log(`claude wrote a line of ${bytes} bytes, dropped`));

  const gone = new Promise((resolve) => {
    const done = (code) => {
      if (exited) return;
      exited = true;
      for (const waiter of pending.values()) waiter.reject(new Error("Claude Code stopped"));
      pending.clear();
      onExit(code);
      resolve();
    };
    child.on("exit", done);
    child.on("error", (error) => {
      log(`claude failed to start: ${error.message}`);
      done(null);
    });
  });

  function request(subtype, fields = {}) {
    if (exited) return Promise.reject(new Error("Claude Code stopped"));
    const request_id = `draggy-${nextId++}`;
    return new Promise((resolve, reject) => {
      pending.set(request_id, { resolve, reject });
      write({ type: "control_request", request_id, request: { subtype, ...fields } });
    });
  }

  const sendUser = (content) =>
    write({ type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: "" });

  async function stop() {
    if (exited) return;
    child.kill();
    await Promise.race([gone, new Promise((resolve) => setTimeout(resolve, 5000))]);
  }

  let init;
  try {
    init = await request("initialize", {
      sdkMcpServers: [SERVER],
      sdkMcpServerConfigs: { [SERVER]: { timeout: TOOL_TIMEOUT_MS } },
      title: "Draggy",
    });
  } catch (error) {
    await stop();
    throw error;
  }
  return { init, request, sendUser, stop, home, cwd };
}

module.exports = { startClaude, sessionArgs, workFolder, FLAGS, QUIET, SERVER, TOOL_PREFIX, TOOL_TIMEOUT_MS };
