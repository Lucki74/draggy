// node scripts/claude-probe.cjs <claude binary>: proves a Claude Code build strips every built-in tool.
// One turn against a local mock of the Messages API; the dummy key only ever reaches that mock.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const platform = require(path.join(__dirname, "..", "electron", "platform.cjs"));

const binary = path.resolve(process.argv[2] || "");
if (!fs.existsSync(binary)) {
  console.error("usage: node scripts/claude-probe.cjs <path to the claude binary>");
  process.exit(2);
}
const PROMPT = "You are Draggy. Probe instructions.";
const TOOL = { name: "probe", description: "Probe tool.", inputSchema: { type: "object", properties: {} } };

function sse(res, model, block, stopReason) {
  const events = [
    { type: "message_start", message: { id: "msg_probe", type: "message", role: "assistant", model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: block.start },
    { type: "content_block_delta", index: 0, delta: block.delta },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: stopReason }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ];
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const event of events) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  res.end();
}

(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-claude-probe-"));
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (req.method !== "POST" || !req.url.startsWith("/v1/messages") || req.url.includes("count_tokens")) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end('{"type":"error","error":{"type":"not_found_error","message":"probe"}}');
      }
      const parsed = JSON.parse(body);
      requests.push(parsed);
      // The first answer asks for a built-in that must not exist; the second ends the turn.
      if (requests.length === 1) sse(res, parsed.model, { start: { type: "tool_use", id: "toolu_probe", name: "Bash", input: {} }, delta: { type: "input_json_delta", partial_json: '{"command":"echo probe"}' } }, "tool_use");
      else sse(res, parsed.model, { start: { type: "text", text: "" }, delta: { type: "text_delta", text: "ok" } }, "end_turn");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const args = [
    "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    "--tools", "", "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands",
    "--no-session-persistence", "--permission-prompt-tool", "stdio", "--system-prompt", PROMPT,
    "--mcp-config", JSON.stringify({ mcpServers: { draggy: { type: "sdk", name: "draggy" } } }),
  ];
  const child = platform.spawnHidden(binary, args, {
    cwd: home,
    env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
      CLAUDE_CONFIG_DIR: home, USERPROFILE: home, HOME: home, DISABLE_TELEMETRY: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_ERROR_REPORTING: "1", DISABLE_AUTOUPDATER: "1",
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, ANTHROPIC_API_KEY: "probe-not-a-key",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const asked = [];
  let init = null;
  let finished = false;
  let buffer = "";
  const answer = (id, response) => child.stdin.write(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: id, response } }) + "\n");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (let i; (i = buffer.indexOf("\n")) !== -1; ) {
      const message = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      if (message.type === "system" && message.subtype === "init") init = message;
      if (message.type === "result") finished = true;
      if (message.type !== "control_request") continue;
      const { subtype } = message.request;
      if (subtype === "can_use_tool") {
        asked.push(message.request.tool_name);
        answer(message.request_id, { behavior: "deny", message: "Only Draggy's tools may run." });
      } else if (subtype === "mcp_message") {
        const rpc = message.request.message;
        const result = rpc.method === "initialize"
          ? { protocolVersion: rpc.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "draggy", version: "probe" } }
          : rpc.method === "tools/list" ? { tools: [TOOL] } : {};
        answer(message.request_id, { mcp_response: rpc.id === undefined ? { jsonrpc: "2.0", result: {}, id: 0 } : { jsonrpc: "2.0", id: rpc.id, result } });
      } else answer(message.request_id, {});
    }
  });
  child.stdin.write(JSON.stringify({ type: "control_request", request_id: "init", request: { subtype: "initialize", sdkMcpServers: ["draggy"], title: "Draggy" } }) + "\n");
  child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: "hi" }, parent_tool_use_id: null, session_id: "" }) + "\n");
  for (let waited = 0; !finished && waited < 60000; waited += 100) await new Promise((resolve) => setTimeout(resolve, 100));
  child.stdin.end();
  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(() => child.kill(), 5000);
  });
  server.close();
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 });

  const tools = requests[0]?.tools?.map((tool) => tool.name) ?? [];
  const system = (requests[0]?.system ?? []).map((block) => block.text).join("\n");
  const refused = JSON.stringify(requests[1]?.messages ?? []).includes("No such tool available: Bash");
  const checks = [
    ["the model saw only Draggy's tool", tools.length === 1 && tools[0] === "mcp__draggy__probe", tools.join(",")],
    ["init listed only Draggy's tool", JSON.stringify(init?.tools) === '["mcp__draggy__probe"]', JSON.stringify(init?.tools)],
    ["no skills or slash commands", !init?.skills?.length && !init?.slash_commands?.length, `${init?.skills?.length} skills`],
    ["Draggy's prompt reached the model", system.includes(PROMPT), `${system.length} chars`],
    ["a call to Bash was refused without running", refused && !asked.includes("Bash"), `asked: ${asked.join(",") || "none"}`],
  ];
  for (const [name, ok, detail] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name} (${detail})`);
  const failed = checks.some(([, ok]) => !ok);
  console.log(failed ? "\nA Claude Code built-in is reachable: do not pin this version." : "\nOnly Draggy's tool reached the model.");
  process.exit(failed ? 1 : 0);
})();
