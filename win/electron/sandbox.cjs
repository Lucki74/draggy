const crypto = require("crypto");
const { execFileHidden } = require("./platform.cjs");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { scrubEnv } = require("./sandboxPolicy.cjs");

/** Runs a command inside the Windows AppContainer launcher (win/sandbox). The launcher fails closed, and so
 * does this: when the sandbox cannot be set up, nothing runs. */

const LAUNCHER = "draggy-sandbox.exe";
// Without these, Node cannot resolve a script path when the drive root is not stat-able.
const NODE_FLAGS = "--preserve-symlinks --preserve-symlinks-main";

function launcherPath() {
  const packaged = process.resourcesPath ? path.join(process.resourcesPath, "sandbox", LAUNCHER) : null;
  const dev = path.join(__dirname, "..", "sandbox", "target", "release", LAUNCHER);
  return [packaged, dev].find((one) => one && fs.existsSync(one)) || null;
}

function available() {
  return process.platform === "win32" && Boolean(launcherPath());
}

function realPath(value) {
  try {
    return fs.realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
}

/** One container per project and access level, so a read-only chat never holds write rights. */
function identity(project, writable) {
  const key = crypto.createHash("sha1").update(realPath(project).toLowerCase()).digest("hex").slice(0, 12);
  return `p${key}-${writable ? "rw" : "ro"}`;
}

/** The Windows command line CreateProcess expects, quoting each argument by the MSVCRT rules. */
function quoteArg(value) {
  const text = String(value);
  if (text !== "" && !/[\s"]/.test(text)) return text;
  let out = '"';
  let slashes = 0;
  for (const char of text) {
    if (char === "\\") {
      slashes += 1;
      continue;
    }
    out += char === '"' ? "\\".repeat(slashes * 2 + 1) + char : "\\".repeat(slashes) + char;
    slashes = 0;
  }
  return `${out}${"\\".repeat(slashes * 2)}"`;
}

function commandLine(file, args, verbatim) {
  const rest = verbatim ? args.join(" ") : args.map(quoteArg).join(" ");
  return `${quoteArg(file)}${rest ? ` ${rest}` : ""}`;
}

function isInside(root, target) {
  const relative = path.relative(realPath(root), realPath(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Folders the sandbox grants for reading so the program can start: only the program's own folder. PATH entries
 * stay out, so a user's other tools and credentials are never exposed. Tests inject `options.toolchain` instead. */
function toolchainFolders(file, home = os.homedir()) {
  const windows = String(process.env.SystemRoot || "C:\\Windows").toLowerCase();
  const folder = path.dirname(file);
  const lower = realPath(folder).toLowerCase();
  if (lower === path.parse(lower).root || lower === realPath(home).toLowerCase()) return [];
  if (lower === windows || lower.startsWith(`${windows}${path.sep}`)) return [];
  const secret = [".ssh", ".aws", ".gnupg", ".azure", ".config"];
  return lower.split(path.sep).some((part) => secret.includes(part)) ? [] : [folder];
}

/** Turns a spawn description into one that goes through the launcher, or `{ error }` when the sandbox is not
 * usable. `options.project` is the writable folder; `options.dataDir` holds the temp, cache and spec files. */
function wrap(spawn, options) {
  if (!available()) return { error: "The sandbox is not available, so the command was not run." };
  const { project, dataDir, network = false, writable = true, chatKey = "shared", toolchain } = options;
  if (!project || !fs.existsSync(project)) return { error: "The project folder is not available." };
  if (!isInside(project, spawn.cwd)) return { error: "The command's folder is outside the project." };

  const scratch = path.join(dataDir, "sandbox", "scratch", String(chatKey).replace(/[^\w.-]/g, "_"));
  fs.mkdirSync(path.join(scratch, "tmp"), { recursive: true });
  fs.mkdirSync(path.join(scratch, "cache"), { recursive: true });
  const specs = path.join(dataDir, "sandbox", "specs");
  fs.mkdirSync(specs, { recursive: true });

  const file = path.isAbsolute(spawn.file) ? spawn.file : require("./shells.cjs").findOnPath(spawn.file, spawn.env) || spawn.file;
  const env = scrubEnv(spawn.env);
  const extras = options.extras || {};
  if (extras.path?.length) {
    const key = Object.keys(env).find((name) => name.toLowerCase() === "path") || "PATH";
    env[key] = [...extras.path, env[key]].filter(Boolean).join(path.delimiter);
  }
  Object.assign(env, extras.env);
  env.TEMP = path.join(scratch, "tmp");
  env.TMP = env.TEMP;
  env.npm_config_cache = path.join(scratch, "cache", "npm");
  env.PIP_CACHE_DIR = path.join(scratch, "cache", "pip");
  env.NODE_OPTIONS = [env.NODE_OPTIONS, NODE_FLAGS].filter(Boolean).join(" ");

  const spec = {
    identity: identity(project, writable),
    cwd: spawn.cwd,
    readOnly: [...(toolchain ? toolchain : toolchainFolders(file)), ...(extras.readOnly || [])],
    readWrite: writable ? [project, scratch] : [scratch],
    network: Boolean(network),
    env: Object.entries(env),
    commandLine: commandLine(file, spawn.args || [], spawn.verbatim),
  };
  if (!writable) spec.readOnly.push(project);
  const specFile = path.join(specs, `${crypto.randomBytes(8).toString("hex")}.json`);
  fs.writeFileSync(specFile, JSON.stringify(spec), { mode: 0o600 });

  const launcherEnv = { SystemRoot: process.env.SystemRoot, LOCALAPPDATA: process.env.LOCALAPPDATA, TEMP: os.tmpdir() };
  const access = { identity: spec.identity, cwd: spec.cwd, readOnly: spec.readOnly, readWrite: spec.readWrite, commandLine: "grant" };
  const grant = { key: JSON.stringify([access.identity, access.readOnly, access.readWrite]), spec: access, specs };
  return { file: launcherPath(), args: [specFile], cwd: spawn.cwd, env: launcherEnv, verbatim: false, grant };
}

const granted = new Map();
const done = new Set();

/** True while a launch still waits on its first grant this app run. */
function needsGrant(launch) {
  return Boolean(launch.grant) && !done.has(launch.grant.key);
}

/** Grants a launch's folders once per app run, with no timeout. The first grant on a big project walks every file
 * and can take minutes, and a timeout that killed it would leave it to start over on every command. */
function ready(launch, runGrant = defaultGrant) {
  if (!launch.grant) return Promise.resolve({});
  const { key } = launch.grant;
  if (!granted.has(key)) {
    const job = runGrant(launch).then((result) => {
      if (result.error) granted.delete(key);
      else done.add(key);
      return result;
    });
    granted.set(key, job);
  }
  return granted.get(key);
}

function defaultGrant(launch) {
  const specFile = path.join(launch.grant.specs, `${crypto.randomBytes(8).toString("hex")}.json`);
  fs.writeFileSync(specFile, JSON.stringify(launch.grant.spec), { mode: 0o600 });
  return new Promise((resolve) => {
    execFileHidden(launch.file, ["--grant", specFile], { env: launch.env }, (error, _stdout, stderr) => {
      resolve(error ? { error: String(stderr || "").trim() || error.message } : {});
    });
  });
}

module.exports = { available, launcherPath, identity, quoteArg, commandLine, toolchainFolders, wrap, ready, needsGrant };
