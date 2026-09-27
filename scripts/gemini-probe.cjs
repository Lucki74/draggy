// node scripts/gemini-probe.cjs <gemini.js entry>: proves a Gemini CLI build strips every built-in tool.
// One ACP turn against a local mock of the Gemini API; the dummy key only ever reaches that mock.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const platform = require(path.join(__dirname, "..", "electron", "platform.cjs"));

const entry = path.resolve(process.argv[2] || "");
if (!fs.existsSync(entry)) {
  console.error("usage: node scripts/gemini-probe.cjs <path to @google/gemini-cli/bundle/gemini.js>");
  process.exit(2);
}
const PROMPT = "You are Draggy. Probe instructions.";

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const readBody = (req) => new Promise((resolve) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => resolve(body));
});

(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-gemini-probe-"));
  const work = path.join(home, "work");
  fs.mkdirSync(path.join(home, ".gemini"), { recursive: true });
  fs.mkdirSync(work);
  fs.writeFileSync(path.join(home, "system.md"), PROMPT);
  fs.writeFileSync(path.join(home, ".gemini", "settings.json"), JSON.stringify({
    tools: { core: ["mcp_draggy_probe"] },
    model: { name: "gemini-2.5-pro" },
    context: { includeDirectoryTree: false },
    general: { enableAutoUpdate: false, enableAutoUpdateNotification: false, checkpointing: { enabled: false } },
    privacy: { usageStatisticsEnabled: false },
    telemetry: { enabled: false },
    skills: { enabled: false },
    hooksConfig: { enabled: false },
    security: { auth: { selectedType: "gemini-api-key" } },
  }));

  const requests = [];
  const api = http.createServer(async (req, res) => {
    const body = await readBody(req);
    if (!req.url.includes(":streamGenerateContent")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end('{"error":{"code":404,"message":"probe","status":"NOT_FOUND"}}');
    }
    requests.push(JSON.parse(body));
    // The first answer asks for a built-in that must not exist; the second ends the turn.
    const part = requests.length === 1 ? { functionCall: { name: "run_shell_command", args: { command: "echo probe" } } } : { text: "ok" };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [part] }, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } })}\r\n\r\n`);
  });
  const mcp = http.createServer(async (req, res) => {
    const message = JSON.parse((await readBody(req)) || "{}");
    if (message.id === undefined) return res.writeHead(202).end();
    const result = message.method === "initialize"
      ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "draggy", version: "probe" } }
      : message.method === "tools/list" ? { tools: [{ name: "probe", description: "Probe tool.", inputSchema: { type: "object", properties: {} } }] } : {};
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  const apiPort = await listen(api);
  const mcpPort = await listen(mcp);

  // A packaged Draggy runs it with Electron's own executable; plain Node is the same runtime here.
  const child = platform.spawnHidden(process.execPath, [entry, "--acp", "--skip-trust"], {
    cwd: work,
    env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
      GEMINI_CLI_HOME: home, HOME: home, USERPROFILE: home, GEMINI_SYSTEM_MD: path.join(home, "system.md"),
      GEMINI_API_KEY: "probe-not-a-key", GOOGLE_GEMINI_BASE_URL: `http://127.0.0.1:${apiPort}`,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const waiting = new Map();
  const asked = [];
  let nextId = 1;
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (let i; (i = buffer.indexOf("\n")) !== -1; ) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id !== undefined && !message.method) waiting.get(message.id)?.(message);
      else if (message.method === "session/request_permission") {
        asked.push(message.params.toolCall?.title);
        const reject = message.params.options.find((option) => /reject/.test(option.kind)) ?? message.params.options[0];
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { outcome: { outcome: "selected", optionId: reject.optionId } } }) + "\n");
      }
    }
  });
  const call = (method, params) => new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => resolve({ error: { message: `${method} timed out` } }), 60000);
  });

  await call("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
  const session = await call("session/new", { cwd: work, mcpServers: [{ type: "http", name: "draggy", url: `http://127.0.0.1:${mcpPort}/mcp`, headers: [] }] });
  const turn = await call("session/prompt", { sessionId: session.result?.sessionId, prompt: [{ type: "text", text: "hi" }] });
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill();
  });
  api.close();
  mcp.close();
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 });

  const tools = (requests[0]?.tools ?? []).flatMap((tool) => (tool.functionDeclarations ?? []).map((f) => f.name).concat(Object.keys(tool).filter((k) => k !== "functionDeclarations")));
  const system = JSON.stringify(requests[0]?.systemInstruction ?? "");
  const refused = JSON.stringify(requests[1]?.contents ?? []).includes("not found in registry");
  const checks = [
    ["the turn completed", turn.result?.stopReason === "end_turn", JSON.stringify(turn.result?.stopReason ?? turn.error)],
    ["the model saw only Draggy's tool", tools.length === 1 && tools[0] === "mcp_draggy_probe", tools.join(",")],
    ["Draggy's prompt replaced the CLI's", system.includes(PROMPT) && system.length < PROMPT.length + 100, `${system.length} chars`],
    ["a call to run_shell_command was refused without running", refused && asked.length === 0, `asked: ${asked.join(",") || "none"}`],
  ];
  for (const [name, ok, detail] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name} (${detail})`);
  const failed = checks.some(([, ok]) => !ok);
  console.log(failed ? "\nA Gemini CLI built-in is reachable: do not pin this version." : "\nOnly Draggy's tool reached the model.");
  process.exit(failed ? 1 : 0);
})();
