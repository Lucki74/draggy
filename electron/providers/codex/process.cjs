/** One `codex app-server` per ChatGPT account, in its own CODEX_HOME, with every built-in switched off by a
 * config Draggy rewrites before each start (codex/MODE.md §3), so a hand edit never brings one back. */
const fs = require("node:fs");
const path = require("node:path");
const platform = require("../../platform.cjs");
const { accountEnv } = require("../account/env.cjs");
const { createRpc, drainStderr } = require("../rpc.cjs");

const CATALOG = path.join(__dirname, "models.json");
const CATALOG_NAME = "draggy-models.json";

const FEATURES_OFF = [
  "code_mode", "code_mode_only", "context_management", "current_time_reminder", "deferred_executor",
  "image_generation", "memories", "multi_agent", "multi_agent_v2", "plugins", "request_permissions_tool",
  "shell_snapshot", "shell_tool", "standalone_web_search", "token_budget", "tool_suggest", "unified_exec",
  "view_image", "goals", "apps", "browser_use", "computer_use", "in_app_browser", "skill_search",
  "sleep_tool", "hooks",
];

/** `topLevel` and `tables` exist for scripts/codex-probe.cjs, which points Codex at a mock; the app passes neither. */
function configToml(catalogPath, { topLevel = [], tables = [] } = {}) {
  return [
    `model_catalog_json = ${JSON.stringify(catalogPath)}`,
    ...topLevel,
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
    ...tables,
    "",
  ].join("\n");
}

/** Each model's context window from the catalog Codex is given, since `model/list` leaves it out. */
function contextWindows() {
  const { models = [] } = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  return new Map(models.filter((m) => m.context_window > 0).map((m) => [m.slug, m.context_window]));
}

function writeHome(home) {
  fs.mkdirSync(home, { recursive: true });
  const catalogPath = path.join(home, CATALOG_NAME);
  fs.copyFileSync(CATALOG, catalogPath);
  fs.writeFileSync(path.join(home, "config.toml"), configToml(catalogPath));
}

const ARGS = ["--strict-config", "--session-source", "draggy", "--listen", "stdio://"];

/** Resolves once the handshake is done; `onExit` fires when the process goes, on purpose or not. */
async function startCodex({
  binary,
  appData,
  instanceId,
  version,
  onNotification,
  onRequest,
  onExit = () => {},
  log = () => {},
  spawn = platform.spawnHidden,
  parentEnv = process.env,
}) {
  const { env, home } = accountEnv({ runtime: "codex", appData, instanceId, parent: parentEnv });
  writeHome(home);
  const child = spawn(binary, ARGS, { cwd: home, env, stdio: ["pipe", "pipe", "pipe"] });
  drainStderr(child.stderr, log);
  const rpc = createRpc({ input: child.stdout, output: child.stdin, onNotification, onRequest, log });

  let exited = false;
  const gone = new Promise((resolve) => {
    const done = (code) => {
      if (exited) return;
      exited = true;
      rpc.close();
      onExit(code);
      resolve();
    };
    child.on("exit", done);
    child.on("error", (error) => {
      log(`codex failed to start: ${error.message}`);
      done(null);
    });
  });

  async function stop() {
    if (exited) return;
    rpc.close();
    child.kill();
    await Promise.race([gone, new Promise((resolve) => setTimeout(resolve, 5000))]);
  }

  try {
    await rpc.call("initialize", {
      clientInfo: { name: "draggy", title: "Draggy", version },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    rpc.notify("initialized");
  } catch (error) {
    await stop();
    throw error;
  }
  return { rpc, home, stop };
}

module.exports = { startCodex, configToml, writeHome, contextWindows, FEATURES_OFF, ARGS, CATALOG_NAME };
