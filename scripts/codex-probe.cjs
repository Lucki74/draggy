// node scripts/codex-probe.cjs <codex app-server binary>: proves a Codex build strips every built-in.
// Each catalog model gets one turn against a local mock of the Responses API; no account, no network.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const platform = require(path.join(__dirname, "..", "electron", "platform.cjs"));

const binary = path.resolve(process.argv[2] || "");
if (!fs.existsSync(binary)) {
  console.error("usage: node scripts/codex-probe.cjs <path to codex-app-server or codex>");
  process.exit(2);
}
// The full CLI needs its subcommand; the standalone app-server asset is the subcommand.
const leadArgs = /app-server/i.test(path.basename(binary)) ? [] : ["app-server"];
const PROBE_TOOL = { type: "function", name: "draggy_probe", description: "Probe tool.", inputSchema: { type: "object", properties: {} } };
const INSTRUCTIONS = "You are Draggy. Probe instructions.";

const FEATURES_OFF = [
  "code_mode", "code_mode_only", "context_management", "current_time_reminder", "deferred_executor",
  "image_generation", "memories", "multi_agent", "multi_agent_v2", "plugins", "request_permissions_tool",
  "shell_snapshot", "shell_tool", "standalone_web_search", "token_budget", "tool_suggest", "unified_exec",
  "view_image", "goals", "apps", "browser_use", "computer_use", "in_app_browser", "skill_search",
  "sleep_tool", "hooks",
];

function configToml(catalogPath, port) {
  return [
    `model_catalog_json = ${JSON.stringify(catalogPath)}`,
    'model_provider = "probe"',
    'web_search = "disabled"',
    'forced_login_method = "chatgpt"',
    'cli_auth_credentials_store = "file"',
    "check_for_update_on_startup = false",
    "include_permissions_instructions = false",
    "include_environment_context = false",
    "include_apps_instructions = false",
    "include_collaboration_mode_instructions = false",
    "project_doc_max_bytes = 0",
    "[analytics]", "enabled = false",
    "[feedback]", "enabled = false",
    "[features]", ...FEATURES_OFF.map((name) => `${name} = false`),
    "[skills]", "include_instructions = false",
    "[cloud.skills]", "enabled = false",
    "[tools.experimental_request_user_input]", "enabled = false",
    "[tools.update_plan]", "enabled = false",
    "[model_providers.probe]", 'name = "probe"', `base_url = "http://127.0.0.1:${port}/v1"`, 'wire_api = "responses"',
  ].join("\n");
}

/** The catalog is embedded in the binary as pretty-printed JSON; this walks it to its closing brace. */
function embeddedCatalog(file) {
  const text = fs.readFileSync(file).toString("latin1");
  const at = text.search(/\{\s*"models"\s*:\s*\[\s*\{\s*"slug"/);
  if (at === -1) throw new Error("no model catalog found in the binary");
  let depth = 0;
  let inString = false;
  for (let i = at; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return JSON.parse(Buffer.from(text.slice(at, i + 1), "latin1").toString("utf8"));
    }
  }
  throw new Error("the model catalog never closed");
}

/** Draggy's catalog: the same models, with the fields that bring code mode and sub-agents cleared. */
function plainCatalog(catalog) {
  return {
    models: catalog.models.map((model) => ({
      ...model,
      tool_mode: null,
      multi_agent_version: null,
      use_responses_lite: false,
      experimental_supported_tools: [],
    })),
  };
}

function toolNames(tool) {
  return tool.type === "namespace" ? tool.tools.flatMap(toolNames).map((name) => `${tool.name}.${name}`) : [tool.name || tool.type];
}

function sse(res, events) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const event of events) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  res.end();
}

