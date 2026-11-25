// Dev-only probe, not shipped: runs common listing commands inside the AppContainer sandbox against a few folders
// and prints a pass/fail grid. Usage: node scripts/sandboxProbe.cjs <draggy-sandbox.exe>
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const exe = path.resolve(process.argv[2] || "");
if (!fs.existsSync(exe)) {
  console.error("usage: node scripts/sandboxProbe.cjs <draggy-sandbox.exe>");
  process.exit(64);
}

// sandbox.cjs looks for the launcher under resourcesPath/sandbox.
const resources = path.join("E:\\dev projects\\draggy\\temp", "dg-probe-res");
fs.mkdirSync(path.join(resources, "sandbox"), { recursive: true });
fs.copyFileSync(exe, path.join(resources, "sandbox", "draggy-sandbox.exe"));
process.resourcesPath = resources;
const sandbox = require("../electron/sandbox.cjs");

const dataDir = path.join("E:\\dev projects\\draggy\\temp", "dg-probe-data");
const made = [];
const home = os.homedir();

function makeFolder(folder) {
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "hello.txt"), "hi");
  made.push(folder);
  return folder;
}

const targets = [
  ["Documents", path.join(home, "Documents")],
  ["home-tmp", makeFolder(path.join(home, "dg-probe-tmp"))],
  ["E-tmp", makeFolder("E:\\dev projects\\draggy\\temp\\dg-probe")],
];

function find(name) {
  const out = spawnSync("where", [name], { encoding: "utf8", windowsHide: true });
  return out.status === 0 ? out.stdout.split(/\r?\n/)[0] : null;
}

const system = process.env.SystemRoot || "C:\\Windows";
const powershell = find("pwsh") || path.join(system, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const gitBash = ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files\\Git\\usr\\bin\\bash.exe"].find((one) => fs.existsSync(one));
const python = find("python");
const cmd = path.join(system, "System32", "cmd.exe");

const commands = [
  ["cmd dir", cmd, ["/c", "dir"]],
  ["cmd dir /b", cmd, ["/c", "dir", "/b"]],
  ["cmd cd", cmd, ["/c", "cd"]],
  ["python listdir", python, ["-c", "import os;print(os.listdir())"]],
  ["ps Get-ChildItem", powershell, ["-NoProfile", "-Command", "Get-ChildItem | Select-Object -First 3 | ForEach-Object Name"]],
  ["bash ls", gitBash, ["-c", "ls"]],
];

function run(args, label) {
  const out = spawnSync(sandbox.launcherPath(), args, { encoding: "latin1", windowsHide: true, timeout: 90000, env: { SystemRoot: system, LOCALAPPDATA: process.env.LOCALAPPDATA, TEMP: os.tmpdir() } });
  const first = (text) => String(text || "").split(/\r?\n/).find((line) => line.trim()) || "";
  return { code: out.status ?? `signal ${out.signal}`, err: first(out.stderr), out: first(out.stdout), stdout: out.stdout, label };
}

function launch(file, args, cwd, project, writable) {
  const env = { ...process.env };
  const built = sandbox.wrap({ file, args, cwd, env }, { project, dataDir, writable, chatKey: "probe" });
  if (built.error) throw new Error(built.error);
  return built;
}

const grid = [];
const diagnoses = {};
for (const [name, folder] of targets) {
  for (const writable of [false, true]) {
    const mode = writable ? "rw" : "ro";
    const first = launch(cmd, ["/c", "cd"], folder, folder, writable);
    const specFile = path.join(dataDir, "grant.json");
    fs.writeFileSync(specFile, JSON.stringify(first.grant.spec));
    const granted = run(["--grant", specFile]);
    grid.push([`${name} ${mode}`, "--grant", granted.code, granted.err]);
    // The first launch's spec is still on disk; run it as a command and keep a copy for --diagnose.
    const spec = fs.readFileSync(first.args[0], "utf8");
    fs.writeFileSync(specFile, spec);
    const diagnose = run(["--diagnose", specFile]);
    diagnoses[`${name} ${mode}`] = diagnose.stdout || diagnose.err;
    grid.push([`${name} ${mode}`, "--diagnose", diagnose.code, diagnose.err]);
    for (const [label, file, args] of commands) {
      if (!file) {
        grid.push([`${name} ${mode}`, label, "-", "not installed"]);
        continue;
      }
      const result = run(launch(file, args, folder, folder, writable).args);
      grid.push([`${name} ${mode}`, label, result.code, result.err || result.out]);
    }
  }
}

const width = [0, 1].map((i) => Math.max(...grid.map((row) => String(row[i]).length)));
for (const [scope, label, code, text] of grid) {
  console.log(`${scope.padEnd(width[0])}  ${label.padEnd(width[1])}  ${String(code).padStart(4)}  ${text.slice(0, 90)}`);
}
console.log("\nDIAGNOSE");
for (const [key, value] of Object.entries(diagnoses)) console.log(`${key}: ${String(value).trim()}`);

for (const folder of made) fs.rmSync(folder, { recursive: true, force: true });
fs.rmSync(dataDir, { recursive: true, force: true });
fs.rmSync(resources, { recursive: true, force: true });
