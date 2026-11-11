import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import type { PluginOption } from "vite";

/** Test-only: serves /test, runs the model's commands through the real sandbox launcher and forwards
 * the chat to a llama-server. Off unless started with `npm run dev:test` (DRAGGY_TEST_HARNESS=1), and only on the dev server, because
 * /__test/run runs commands for whoever can reach the port. */

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, "..");
const WORK = path.join(os.tmpdir(), "draggy-test");
const LLAMA_PORT = Number(process.env.TEST_LLAMA_PORT || 8099);

function sandbox() {
  return require(path.join(ROOT, "electron", "sandbox.cjs")) as {
    available: () => boolean;
    wrap: (spawn: object, options: object) => { error?: string; file: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; verbatim: boolean };
  };
}

function pythonDir(): string | null {
  const dir = path.join(ROOT, "vendor", "python");
  return existsSync(path.join(dir, "python.exe")) ? dir : null;
}

function chatDir(chatId: unknown): string | null {
  const id = String(chatId || "");
  return /^[\w-]{1,128}$/.test(id) ? path.join(WORK, "chats", id) : null;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function runCommand(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  // A project runs in its own folder; a chat without one runs in its chat folder.
  const dir = typeof body.projectRoot === "string" && body.projectRoot ? body.projectRoot : chatDir(body.chatId);
  if (!dir) return Promise.resolve({ success: false, error: "Bad chat id." });
  mkdirSync(dir, { recursive: true });
  const command = String(body.command || "");
  const outside = body.outsideSandbox === true;
  const shells = require(path.join(ROOT, "electron", "shells.cjs")) as {
    shellInvocation: (command: string, requested: unknown, options: object) => { shell: string; file: string; args: string[]; verbatim?: boolean; error?: string };
  };
  const invocation = shells.shellInvocation(command, body.shell, { defaultShell: body.defaultShell, sandboxed: !outside });
  if (invocation.error) return Promise.resolve({ success: false, error: invocation.error });
  const description = {
    file: invocation.file,
    args: invocation.args,
    cwd: dir,
    env: { ...process.env },
    verbatim: invocation.verbatim === true,
  };

  let launch: { file: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; verbatim?: boolean } = description;
  if (!outside) {
    // Only a chat without a project gets the bundled Python, as in the app.
    const python = body.projectRoot ? null : pythonDir();
    const wrapped = sandbox().wrap(description, {
      project: dir,
      dataDir: path.join(WORK, "data"),
      network: body.network === true,
      writable: body.writable !== false,
      chatKey: String(body.chatId),
      extras: python ? { readOnly: [python], path: [python], env: { PYTHONHOME: python, PYTHONNOUSERSITE: "1" } } : undefined,
    });
    if (wrapped.error) return Promise.resolve({ success: false, error: wrapped.error });
    launch = wrapped;
  }

  return new Promise((resolve) => {
    const child = spawn(launch.file, launch.args, {
      cwd: launch.cwd,
      env: launch.env,
      windowsHide: true,
      windowsVerbatimArguments: launch.verbatim ?? false,
    });
    let output = "";
    const take = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-60000);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timer = setTimeout(() => child.kill(), Number(body.timeoutMs) || 120000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ success: code === 0, exitCode: code ?? -1, output, shell: invocation.shell });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ success: false, error: error.message });
    });
  });
}


/** The main-process side of window.electronAPI, as far as a chat needs it. The real storage and model
 * listing modules run here; every other channel answers null and is logged so a gap is visible. */
const USER_DATA = path.join(WORK, "userData");
type Storage = Record<string, (...args: unknown[]) => unknown>;
let storage: Storage | null = null;
const unhandled = new Set<string>();

function store(): Storage {
  if (storage) return storage;
  mkdirSync(USER_DATA, { recursive: true });
  const opened = require(path.join(ROOT, "electron", "storage.cjs")) as Storage;
  opened.init(USER_DATA);
  storage = opened;
  return opened;
}

function modelsDir() {
  return process.env.TEST_MODELS_DIR || path.join(process.env.APPDATA || "", "Draggy", "models");
}

type FileOps = Record<string, (...args: string[]) => Promise<unknown>>;
let fileOpsCache: FileOps | null = null;

