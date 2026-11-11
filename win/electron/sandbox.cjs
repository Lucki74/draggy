const crypto = require("crypto");
const { execFileHidden } = require("./platform.cjs");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { log } = require("./logger.cjs");
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
  const { project, dataDir, network = false, writable = true, chatKey = "shared", toolchain } = options;
  if (!available()) {
    log.warn("proc.sandbox", "launcher missing", { cid: chatKey, reason: "unavailable" });
    return { error: "The sandbox is not available, so the command was not run." };
  }
  if (!project || !fs.existsSync(project)) {
    log.warn("proc.sandbox", "refused", { cid: chatKey, reason: "no-project" });
    return { error: "The project folder is not available." };
  }
  if (!isInside(project, spawn.cwd)) {
    log.warn("proc.sandbox", "refused", { cid: chatKey, reason: "cwd-outside-project" });
    return { error: "The command's folder is outside the project." };
  }

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
  log.debug("proc.sandbox", "launch", {
    cid: chatKey,
    identity: spec.identity,
    access: writable ? "rw" : "ro",
    network: spec.network,
    readOnly: spec.readOnly.length,
    readWrite: spec.readWrite.length,
    program: path.basename(file),
  });

  const launcherEnv = { SystemRoot: process.env.SystemRoot, LOCALAPPDATA: process.env.LOCALAPPDATA, TEMP: os.tmpdir() };
  const access = { identity: spec.identity, cwd: spec.cwd, readOnly: spec.readOnly, readWrite: spec.readWrite, commandLine: "grant" };
  const grant = { key: JSON.stringify([access.identity, access.readOnly, access.readWrite]), spec: access, specs, cid: chatKey };
  return { file: launcherPath(), args: [specFile], cwd: spawn.cwd, env: launcherEnv, verbatim: false, grant };
}

/** Shown while the first grant runs, before the command's own output. */
const SETUP_NOTE = "Setting up the sandbox for this folder. The first time can take a few minutes on a big project, and Windows may ask once for administrator rights so commands can list the folders above it.\n";

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
  const started = Date.now();
  return new Promise((resolve) => {
    execFileHidden(launch.file, ["--grant", specFile], { env: launch.env }, (error, _stdout, stderr) => {
      fs.rm(specFile, { force: true }, () => {}); // silent-ok: the startup sweep removes what this misses
      // The launcher warns on stderr even when it succeeds, for a folder it could not grant.
      const all = String(stderr || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const adminFolders = all.map((line) => NEEDS_ADMIN.exec(line)?.[1]).filter(Boolean);
      const lines = all.filter((line) => !NEEDS_ADMIN.test(line));
      const data = { cid: launch.grant.cid ?? null, identity: launch.grant.spec.identity, durMs: Date.now() - started, readOnly: launch.grant.spec.readOnly.length, readWrite: launch.grant.spec.readWrite.length, ...(lines.length ? { stderr: lines.slice(0, 5) } : {}), ...(adminFolders.length ? { needsAdmin: adminFolders.length } : {}) };
      if (error) log.error("proc.sandbox", "grant failed", { ...data, code: error.code ?? null });
      else if (lines.length) log.warn("proc.sandbox", "grant warned", data);
      else log.info("proc.sandbox", "granted", data);
      if (error) return resolve({ error: lines.join(" ") || error.message });
      if (!adminFolders.length) return resolve({});
      listFolders(launch, adminFolders).then(() => resolve({}));
    });
  });
}

/** Matches the launcher's report of a folder above the project that only an administrator can open to listing. */
const NEEDS_ADMIN = /^sandbox: needs-admin: (.+)$/;
let adminStep = null;

/** Lets every container list folders such as C:\Users and C:\ through Draggy's list capability. It needs one UAC
 * prompt per machine; once it went through, the launcher stops reporting those folders. It is asked at most once
 * per app run, so a declined prompt does not come back on every command. Commands still run either way, but `dir`
 * and PowerShell fail inside the project until it is done. */
