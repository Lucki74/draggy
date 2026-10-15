/** Every duration above which the log warns, in one place. Tune a limit here, not at the call site. */

const DEFAULT_IPC_SLOW_MS = 2000;

/** Channels that legitimately run long: model downloads, engine starts, code runs, tool calls. */
const IPC_SLOW_MS = {
  "models:download": 30000,
  "gguf:download": 30000,
  "gguf:setup-engine": 60000,
  "gguf:start": 120000,
  "colibri:install": 60000,
  "colibri:start": 120000,
  "largemodel:download": 30000,
  "hardware:benchmark": 120000,
  "sd:setup-engine": 60000,
  "sd:download-repo": 30000,
  "sd:generate": 300000,
  "run-code": 60000,
  "mcp:call": 120000,
  "mcp:start": 60000,
  "mcp:start-enabled": 60000,
  "updater:download": 120000,
  "updater:check": 15000,
  "search-web": 15000,
  "search-web-detailed": 30000,
  "get-page-content": 30000,
  "search-models": 15000,
  "check-internet": 10000,
};

module.exports = { DEFAULT_IPC_SLOW_MS, IPC_SLOW_MS };