function fileOps(): FileOps {
  if (fileOpsCache) return fileOpsCache;
  const db = store();
  const checkpoints = require(path.join(ROOT, "electron", "checkpoints.cjs")) as { init: (dir: string) => void };
  checkpoints.init(USER_DATA);
  const ops = require(path.join(ROOT, "electron", "fileOps.cjs")) as { create: (deps: unknown) => FileOps };
  fileOpsCache = ops.create({
    roots: (id: string) => {
      if (id.startsWith("chat:")) {
        const chatId = id.slice(5);
        return /^[\w-]{1,128}$/.test(chatId) ? [path.join(WORK, "chats", chatId)] : [];
      }
      const workspace = db.getWorkspace(id) as { rootPath?: string } | undefined;
      return workspace?.rootPath ? [workspace.rootPath] : [];
    },
    storage: db,
    checkpoints,
    trash: async (target: string) => rmSync(target, { recursive: true, force: true }),
  });
  return fileOpsCache;
}

const counts = new Map<string, number>();

async function handleIpc(channel: string, args: unknown[]): Promise<unknown> {
  counts.set(channel, (counts.get(channel) ?? 0) + 1);
  const db = store();
  switch (channel) {
    case "get-system-specs":
      return { cpu: os.cpus()[0]?.model ?? "CPU", ram: Number((os.totalmem() / 1024 ** 3).toFixed(1)), vram: 12, gpu: "test", platform: process.platform, arch: os.arch() };
    case "db:load-chats":
      return { success: true, chats: db.loadChats() };
    case "db:save-chat":
      return db.saveChat(args[0]);
    case "db:delete-chat":
      return db.deleteChat(String(args[0]));
    case "db:clear-chats":
      return db.clearChats();
    case "db:search-chats":
      return { success: true, results: db.searchChats(args[0]) };
    case "db:get":
      return { success: true, value: db.getValue(String(args[0])) };
    case "db:set":
      return db.setValue(String(args[0]), args[1]);
    case "db:stats":
      return { success: true, stats: db.stats() };
    case "workspace:list":
      return { success: true, workspaces: db.listWorkspaces() };
    case "workspace:save":
      return db.saveWorkspace(args[0]);
    case "workspace:delete":
      return db.deleteWorkspace(String(args[0]));
    case "gguf:models":
      return require(path.join(ROOT, "electron", "modelStorage.cjs")).listGgufModels(modelsDir());
    case "gguf:status":
      return { running: true, port: LLAMA_PORT, model: path.basename(process.env.TEST_MODEL || "test.gguf"), contextSize: Number(process.env.TEST_CTX || 16384), hasBinary: true, ready: true, runnerType: "test", modelsDir: modelsDir(), baseUrl: `http://127.0.0.1:${LLAMA_PORT}/v1` };
    case "gguf:start":
      await llamaUrl();
      return { success: true, port: LLAMA_PORT, baseUrl: `http://127.0.0.1:${LLAMA_PORT}/v1` };
    case "gguf:stop":
      return { success: true };
    case "commands:run": {
      const [workspaceId, , command, options] = args as [string, string, string, Record<string, unknown>];
      const rootPath = (db.getWorkspace(String(workspaceId)) as { rootPath?: string } | undefined)?.rootPath;
      return runCommand({ ...options, command, projectRoot: rootPath });
    }
    // The app's own file operations, rooted at a project or at a chat's folder.
    case "fs:list":
    case "fs:read":
    case "fs:write":
    case "fs:edit":
    case "fs:move":
    case "fs:delete":
    case "fs:search": {
      const ops = fileOps();
      const method = { "fs:list": "list", "fs:read": "read", "fs:write": "write", "fs:edit": "edit", "fs:move": "move", "fs:delete": "remove", "fs:search": "search" }[channel]!;
      return ops[method](...(args as string[]));
    }
    // A browser has no file manager or default app to hand a file to.
    case "fs:open":
    case "fs:reveal":
      return { success: true };
    case "commands:cancel":
      return { success: true };
    case "chats:folder": {
      const id = String(args[0] ?? "");
      if (!/^[\w-]{1,128}$/.test(id)) return { success: false, error: "That chat has no folder." };
      const dir = path.join(WORK, "chats", id);
      mkdirSync(dir, { recursive: true });
      return { success: true, path: dir };
    }
    case "create-file": {
      const documents = require(path.join(ROOT, "electron", "documents.cjs")) as {
        isExecutableName: (name: string) => boolean;
        writeGeneratedFile: (file: string, content: string) => Promise<void>;
      };
      const name = path.basename(String(args[0]));
      if (!name || name === "." || name === "..") return { success: false, error: "That file name is not usable." };
      if (documents.isExecutableName(name)) return { success: false, error: `Refused to write ${name}: Draggy does not create executable or script files. Use a .txt or .md extension instead.` };
      const chatId = args[2] ? String(args[2]) : "";
      if (chatId && !/^[\w-]{1,128}$/.test(chatId)) return { success: false, error: "That chat has no folder." };
      const dir = chatId ? path.join(WORK, "chats", chatId) : path.join(WORK, "created");
      mkdirSync(dir, { recursive: true });
      const filepath = path.join(dir, name);
      await documents.writeGeneratedFile(filepath, String(args[1] ?? ""));
      return { success: true, filepath, filename: name };
    }
    default:
      if (!unhandled.has(channel)) {
        unhandled.add(channel);
        console.log("[test-bridge] unhandled", channel);
      }
      return null;
  }
}