async function probeModel(model, home, catalogPath) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (!req.url.endsWith("/responses")) return res.writeHead(404).end("{}");
      requests.push(JSON.parse(body));
      const id = `resp_${requests.length}`;
      const item = { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "ok", annotations: [] }] };
      sse(res, [
        { type: "response.created", response: { id } },
        { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: { id, usage: { input_tokens: 1, input_tokens_details: { cached_tokens: 0 }, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 2 } } },
      ]);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const codexHome = path.join(home, model);
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), configToml(catalogPath, server.address().port));

  const child = platform.spawnHidden(binary, [...leadArgs, "--strict-config", "--session-source", "draggy"], {
    cwd: codexHome,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, CODEX_HOME: codexHome, USERPROFILE: codexHome, HOME: codexHome },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const waiting = new Map();
  const events = [];
  let buffer = "";
  let nextId = 1;
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (let i; (i = buffer.indexOf("\n")) !== -1; ) {
      const message = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      if (message.id !== undefined && !message.method) waiting.get(message.id)?.(message);
      else events.push(message);
    }
  });
  const call = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      waiting.set(id, resolve);
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
      setTimeout(() => resolve({ error: { message: `${method} timed out` } }), 30000);
    });

  try {
    const init = await call("initialize", { clientInfo: { name: "draggy", title: "Draggy", version: "probe" }, capabilities: { experimentalApi: true, requestAttestation: false } });
    if (init.error) throw new Error(`initialize: ${init.error.message} ${stderr.trim().split("\n").pop()}`);
    child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    const thread = await call("thread/start", { model, cwd: codexHome, environments: [], ephemeral: true, baseInstructions: INSTRUCTIONS, dynamicTools: [PROBE_TOOL] });
    if (thread.error) throw new Error(`thread/start: ${thread.error.message}`);
    const turn = await call("turn/start", { threadId: thread.result.thread.id, input: [{ type: "text", text: "hi", text_elements: [] }] });
    if (turn.error) throw new Error(`turn/start: ${turn.error.message}`);
    for (let waited = 0; !events.some((e) => e.method === "turn/completed") && waited < 30000; waited += 50) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const body = requests[0];
    if (!body) throw new Error("the model was never asked");
    const extra = body.input.filter((item) => item.type === "additional_tools").flatMap((item) => item.tools);
    const tools = [...(body.tools || []), ...extra].flatMap(toolNames);
    const developer = body.input.filter((item) => item.role === "developer").length;
    const asks = events.filter((e) => e.id !== undefined).map((e) => e.method);
    return { model, tools, developer, ownInstructions: body.instructions === INSTRUCTIONS, asks };
  } finally {
    // Its databases stay locked until it has exited, so the folder cannot go before it does.
    await new Promise((resolve) => {
      child.once("exit", resolve);
      child.kill();
    });
    server.close();
  }
}

(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-codex-probe-"));
  const catalog = embeddedCatalog(binary);
  const catalogPath = path.join(home, "draggy-models.json");
  fs.writeFileSync(catalogPath, JSON.stringify(plainCatalog(catalog)));
  let failed = false;
  for (const { slug } of catalog.models) {
    try {
      const result = await probeModel(slug, home, catalogPath);
      const clean = result.tools.length === 1 && result.tools[0] === PROBE_TOOL.name && result.developer === 0 && result.ownInstructions && result.asks.length === 0;
      failed ||= !clean;
      console.log(`${clean ? "ok  " : "FAIL"} ${slug.padEnd(28)} tools=${result.tools.join(",")} developer=${result.developer} instructions=${result.ownInstructions ? "draggy" : "codex"}${result.asks.length ? ` asked=${result.asks.join(",")}` : ""}`);
    } catch (error) {
      failed = true;
      console.log(`FAIL ${slug.padEnd(28)} ${error.message}`);
    }
  }
  fs.rmSync(home, { recursive: true, force: true });
  console.log(failed ? "\nA Codex built-in reached the model: do not pin this version." : "\nEvery model saw only Draggy's tool and instructions.");
  process.exit(failed ? 1 : 0);
})();
