/** The pinned Gemini CLI, installed by the user's own npm from a lockfile shipped in the app, so every package
 * is checked against an integrity Draggy chose rather than whatever the registry serves (gemini/MODE.md §2). */
const fs = require("node:fs");
const path = require("node:path");
const platform = require("../../platform.cjs");

const VERSION = "0.61.0";
const LOCK = path.join(__dirname, "lock");
// Measured for 0.61.0 without its optional packages; the bar follows the folder's size toward it.
const EXPECTED_BYTES = 98_294_669;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const ENTRY = ["node_modules", "@google", "gemini-cli", "bundle", "gemini.js"];

const installDir = (appData) => path.join(appData, "gemini", "cli", VERSION);

function installedEntry(appData) {
  const file = path.join(installDir(appData), ...ENTRY);
  return fs.existsSync(file) ? file : null;
}

function folderBytes(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    try {
      total += entry.isDirectory() ? folderBytes(file) : fs.statSync(file).size;
    } catch {
      /* a file npm is still moving */
    }
  }
  return total;
}

const unavailable = (message) => Object.assign(new Error(message), { code: "account-runtime-unavailable" });

/** `npm ci` refuses a tree that differs from the lockfile; keytar and node-pty are optional and never wanted:
 * the shell tool is stripped, and credentials stay in a file in the private home. */
function runNpm({ npm, cwd }) {
  return new Promise((resolve) => {
    const child = platform.spawnHidden(
      npm.file,
      [...npm.prefixArgs, "ci", "--omit=optional", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel", "error"],
      { cwd, env: { ...platform.defaultShellEnv(), ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 4000) stderr += chunk;
    });
    const timer = setTimeout(() => child.kill(), INSTALL_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stderr: error.message });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

const installing = new Map();

/** Resolves to the CLI's entry point, installing it first if needed; `run` and `resolveNpm` are replaced in tests. */
function ensureGemini(appData, { run = runNpm, resolveNpm = platform.resolveNpm, onProgress = () => {}, pollMs = 500 } = {}) {
  const existing = installedEntry(appData);
  if (existing) return Promise.resolve(existing);
  if (!installing.has(appData)) {
    const job = install(appData, { run, resolveNpm, onProgress, pollMs }).finally(() => installing.delete(appData));
    installing.set(appData, job);
  }
  return installing.get(appData);
}

async function install(appData, { run, resolveNpm, onProgress, pollMs }) {
  const npm = resolveNpm();
  if (!npm) throw unavailable("The Google account needs npm, which comes with Node.js, to install the Gemini CLI.");

  const dir = installDir(appData);
  const staging = `${dir}.part`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  for (const name of ["package.json", "package-lock.json"]) fs.copyFileSync(path.join(LOCK, name), path.join(staging, name));

  const poll = setInterval(() => {
    onProgress({ percent: Math.min(99, Number(((folderBytes(staging) / EXPECTED_BYTES) * 100).toFixed(1))) });
  }, pollMs);
  let result;
  try {
    result = await run({ npm, cwd: staging });
  } finally {
    clearInterval(poll);
  }

  if (result.code !== 0 || !fs.existsSync(path.join(staging, ...ENTRY))) {
    fs.rmSync(staging, { recursive: true, force: true, maxRetries: 5 });
    const detail = String(result.stderr || "").trim().split("\n").slice(-3).join(" ");
    throw unavailable(`The Gemini CLI could not be installed${detail ? `: ${detail}` : "."}`);
  }
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  fs.renameSync(staging, dir);
  onProgress({ percent: 100 });
  return installedEntry(appData);
}

module.exports = { VERSION, LOCK, EXPECTED_BYTES, installDir, installedEntry, ensureGemini };