let llama: ChildProcess | null = null;
let llamaReady: Promise<string> | null = null;

/** The base URL of a llama-server: TEST_LLAMA_URL if given, else one started from TEST_MODEL. */
function llamaUrl(): Promise<string> {
  if (process.env.TEST_LLAMA_URL) return Promise.resolve(process.env.TEST_LLAMA_URL);
  llamaReady ??= (async () => {
    const model = process.env.TEST_MODEL;
    if (!model || !existsSync(model)) throw new Error("Set TEST_MODEL to a .gguf file or TEST_LLAMA_URL to a running server.");
    const bin = process.env.TEST_LLAMA_BIN || path.join(process.env.APPDATA || "", "Draggy", "bin", "llama", "llama-server.exe");
    llama = spawn(bin, ["-m", model, "--port", String(LLAMA_PORT), "--host", "127.0.0.1", "--jinja", "-c", process.env.TEST_CTX || "16384", "-ngl", process.env.TEST_NGL || "99"], {
      stdio: "ignore",
      windowsHide: true,
    });
    const url = `http://127.0.0.1:${LLAMA_PORT}`;
    for (let waited = 0; waited < 300; waited += 1) {
      try {
        if ((await fetch(`${url}/health`)).ok) return url;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("The model server did not start in 5 minutes.");
  })();
  return llamaReady;
}

async function proxyChat(req: IncomingMessage, res: ServerResponse) {
  try {
    const body = await readJson(req);
    const upstream = await fetch(`${await llamaUrl()}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    res.statusCode = upstream.status;
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "text/event-stream");
    if (!upstream.body) return res.end();
    for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk);
    res.end();
  } catch (error) {
    // A stream that already started cannot carry a status, so just end it.
    if (res.headersSent) return void res.end();
    send(res, 502, { error: { message: error instanceof Error ? error.message : String(error) } });
  }
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Draggy (test)</title></head><body class="dark"><div id="root"></div><script type="module" src="/src/testEntry.ts"></script></body></html>`;

export function testHarness(): PluginOption {
  return {
    name: "draggy-test-harness",
    apply: "serve",
    configureServer(server) {
      if (process.env.DRAGGY_TEST_HARNESS !== "1") return;
      server.httpServer?.once("close", () => llama?.kill());
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        if (req.method === "GET" && url.pathname === "/test") {
          res.setHeader("Content-Type", "text/html");
          return res.end(await server.transformIndexHtml("/test", PAGE));
        }
        if (!url.pathname.startsWith("/__test/")) return next();
        if (url.pathname === "/__test/ipc" && req.method === "POST") {
          const body = await readJson(req);
          try {
            return send(res, 200, { value: (await handleIpc(String(body.channel), (body.args as unknown[]) ?? [])) ?? null });
          } catch (error) {
            return send(res, 200, { error: error instanceof Error ? error.message : String(error) });
          }
        }
        if (url.pathname === "/__test/unhandled") return send(res, 200, { channels: [...unhandled], counts: Object.fromEntries(counts) });
        if (url.pathname === "/__test/run" && req.method === "POST") return send(res, 200, await runCommand(await readJson(req)));
        if (url.pathname === "/__test/llm" && req.method === "POST") return proxyChat(req, res);
        if (url.pathname === "/__test/files") {
          const dir = chatDir(url.searchParams.get("chatId"));
          return send(res, 200, { files: dir && existsSync(dir) ? readdirSync(dir) : [] });
        }
        if (url.pathname === "/__test/reset" && req.method === "POST") {
          const dir = chatDir((await readJson(req)).chatId);
          if (dir) rmSync(dir, { recursive: true, force: true });
          return send(res, 200, { success: true });
        }
        return send(res, 404, { error: "unknown" });
      });
    },
  };
}
