import { EventEmitter } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { startCodex, configToml, writeHome, FEATURES_OFF, CATALOG_NAME } = require("./process.cjs");

let appData;
beforeEach(() => {
  appData = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-codex-"));
});
afterEach(() => fs.rmSync(appData, { recursive: true, force: true }));

/** A child that answers `initialize` the way app-server does, and records what it was sent. */
function fakeSpawn({ refuse = false } = {}) {
  const calls = [];
  const spawn = vi.fn((file, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn(() => setImmediate(() => child.emit("exit", null)));
    child.stdin.on("data", (chunk) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) {
        const message = JSON.parse(line);
        calls.push(message);
        if (message.method === "initialize") {
          const answer = refuse ? { error: { code: -1, message: "no" } } : { result: { userAgent: "codex" } };
          child.stdout.write(`${JSON.stringify({ id: message.id, ...answer })}\n`);
        }
      }
    });
    spawn.child = child;
    return child;
  });
  return { spawn, calls };
}

describe("codex config", () => {
  it("switches every built-in off and never names a provider, a base URL or a key", () => {
    const toml = configToml("C:/data/codex/a/draggy-models.json");
    for (const feature of FEATURES_OFF) expect(toml).toContain(`\n${feature} = false\n`);
    for (const line of ['web_search = "disabled"', 'forced_login_method = "chatgpt"', 'cli_auth_credentials_store = "file"']) {
      expect(toml).toContain(line);
    }
    expect(toml).not.toMatch(/model_provider|base_url|api_key|env_key|mcp_servers/);
  });

  it("is exactly the config the spike proved strips every built-in (MODE.md §3)", () => {
    const mode = fs.readFileSync(path.join(__dirname, "MODE.md"), "utf8");
    const block = mode.match(/```toml\r?\n([^]*?)```/)[1].split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const catalog = "C:/data/codex/a/draggy-models.json";
    const expected = block.map((line) => line.replace('"<CODEX_HOME>/draggy-models.json"', JSON.stringify(catalog)));
    expect(configToml(catalog).split("\n").filter(Boolean)).toEqual(expected);
  });

  it("puts every top-level key before the first table, where TOML reads it as top-level", () => {
    const toml = configToml("x.json", { topLevel: ['model_provider = "probe"'] });
    expect(toml.indexOf("model_provider")).toBeLessThan(toml.indexOf("["));
    expect(toml.indexOf("check_for_update_on_startup")).toBeLessThan(toml.indexOf("["));
  });

  it("rewrites a hand-edited config on every start", () => {
    const home = path.join(appData, "codex", "a");
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, "config.toml"), "[features]\nshell_tool = true\n");
    writeHome(home);
    const toml = fs.readFileSync(path.join(home, "config.toml"), "utf8");
    expect(toml).toContain("shell_tool = false");
    expect(toml).not.toContain("shell_tool = true");
    expect(fs.existsSync(path.join(home, CATALOG_NAME))).toBe(true);
  });
});

describe("startCodex", () => {
  const parentEnv = { Path: "C:\\Windows", SystemRoot: "C:\\Windows", OPENAI_API_KEY: "sk-shell", HTTPS_PROXY: "http://p" };

  it("spawns hidden in its private home with the allowlisted environment, then shakes hands", async () => {
    const { spawn, calls } = fakeSpawn();
    const codex = await startCodex({ binary: "codex-app-server.exe", appData, instanceId: "a", version: "1.3.0", spawn, parentEnv });
    const [file, args, options] = spawn.mock.calls[0];
    expect(file).toBe("codex-app-server.exe");
    expect(args).toEqual(["--strict-config", "--session-source", "draggy", "--listen", "stdio://"]);
    expect(options.cwd).toBe(path.join(appData, "codex", "a"));
    expect(options.env.CODEX_HOME).toBe(options.cwd);
    expect(options.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(options.env).not.toHaveProperty("HTTPS_PROXY");
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toEqual([
      {
        id: 1,
        method: "initialize",
        params: { clientInfo: { name: "draggy", title: "Draggy", version: "1.3.0" }, capabilities: { experimentalApi: true, requestAttestation: false } },
      },
      { method: "initialized" },
    ]);
    expect(codex.home).toBe(options.cwd);
  });

  it("uses the hidden spawn helper unless a test swaps it", () => {
    const source = fs.readFileSync(path.join(__dirname, "process.cjs"), "utf8");
    expect(source).toMatch(/spawn = platform\.spawnHidden/);
  });

  it("stops the process when the handshake fails", async () => {
    const { spawn } = fakeSpawn({ refuse: true });
    await expect(startCodex({ binary: "x", appData, instanceId: "a", version: "1", spawn, parentEnv })).rejects.toThrow("no");
    expect(spawn.child.kill).toHaveBeenCalled();
  });

  it("reports an exit once, whether it was asked for or not", async () => {
    const { spawn } = fakeSpawn();
    const onExit = vi.fn();
    const codex = await startCodex({ binary: "x", appData, instanceId: "a", version: "1", spawn, parentEnv, onExit });
    await codex.stop();
    spawn.child.emit("exit", 0);
    expect(onExit).toHaveBeenCalledTimes(1);
    await expect(codex.rpc.call("model/list")).rejects.toMatchObject({ code: "closed" });
  });

  it("logs stderr redacted", async () => {
    const { spawn } = fakeSpawn();
    const log = vi.fn();
    await startCodex({ binary: "x", appData, instanceId: "a", version: "1", spawn, parentEnv, log });
    spawn.child.stderr.write("callback ?code=abc123&state=xyz\n");
    await new Promise((resolve) => setImmediate(resolve));
    expect(log).toHaveBeenCalledWith("callback ?code=[redacted]&state=[redacted]");
  });
});
