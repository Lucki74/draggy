const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const {
  IS_WINDOWS,
  defaultShellEnv,
  killTree,
  pythonCandidates,
  runCommand,
  spawnHidden,
} = require("./platform.cjs");
const { log } = require("./logger.cjs");

const DEFAULT_TIMEOUT_MS = 20000;
const MAX_TIMEOUT_MS = 120000;
const MAX_OUTPUT_CHARS = 20000;
const MAX_SOURCE_CHARS = 200000;

const LANGUAGES = {
  python: { extension: ".py", label: "Python" },
  javascript: { extension: ".mjs", label: "JavaScript" },
};

const ALIASES = {
  py: "python",
  python3: "python",
  js: "javascript",
  node: "javascript",
  nodejs: "javascript",
};

function normaliseLanguage(value) {
  const key = String(value || "").toLowerCase().trim();
  return ALIASES[key] || (LANGUAGES[key] ? key : null);
}

let pythonPath = undefined;

async function resolvePython() {
  if (pythonPath !== undefined) return pythonPath;

  for (const candidate of pythonCandidates()) {
    const out = await runCommand(candidate, ["--version"], 5000);
    if (out !== null) {
      pythonPath = candidate;
      return pythonPath;
    }
  }

  pythonPath = null;
  return pythonPath;
}

function truncate(text) {
  if (text.length <= MAX_OUTPUT_CHARS) return { text, truncated: false };
  return {
    text: text.slice(0, MAX_OUTPUT_CHARS),
    truncated: true,
  };
}

/**
 * Every run currently in flight. A program with a twenty-second budget outlives
 * a quit otherwise, and on macOS and Linux it is detached into its own group.
 */
const live = new Set();

/** Kills every run still going. Called when the app is on its way out. */
function stopAll() {
  for (const child of [...live]) {
    live.delete(child);
    killTree(child);
  }
}

function runsDir(userDataPath) {
  return path.join(userDataPath, "code_runs");
}

function minimalEnv(workdir) {
  const base = defaultShellEnv();

  return {
    PATH: base.PATH || base.Path || "",
    HOME: workdir,
    USERPROFILE: workdir,
    TMPDIR: workdir,
    TEMP: workdir,
    TMP: workdir,
    SYSTEMROOT: base.SYSTEMROOT || base.SystemRoot || "",
    COMSPEC: base.COMSPEC || base.ComSpec || "",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONUNBUFFERED: "1",
    NO_COLOR: "1",
    LANG: "C.UTF-8",
  };
}

async function runCode({ userDataPath, language, source, timeoutMs }) {
  const kind = normaliseLanguage(language);
  if (!kind) {
    return {
      success: false,
      error: `Unsupported language "${language}". Use python or javascript.`,
    };
  }

  const code = String(source || "");
  if (!code.trim()) return { success: false, error: "No source code provided." };
  if (code.length > MAX_SOURCE_CHARS) {
    return { success: false, error: "Source is too long to run." };
  }

  let command;
  let args;

  if (kind === "python") {
    const resolved = await resolvePython();
    if (!resolved) {
      return {
        success: false,
        error:
          "Python is not installed on this machine, so Python code cannot be run here.",
      };
    }
    command = resolved;
    args = [];
  } else {
    command = process.execPath;
    args = [];
  }

  const root = runsDir(userDataPath);
  const workdir = path.join(root, crypto.randomBytes(6).toString("hex"));
  fs.mkdirSync(workdir, { recursive: true });

  const scriptPath = path.join(workdir, `main${LANGUAGES[kind].extension}`);
  fs.writeFileSync(scriptPath, code, "utf8");

  const limit = Math.min(
    Math.max(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 1000),
    MAX_TIMEOUT_MS,
  );

  const env = minimalEnv(workdir);
  if (kind === "javascript") env.ELECTRON_RUN_AS_NODE = "1";

  const started = Date.now();

  const result = await new Promise((resolve) => {
    const child = spawnHidden(command, [...args, scriptPath], {
      cwd: workdir,
      env,
      detached: !IS_WINDOWS,
      stdio: ["ignore", "pipe", "pipe"],
    });

    live.add(child);

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, limit);

    child.stdout.on("data", (chunk) => {
      if (stdout.length < MAX_OUTPUT_CHARS * 2) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_OUTPUT_CHARS * 2) stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      live.delete(child);
      resolve({ success: false, error: error.message });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      live.delete(child);
      const out = truncate(stdout);
      const err = truncate(stderr);

      resolve({
        success: !timedOut && code === 0,
        exitCode: code,
        signal: signal || null,
        timedOut,
        stdout: out.text,
        stderr: err.text,
        truncated: out.truncated || err.truncated,
        durationMs: Date.now() - started,
      });
    });
  });

  const produced = fs
    .readdirSync(workdir)
    .filter((name) => name !== path.basename(scriptPath));

  try {
    fs.rmSync(workdir, { recursive: true, force: true });
  } catch {
    log.warn("runner", `could not clean ${workdir}`);
  }

  return { ...result, language: kind, files: produced };
}

async function probe() {
  const python = await resolvePython();
  return {
    python: Boolean(python),
    pythonCommand: python || null,
    javascript: true,
    platform: `${process.platform} ${os.arch()}`,
  };
}

module.exports = {
  runCode,
  stopAll,
  probe,
  normaliseLanguage,
  LANGUAGES,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MAX_OUTPUT_CHARS,
};
