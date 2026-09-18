const http = require("node:http");
const platform = require("./platform.cjs");

let activeProcess = null;
let activeModel = null;
let activePort = 11435;
let activeContext = 8192;

/** Checks if the local llama-server health endpoint responds with HTTP 200. */
function pingHealth(port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: timeoutMs }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Waits for llama-server to become responsive with a deadline. */
async function waitForReady(port, maxWaitMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await pingHealth(port, 1500)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** Spawns llama-server hidden and returns once its health check answers. */
async function startServer({ binaryPath, modelPath, contextSize = 8192, port = 11435, gpuLayers = 99, log }) {
  if (activeProcess) {
    if (activeModel === modelPath && activeContext === contextSize && (await pingHealth(port))) {
      return { success: true, port, alreadyRunning: true };
    }
    stopServerSync();
  }

  const args = [
    "-m", modelPath,
    "--port", String(port),
    "--host", "127.0.0.1",
    "-c", String(contextSize),
    "-ngl", String(gpuLayers),
    "-b", "512",
    "-ub", "512",
    "--jinja",
  ];

  try {
    const child = platform.spawnHidden(binaryPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    activeProcess = child;
    activeModel = modelPath;
    activePort = port;
    activeContext = contextSize;

    child.on("exit", () => {
      if (activeProcess === child) {
        activeProcess = null;
        activeModel = null;
      }
    });

    const ready = await waitForReady(port);
    if (!ready) {
      stopServerSync();
      return { success: false, error: "Server failed to respond to health check in time" };
    }

    if (log && typeof log.info === "function") {
      log.info("llama", `llama-server ready on 127.0.0.1:${port}`);
    }

    return { success: true, port };
  } catch (err) {
    stopServerSync();
    return { success: false, error: err.message };
  }
}

/** Kills active server process tree synchronously on quit or restart. */
function stopServerSync() {
  if (!activeProcess) return;
  const child = activeProcess;
  activeProcess = null;
  activeModel = null;
  platform.killTreeSync(child);
}

/** Reports current status and model loaded in memory. */
function getServerStatus() {
  return {
    running: activeProcess !== null && activeProcess.exitCode === null,
    port: activePort,
    model: activeModel,
    contextSize: activeContext,
    baseUrl: `http://127.0.0.1:${activePort}/v1`,
  };
}

module.exports = {
  startServer,
  stopServerSync,
  getServerStatus,
  pingHealth,
};
