// Runs the real app on a throwaway data folder, as a new install sees it. Dev only; not packaged.
// Usage: electron scripts/fresh-launch.cjs [--profile=<dir>] [--link-engine] [--link-model=<file>] [--existing]
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app } = require("electron");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => args.find((one) => one.startsWith(`--${name}=`))?.slice(name.length + 3);

// A named profile survives the run, so quitting half way and launching again can be tried.
const named = option("profile") || process.env.DRAGGY_PROFILE;
const root = named ? path.resolve(named) : fs.mkdtempSync(path.join(os.tmpdir(), "draggy-fresh-"));
// A fresh appData too, so the one-time 1.x folder adoption cannot reach the real one.
app.setPath("appData", path.join(root, "appdata"));
app.setPath("userData", path.join(root, "userdata"));
fs.mkdirSync(app.getPath("userData"), { recursive: true });

const realUserData = path.join(process.env.APPDATA || path.join(os.homedir(), ".config"), "Draggy");
const links = [];

// The installed engine, so testing the setup does not download it every time.
if (flag("link-engine")) {
  const from = path.join(realUserData, "bin");
  const to = path.join(app.getPath("userData"), "bin");
  if (fs.existsSync(from) && !fs.existsSync(to)) {
    fs.symlinkSync(from, to, "junction");
    links.push(to);
  }
}

// One installed model, hard linked: no copy, and removing the profile cannot touch the original.
const model = option("link-model");
if (model) {
  const models = path.join(app.getPath("userData"), "models");
  fs.mkdirSync(models, { recursive: true });
  const to = path.join(models, model);
  if (!fs.existsSync(to)) fs.linkSync(path.join(realUserData, "models", model), to);
}

// Someone updating from an earlier version: saved settings and no setup record. The renderer keeps
// its own copy in localStorage and rewrites this one, so it only feeds main's decision at boot.
if (flag("existing")) {
  const storage = require(path.join(__dirname, "..", "electron", "storage.cjs"));
  storage.init(app.getPath("userData"));
  if (!storage.getValue("draggy_settings")) {
    storage.setValue("draggy_settings", JSON.stringify({ theme: "light", language: "en", modelName: model || "" }));
  }
  storage.close();
}

console.log(`[fresh] data folder ${app.getPath("userData")}${named ? " (kept)" : " (removed on quit)"}`);

process.on("exit", () => {
  // Unlinked first, so removing the folder can never follow a junction into the real engine.
  for (const target of links) {
    try {
      fs.unlinkSync(target);
    } catch {
      // Already gone.
    }
  }
  if (named) return;
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // Windows may still hold a file for a moment; the folder is in temp either way.
  }
});

require(path.join(__dirname, "..", "electron", "main.cjs"));
