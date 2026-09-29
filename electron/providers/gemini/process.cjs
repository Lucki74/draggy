/** One Gemini CLI process per conversation, speaking ACP over stdio with only Draggy's tools left
 * (gemini/MODE.md §3). Its settings, system prompt and tools are fixed when it starts. */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const platform = require("../../platform.cjs");
const { accountEnv } = require("../account/env.cjs");
const { createRpc, drainStderr } = require("../rpc.cjs");

const SERVER = "draggy";
const TOOL_PREFIX = `mcp_${SERVER}_`;
// A pending tool call waits on the user's approval, so the runtime's per-call limit sits far above any wait.
const TOOL_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const FLAGS = ["--acp", "--skip-trust"];
const CLIENT = { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } };

/** The CLI tells the model its temporary folder, which lies inside its home, so both paths hold no user name. */
function neutralPaths(instanceId, { platformName = process.platform, env = process.env, uid = process.getuid?.() } = {}) {
  const base = platformName === "win32"
    ? path.win32.join(env.ProgramData || "C:\\ProgramData", "Draggy", `gemini-${instanceId}`)
    : path.posix.join("/tmp", `draggy-${uid}-gemini-${instanceId}`);
  return { link: base, cwd: `${base}-work` };
}

const unavailable = (message) => Object.assign(new Error(message), { code: "account-runtime-unavailable" });

function samePath(a, b, platformName) {
  const clean = (p) => path.resolve(String(p).replace(/^\\\\\?\\/, "")).replace(/[\\/]+$/, "");
  return platformName === "win32" ? clean(a).toLowerCase() === clean(b).toLowerCase() : clean(a) === clean(b);
}

/** The home the CLI sees is a link to the private one, which keeps the user profile's permissions on the
 * credentials. A link that is not ours, or a real folder, stops the start rather than being used. */
function linkHome(link, target, { platformName = process.platform } = {}) {
  let stat = null;
  try {
    stat = fs.lstatSync(link);
  } catch {
    /* not made yet */
  }
  if (!stat) {
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, "junction");
    return link;
  }
  if (stat.isSymbolicLink() && samePath(fs.readlinkSync(link), target, platformName)) return link;
  throw unavailable(`${link} is not Draggy's link to the Google account's folder.`);
}

/** Written for each process; the system scope outranks any user or workspace settings the CLI finds. */
function settingsFor({ tools, model, mcpUrl }) {
  return {
    tools: { core: tools.map((name) => `${TOOL_PREFIX}${name}`) },
    ...(model ? { model: { name: model } } : {}),
    context: { includeDirectoryTree: false },
    general: { enableAutoUpdate: false, enableAutoUpdateNotification: false, checkpointing: { enabled: false } },
    privacy: { usageStatisticsEnabled: false },
    telemetry: { enabled: false },
    skills: { enabled: false },
    hooksConfig: { enabled: false },
    security: { auth: { selectedType: "oauth-personal" } },
    mcpServers: { [SERVER]: { httpUrl: mcpUrl, timeout: TOOL_TIMEOUT_MS } },
  };
}

/** The environment for one start; the three run files replace the machine's own settings and the CLI's prompt. */
function geminiEnv({ appData, instanceId, parentEnv, link, files }) {
  const { env, home } = accountEnv({
    runtime: "gemini",
    appData,
    instanceId,
    parent: parentEnv,
    extra: {
      ELECTRON_RUN_AS_NODE: "1",
      GEMINI_FORCE_FILE_STORAGE: "true",
      ...(files ? {
        GEMINI_SYSTEM_MD: files.prompt,
        GEMINI_CLI_SYSTEM_SETTINGS_PATH: files.settings,
        GEMINI_CLI_SYSTEM_DEFAULTS_PATH: files.defaults,
      } : {}),
    },
  });
  return { env: { ...env, HOME: link, USERPROFILE: link, GEMINI_CLI_HOME: link }, home };
}

/** Resolves once `initialize` is answered; `onRequest` answers the CLI's own requests. */
async function startGemini({
  entry,
  appData,
  instanceId,
  tools = [],
  model,
  mcpUrl,
  systemPrompt = "",
  onNotification = () => {},
  onRequest = async () => ({}),
  onExit = () => {},
  log = () => {},
  spawn = platform.spawnHidden,
  execPath = process.execPath,
  parentEnv = process.env,
  paths = neutralPaths(instanceId),
}) {
  const run = path.join(appData, "gemini", "run", crypto.randomBytes(12).toString("hex"));
  const files = { settings: `${run}.settings.json`, defaults: `${run}.defaults.json`, prompt: `${run}.md` };
  const { env, home } = geminiEnv({ appData, instanceId, parentEnv, link: paths.link, files });
  fs.mkdirSync(home, { recursive: true });
  linkHome(paths.link, home);
  fs.mkdirSync(paths.cwd, { recursive: true });
  fs.mkdirSync(path.dirname(run), { recursive: true });
  fs.writeFileSync(files.settings, JSON.stringify(settingsFor({ tools, model, mcpUrl }), null, 2));
  fs.writeFileSync(files.defaults, "{}");
  fs.writeFileSync(files.prompt, systemPrompt);
  const removeFiles = () => {
    for (const file of Object.values(files)) fs.rmSync(file, { force: true });
  };

  const child = spawn(execPath, [entry, ...FLAGS], { cwd: paths.cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  drainStderr(child.stderr, log);
  const rpc = createRpc({ input: child.stdout, output: child.stdin, jsonrpc: true, onNotification, onRequest, log, timeoutMs: 60_000 });

  let exited = false;
  const gone = new Promise((resolve) => {
    const done = (code) => {
      if (exited) return;
      exited = true;
      rpc.close();
      removeFiles();
      onExit(code);
      resolve();
    };
    child.on("exit", done);
    child.on("error", (error) => {
      log(`gemini failed to start: ${error.message}`);
      done(null);
    });
  });

  async function stop() {
    if (exited) return;
    child.kill();
    await Promise.race([gone, new Promise((resolve) => setTimeout(resolve, 5000))]);
  }

  let init;
  try {
    init = await rpc.call("initialize", CLIENT);
  } catch (error) {
    await stop();
    throw error;
  }
  return { init, rpc, stop, home, link: paths.link, cwd: paths.cwd };
}

module.exports = { startGemini, geminiEnv, settingsFor, linkHome, neutralPaths, FLAGS, CLIENT, SERVER, TOOL_PREFIX, TOOL_TIMEOUT_MS };