function listFolders(launch, folders, elevate = defaultElevate) {
  if (!adminStep) {
    const unique = [...new Set(folders)];
    log.info("proc.sandbox", "asking for admin to list parent folders", { cid: launch.grant?.cid ?? null, folders: unique.length });
    adminStep = elevate(launch, unique).then((result) => {
      if (result.declined) log.warn("proc.sandbox", "admin step declined", { folders: unique.length });
      else if (result.success) log.info("proc.sandbox", "parent folders listable", { folders: unique.length });
      else log.warn("proc.sandbox", "admin step failed", { exitCode: result.exitCode ?? null, timedOut: Boolean(result.timedOut) });
      return result;
    });
  }
  return adminStep;
}

function defaultElevate(launch, folders) {
  // Paths that cmd would expand or split are never sent to the elevated batch file.
  const safe = folders.filter((folder) => !/[%&^|<>"\r\n]/.test(folder));
  if (!safe.length) return Promise.resolve({ success: false });
  // elevate.cjs requires commands.cjs, which requires this file, so it loads on first use.
  const { runElevated } = require("./elevate.cjs");
  return runElevated({ command: commandLine(launch.file, ["--list-folders", ...safe], false), cwd: os.tmpdir(), timeoutMs: 10 * 60 * 1000 });
}

/** Forgets the admin step and the shell checks, for tests. */
function resetAdminStep() {
  adminStep = null;
  shellChecks.clear();
  proven.clear();
}

/** Printed by the shell check; a shell that starts and runs a command prints it back. */
const SHELL_MARK = "dg-shell-ok";
const shellChecks = new Map();
const proven = new Set();

/** True once `shell` started inside this launch's container and ran `echo` there. Each shell is checked once per
 * sandbox identity and app run, after the folder grant, since Git's bash and PowerShell can fail to start in an
 * AppContainer where cmd works. */
function shellWorks(launch, shell, runCheck = defaultShellCheck) {
  const key = JSON.stringify([launch.grant?.spec.identity ?? null, shell]);
  if (!shellChecks.has(key)) {
    const started = Date.now();
    const check = ready(launch)
      .then((result) => (result.error ? false : runCheck(launch)))
      .then((works) => {
        log.info("proc.sandbox", works ? "shell works in the sandbox" : "shell does not start in the sandbox", { cid: launch.grant?.cid ?? null, identity: launch.grant?.spec.identity ?? null, shell, durMs: Date.now() - started });
        if (works) proven.add(shell);
        return works;
      });
    shellChecks.set(key, check);
  }
  return shellChecks.get(key);
}

/** Shells that passed the check this app run, for callers that cannot wait on one. */
function provenShells() {
  return [...proven];
}

function defaultShellCheck(launch) {
  return new Promise((resolve) => {
    execFileHidden(launch.file, launch.args, { env: launch.env, cwd: launch.cwd, timeout: 30_000, encoding: "utf8" }, (error, stdout) => {
      resolve(!error && String(stdout).includes(SHELL_MARK));
    });
  });
}

/** Removes spec files left by an earlier run. Each holds a command line and its environment, so none should outlive it. */
function sweepSpecs(dataDir) {
  const specs = path.join(dataDir, "sandbox", "specs");
  let names;
  try {
    names = fs.readdirSync(specs).filter((name) => name.endsWith(".json"));
  } catch (error) {
    if (error.code !== "ENOENT") log.warn("proc.sandbox", "spec sweep failed", { code: error.code });
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    try {
      fs.rmSync(path.join(specs, name), { force: true });
      removed += 1;
    } catch (error) {
      log.warn("proc.sandbox", "spec not removed", { code: error.code });
    }
  }
  if (removed) log.info("proc.sandbox", "old specs removed", { removed });
  return removed;
}

module.exports = { available, launcherPath, identity, quoteArg, commandLine, toolchainFolders, wrap, ready, needsGrant, sweepSpecs, listFolders, resetAdminStep, NEEDS_ADMIN, shellWorks, provenShells, SHELL_MARK, SETUP_NOTE };
