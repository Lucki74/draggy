/** The environment an account runtime starts with, built from an allowlist. A stray key or proxy in the user's
 * shell would turn a plan turn into a billed or proxied one (hard rule 13), so nothing else is inherited. */
const path = require("node:path");

const HOME_VARIABLE = { codex: "CODEX_HOME", claude: "CLAUDE_CONFIG_DIR", gemini: "GEMINI_CLI_HOME" };
const INHERITED = ["PATH", "SystemRoot", "TEMP", "TMP", "TMPDIR", "LANG"];

// Named so a test can prove none gets through; the allowlist alone already keeps them out.
const NEVER = [
  "OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_API_KEY",
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX",
  "GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI",
  "GOOGLE_CLOUD_PROJECT", "GOOGLE_APPLICATION_CREDENTIALS",
];

const forbidden = (name) => NEVER.includes(name.toUpperCase()) || /proxy/i.test(name);

function privateHome(appData, runtime, instanceId) {
  if (!HOME_VARIABLE[runtime]) throw new Error(`Unknown account runtime: ${runtime}`);
  if (!/^[\w-]+$/.test(String(instanceId))) throw new Error("An instance id names one folder, nothing more");
  return path.join(appData, runtime, instanceId);
}

/** Windows keeps variable names case-insensitive, so `Path` and `PATH` are the same one. */
function lookup(parent, name) {
  const key = Object.keys(parent).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : parent[key];
}

function accountEnv({ runtime, appData, instanceId, parent = process.env, extra = {} }) {
  const home = privateHome(appData, runtime, instanceId);
  const env = {};
  for (const name of INHERITED) {
    const value = lookup(parent, name);
    if (value !== undefined) env[name] = value;
  }
  for (const [name, value] of Object.entries(extra)) {
    if (forbidden(name)) throw new Error(`${name} never reaches an account runtime`);
    env[name] = value;
  }
  env.HOME = home;
  env.USERPROFILE = home;
  env[HOME_VARIABLE[runtime]] = home;
  return { env, home };
}

module.exports = { accountEnv, privateHome, HOME_VARIABLE, NEVER };
