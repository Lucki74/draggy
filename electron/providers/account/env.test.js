import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { accountEnv, privateHome, NEVER } = require("./env.cjs");

const appData = path.join("C:", "Users", "me", "AppData", "Roaming", "Draggy");

/** A shell as hostile as a real one can get: every key, base URL and proxy set at once. */
const shell = {
  Path: "C:\\Windows\\system32",
  SystemRoot: "C:\\Windows",
  TEMP: "C:\\Temp",
  TMP: "C:\\Temp",
  USERPROFILE: "C:\\Users\\me",
  HOME: "C:\\Users\\me",
  CODEX_HOME: "C:\\Users\\me\\.codex",
  CLAUDE_CONFIG_DIR: "C:\\Users\\me\\.claude",
  GEMINI_CLI_HOME: "C:\\Users\\me",
  HTTPS_PROXY: "http://proxy:8080",
  http_proxy: "http://proxy:8080",
  ALL_PROXY: "socks5://proxy:1080",
  NO_PROXY: "localhost",
  NODE_OPTIONS: "--require evil.js",
  ...Object.fromEntries(NEVER.map((name) => [name, "from-the-shell"])),
};

describe("accountEnv", () => {
  it.each(["codex", "claude", "gemini"])("lets no key, base URL, cloud switch or proxy reach %s", (runtime) => {
    const { env } = accountEnv({ runtime, appData, instanceId: "acct-1", parent: shell });
    for (const name of [...NEVER, "HTTPS_PROXY", "http_proxy", "ALL_PROXY", "NO_PROXY", "NODE_OPTIONS"]) {
      expect(env).not.toHaveProperty(name);
    }
    expect(Object.values(env)).not.toContain("from-the-shell");
  });

  it("keeps only what a runtime needs to start", () => {
    const { env } = accountEnv({ runtime: "codex", appData, instanceId: "acct-1", parent: shell });
    expect(Object.keys(env).sort()).toEqual(["CODEX_HOME", "HOME", "PATH", "SystemRoot", "TEMP", "TMP", "USERPROFILE"]);
    expect(env.PATH).toBe("C:\\Windows\\system32");
  });

  it.each([
    ["codex", "CODEX_HOME"],
    ["claude", "CLAUDE_CONFIG_DIR"],
    ["gemini", "GEMINI_CLI_HOME"],
  ])("points %s's home, and the user's, at the private folder in app data", (runtime, variable) => {
    const { env, home } = accountEnv({ runtime, appData, instanceId: "acct-1", parent: shell });
    expect(home).toBe(path.join(appData, runtime, "acct-1"));
    expect(env[variable]).toBe(home);
    expect(env.HOME).toBe(home);
    expect(env.USERPROFILE).toBe(home);
  });

  it("takes the extras a runtime names, but never a forbidden one", () => {
    const base = { runtime: "claude", appData, instanceId: "a", parent: shell };
    expect(accountEnv({ ...base, extra: { ELECTRON_RUN_AS_NODE: "1" } }).env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(() => accountEnv({ ...base, extra: { ANTHROPIC_BASE_URL: "http://x" } })).toThrow(/never reaches/);
    expect(() => accountEnv({ ...base, extra: { https_proxy: "http://x" } })).toThrow(/never reaches/);
  });

  it("refuses an instance id that would leave the app's folder", () => {
    expect(() => privateHome(appData, "codex", "../../.codex")).toThrow();
    expect(() => privateHome(appData, "codex", "")).toThrow();
    expect(() => privateHome(appData, "other", "a")).toThrow(/Unknown/);
  });
});
