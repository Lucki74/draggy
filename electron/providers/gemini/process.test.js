import { EventEmitter } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { startGemini, linkHome, neutralPaths, FLAGS, NODE_FLAGS, CLIENT, TOOL_TIMEOUT_MS } = require("./process.cjs");

let appData;
let paths;
beforeEach(() => {
  appData = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-gemini-"));
  paths = { link: path.join(appData, "neutral", "gemini-a"), cwd: path.join(appData, "neutral", "gemini-a-work") };
});
afterEach(() => fs.rmSync(appData, { recursive: true, force: true }));

/** A child that answers `initialize` as the CLI does, and records every message it was sent. */
function fakeSpawn({ refuse = false } = {}) {
  const sent = [];
  const spawn = vi.fn((file, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn(() => setImmediate(() => child.emit("exit", null)));
    // Read while the child runs: the run files are gone once it exits.
    spawn.files = {
      settings: JSON.parse(fs.readFileSync(path.join(options.cwd, ".gemini", "settings.json"), "utf8")),
      system: [options.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH, options.env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH].filter((file) => fs.existsSync(file)),
      prompt: fs.readFileSync(options.env.GEMINI_SYSTEM_MD, "utf8"),
    };
    child.stdin.on("data", (chunk) => {
      // A pasted sign-in code is a plain line, not a message.
      for (const line of chunk.toString().split("\n").filter((l) => l.startsWith("{"))) {
        const message = JSON.parse(line);
        sent.push(message);
        if (message.method === "initialize") {
          const answer = refuse ? { error: { code: -32603, message: "no" } } : { result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } };
          child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, ...answer })}\n`);
        }
      }
    });
    spawn.child = child;
    return child;
  });
  return { spawn, sent };
}

const shell = {
  PATH: "/usr/bin",
  HOME: "/home/someone",
  GEMINI_API_KEY: "from-the-shell",
  GOOGLE_API_KEY: "from-the-shell",
  GOOGLE_GEMINI_BASE_URL: "https://proxy.example",
  GOOGLE_APPLICATION_CREDENTIALS: "/home/someone/key.json",
  GEMINI_CLI_SYSTEM_SETTINGS_PATH: "/etc/theirs.json",
  HTTPS_PROXY: "http://proxy.example",
};

const start = (spawn, extra = {}) =>
  startGemini({ entry: "gemini.js", execPath: "electron.exe", appData, instanceId: "a", spawn, parentEnv: shell, paths, ...extra });

describe("gemini process", () => {
  it("starts from the neutral link, with nothing from the shell that could bill or proxy a turn", async () => {
    const { spawn, sent } = fakeSpawn();
    const gemini = await start(spawn);
    const [file, args, options] = spawn.mock.calls[0];
    expect(file).toBe("electron.exe");
    expect(args).toEqual(["--use-system-ca", "gemini.js", ...FLAGS]);
    expect(NODE_FLAGS).toEqual(["--use-system-ca"]);
    expect(args).not.toContain("--yolo");
    expect(path.dirname(options.cwd)).toBe(paths.cwd);
    expect(gemini.cwd).toBe(options.cwd);
    const { GEMINI_SYSTEM_MD, GEMINI_CLI_SYSTEM_SETTINGS_PATH, GEMINI_CLI_SYSTEM_DEFAULTS_PATH, ...rest } = options.env;
    expect(rest).toEqual({
      PATH: "/usr/bin",
      HOME: paths.link,
      USERPROFILE: paths.link,
      GEMINI_CLI_HOME: paths.link,
      ELECTRON_RUN_AS_NODE: "1",
      GEMINI_FORCE_FILE_STORAGE: "true",
      GEMINI_CLI_TRUST_WORKSPACE: "true",
    });
    expect(options.env).not.toHaveProperty("NO_BROWSER");
    expect(GEMINI_SYSTEM_MD.startsWith(path.join(appData, "gemini", "run"))).toBe(true);
    for (const file of [GEMINI_CLI_SYSTEM_SETTINGS_PATH, GEMINI_CLI_SYSTEM_DEFAULTS_PATH]) {
      expect(file.startsWith(options.cwd)).toBe(true);
    }
    expect(sent[0]).toMatchObject({ jsonrpc: "2.0", method: "initialize", params: CLIENT });
    expect(sent[0].params.clientCapabilities).toEqual({ fs: { readTextFile: false, writeTextFile: false }, terminal: false });
    expect(gemini.init).toEqual({ protocolVersion: 1, agentCapabilities: { loadSession: true } });
    expect(fs.realpathSync(paths.link)).toBe(fs.realpathSync(gemini.home));
    expect(gemini.home).toBe(path.join(appData, "gemini", "a"));
    expect(spawn.files.settings).not.toHaveProperty("mcpServers");
    await gemini.stop();
  });

  it("leaves the model only Draggy's tools, with its own prompt and a limit far above any approval wait", async () => {
    const { spawn } = fakeSpawn();
    const gemini = await start(spawn, { tools: ["read_file", "run_command"], model: "gemini-2.5-pro", mcpUrl: "http://127.0.0.1:1/mcp/x", systemPrompt: "You are Draggy." });
    const { settings, prompt } = spawn.files;
    expect(settings.tools).toEqual({ core: ["mcp_draggy_read_file", "mcp_draggy_run_command"] });
    expect(settings.model).toEqual({ name: "gemini-2.5-pro" });
    expect(settings.mcpServers).toEqual({ draggy: { httpUrl: "http://127.0.0.1:1/mcp/x", timeout: TOOL_TIMEOUT_MS } });
    expect(settings.security.auth.selectedType).toBe("oauth-personal");
    expect(settings.context.includeDirectoryTree).toBe(false);
    expect(settings.privacy.usageStatisticsEnabled).toBe(false);
    expect(settings.telemetry.enabled).toBe(false);
    expect(prompt).toBe("You are Draggy.");

    await gemini.stop();
    expect(fs.readdirSync(path.join(appData, "gemini", "run"))).toEqual([]);
  });

  it("names no system settings file that exists: the CLI ignores one its user owns, and checks it through PowerShell", async () => {
    const { spawn } = fakeSpawn();
    const gemini = await start(spawn);
    expect(spawn.files.system).toEqual([]);
    expect(spawn.files.settings.security.auth.selectedType).toBe("oauth-personal");
    await gemini.stop();
  });

  it("gives each process its own workspace, removed with the CLI's chat log for it when the process ends", async () => {
    const first = fakeSpawn();
    const second = fakeSpawn();
    const a = await start(first.spawn, { tools: ["read_file"] });
    const b = await start(second.spawn, { tools: ["run_command"] });
    expect(a.cwd).not.toBe(b.cwd);
    expect(first.spawn.files.settings.tools.core).toEqual(["mcp_draggy_read_file"]);
    expect(fs.readFileSync(path.join(b.cwd, ".gemini", "settings.json"), "utf8")).toContain("mcp_draggy_run_command");

    const id = path.basename(a.cwd);
    const log = path.join(a.home, ".gemini", "tmp", id, "chats");
    fs.mkdirSync(log, { recursive: true });
    await a.stop();
    expect(fs.existsSync(a.cwd)).toBe(false);
    expect(fs.existsSync(path.dirname(log))).toBe(false);
    expect(fs.existsSync(b.cwd)).toBe(true);
    await b.stop();
  });

  it("stops the child and throws when initialize is refused", async () => {
    const { spawn } = fakeSpawn({ refuse: true });
    await expect(start(spawn)).rejects.toThrow("no");
    expect(spawn.child.kill).toHaveBeenCalled();
  });

  it("signs in without a browser of its own: printed text goes to the caller, a pasted code goes to stdin as one line", async () => {
    const { spawn } = fakeSpawn();
    const output = [];
    const gemini = await start(spawn, { noBrowser: true, onOutput: (text) => output.push(text) });
    expect(spawn.mock.calls[0][2].env.NO_BROWSER).toBe("true");
    const typed = [];
    spawn.child.stdin.on("data", (chunk) => typed.push(chunk.toString()));
    spawn.child.stdout.write("Please visit the following URL\n");
    gemini.typeLine("4/0code\r\nsecond");
    expect(output.join("")).toContain("Please visit the following URL");
    expect(typed).toEqual(["4/0codesecond\n"]);
    await gemini.stop();
    expect(gemini.typeLine("late")).toBe(false);
  });

  it("uses only its own link: never a real folder, never a link to somewhere else", () => {
    const home = path.join(appData, "gemini", "a");
    fs.mkdirSync(home, { recursive: true });
    expect(linkHome(paths.link, home)).toBe(paths.link);
    expect(linkHome(paths.link, home)).toBe(paths.link);

    const elsewhere = path.join(appData, "elsewhere");
    fs.mkdirSync(elsewhere);
    const foreign = path.join(appData, "neutral", "gemini-b");
    fs.symlinkSync(elsewhere, foreign, "junction");
    expect(() => linkHome(foreign, home)).toThrow(expect.objectContaining({ code: "account-runtime-unavailable" }));

    const folder = path.join(appData, "neutral", "gemini-c");
    fs.mkdirSync(folder);
    expect(() => linkHome(folder, home)).toThrow(expect.objectContaining({ code: "account-runtime-unavailable" }));
  });

  it("keeps the user's name out of both paths the model is told about", () => {
    expect(neutralPaths("a", { platformName: "win32", env: { ProgramData: "C:\\ProgramData", USERNAME: "someone" } })).toEqual({
      link: "C:\\ProgramData\\Draggy\\gemini-a",
      cwd: "C:\\ProgramData\\Draggy\\gemini-a-work",
    });
    expect(neutralPaths("a", { platformName: "linux", env: {}, uid: 1000 })).toEqual({
      link: "/tmp/draggy-1000-gemini-a",
      cwd: "/tmp/draggy-1000-gemini-a-work",
    });
  });
});
