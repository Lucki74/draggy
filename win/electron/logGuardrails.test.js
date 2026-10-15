import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const logger = require("./logger.cjs");

const HERE = import.meta.dirname;
const PROMPT = "please summarise my confidential merger memo";
const REPLY = "the merger closes on the ninth of march";
const KEYS = ["sk-live-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "ghp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "hf_cccccccccccccccccccccccccccccccc"];

let tempDir;
let files;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-guard-test-"));
  files = logger.init({ getPath: () => tempDir, getName: () => "Draggy", getVersion: () => "0" });
});

afterEach(async () => {
  await logger.closeStreams();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const everyLog = () =>
  fs
    .readdirSync(path.dirname(files.appFile))
    .map((name) => fs.readFileSync(path.join(path.dirname(files.appFile), name), "utf8"))
    .join("\n");

describe("what never reaches a log file", () => {
  it("keeps chat text out of every file at DEBUG, whatever the field is called", async () => {
    logger.setLevel({ level: "DEBUG" });
    logger.log.info("agent", "turn", { prompt: PROMPT, reply: REPLY, messages: [{ role: "user", content: PROMPT }, { role: "assistant", content: [{ type: "text", text: REPLY }] }] });
    logger.log.debug("providers", "stream chunk", { delta: { content: REPLY }, text: REPLY });
    logger.logEntries([{ level: "INFO", context: "renderer", message: "sent", data: { text: PROMPT, content: REPLY, input: PROMPT } }]);
    await logger.flush();
    const all = everyLog();
    expect(all).not.toContain(PROMPT);
    expect(all).not.toContain(REPLY);
  });

  it("keeps keys out of every file, in headers, urls, settings and errors", async () => {
    logger.setLevel({ level: "DEBUG" });
    const [openai, github, hf] = KEYS;
    logger.log.info("providers", "request", { url: `https://api.test/v1?key=${openai}`, headers: { Authorization: `Bearer ${openai}`, "x-api-key": github } });
    logger.log.info("settings", "saved", { apiKey: hf, braveApiKey: github, note: `token ${hf}` });
    logger.log.fail("mcp", `oauth failed for ${github}`, new Error(`bad token ${openai}`), { code: `${hf}` });
    await logger.flush();
    const all = everyLog();
    for (const key of KEYS) expect(all).not.toContain(key);
  });
});

describe("mcp oauth", () => {
  it("keeps codes, verifiers and tokens out of every file through a whole sign-in", async () => {
    logger.setLevel({ level: "DEBUG" });
    const oauth = require("./mcpOauth.cjs");
    const secrets = ["code-aaaaaaaaaaaaaaaa", "verifier-bbbbbbbbbbbbbbbb", "access-cccccccccccccccc", "refresh-dddddddddddddddd"];
    const [code, verifier, access, refreshToken] = secrets;
    const answer = (body, ok = true, status = 200) => ({ ok, status, json: async () => body, text: async () => JSON.stringify(body) });
    const fetchImpl = async (url) => {
      if (String(url).includes("/token")) return answer({ access_token: access, refresh_token: refreshToken, expires_in: 3600 });
      if (String(url).includes("/register")) return answer({ client_id: "client-1" });
      return answer({ authorization_endpoint: "https://auth.test/authorize", token_endpoint: "https://auth.test/token", registration_endpoint: "https://auth.test/register" });
    };
    const metadata = await oauth.discover("https://mcp.test/sse", fetchImpl);
    await oauth.register(metadata, "http://127.0.0.1:1/callback", fetchImpl);
    await oauth.exchange({ metadata, code, verifier, redirectUri: "http://127.0.0.1:1/callback", clientId: "client-1" }, fetchImpl);
    await oauth.refresh({ metadata, refreshToken, clientId: "client-1" }, fetchImpl);
    const refused = async () => answer({ error: "invalid_grant", detail: `${code} ${verifier}`.replace(/ /g, "&") }, false, 400);
    await expect(oauth.exchange({ metadata, code, verifier, redirectUri: "x", clientId: "client-1" }, refused)).rejects.toThrow();
    await logger.flush();
    const all = everyLog();
    expect(all).toContain("token exchanged");
    for (const secret of secrets) expect(all).not.toContain(secret);
  });
});

describe("session summary", () => {
  it("counts turns, errors by scope, the slowest channels and engine crashes, then writes them at the end", async () => {
    logger.ingestRendererEntries([{ level: "INFO", context: "chat", message: "turn summary", data: { model: "m" } }]);
    logger.log.error("providers", "boom");
    logger.log.error("providers", "boom again");
    logger.noteSlow("mcp:call", 900);
    logger.noteSlow("mcp:call", 400);
    logger.noteSlow("settings:save", 50);
    logger.noteStat("engineCrash");
    logger.noteStat("peakMB", 812);
    logger.endSession(true);
    await logger.flush();
    const line = fs.readFileSync(files.eventsFile, "utf8").split("\n").filter(Boolean).map((row) => JSON.parse(row)).find((row) => row.msg === "session summary");
    expect(line.data).toMatchObject({ turns: 1, errorsByScope: { providers: 2 }, peakMemoryMB: 812, engineCrashes: 1 });
    expect(line.data.slowestIpc[0]).toEqual({ channel: "mcp:call", ms: 900 });
  });
});

describe("overhead", () => {
  it("writes 10,000 DEBUG lines in under 200 ms", async () => {
    logger.setLevel({ level: "DEBUG" });
    // Best of six: a busy machine slows one pass, not all of them.
    let elapsed = Infinity;
    for (let pass = 0; pass < 6; pass++) {
      const started = performance.now();
      for (let index = 0; index < 10000; index++) logger.log.debug("engine", "tick", { index, ms: 3 });
      elapsed = Math.min(elapsed, performance.now() - started);
    }
    await logger.flush();
    expect(elapsed).toBeLessThan(200);
  });
});

describe("invariants", () => {
  const sources = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(full);
      return /\.(cjs|js)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
    });

  // Files allowed to call console.* in the main process. A `marker` limits the exemption to lines carrying it.
  const CONSOLE_ALLOWLIST = {
    "logger.cjs": { reason: "the logger's own sink: the terminal mirror and stderr for errors" },
    "main.cjs": { reason: "dev-only mirror of renderer console output", marker: '"[RENDERER]"' },
  };
  const CONSOLE_CALL = /\bconsole\s*\.\s*(log|warn|error|info|debug|trace)\s*\(/;

  it("calls console.* in the main process only from the named allowlist", () => {
    const offenders = [];
    const used = new Set();
    for (const file of sources(HERE)) {
      const name = path.relative(HERE, file).split(path.sep).join("/");
      const rule = CONSOLE_ALLOWLIST[name];
      fs.readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line) => {
          if (!CONSOLE_CALL.test(line)) return;
          if (rule && (!rule.marker || line.includes(rule.marker))) used.add(name);
          else offenders.push(`${name}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
    // An entry whose file no longer calls console is stale and should come out of the list.
    expect([...used].sort()).toEqual(Object.keys(CONSOLE_ALLOWLIST).sort());
  });

  it("registers IPC handlers only through ipcLog.cjs", () => {
    const direct = /\bipcMain\s*\.\s*(handle|handleOnce|on|once)\s*\(/;
    const offenders = [];
    for (const file of sources(HERE)) {
      const name = path.relative(HERE, file).split(path.sep).join("/");
      if (name === "ipcLog.cjs") continue;
      fs.readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line) => {
          if (direct.test(line)) offenders.push(`${name}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
