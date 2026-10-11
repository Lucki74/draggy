const { log } = require("./logger.cjs");
const platform = require("./platform.cjs");
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const { createRing } = require("./ringBuffer.cjs");
const catalogue = require("./mcpCatalogue.cjs");
const secrets = require("./secrets.cjs");
const { createHttpTransport } = require("./mcpHttp.cjs");
const oauth = require("./mcpOauth.cjs");

/** Talking to MCP servers: a spawned program, JSON-RPC over stdio, one message a line. Enabling one
 * runs someone else's code, so nothing starts on its own. */

/** How long to wait for a server to answer `initialize` before giving up. */
const HANDSHAKE_TIMEOUT_MS = 60000;

/** How long any single tool call may take. */
const CALL_TIMEOUT_MS = 120000;

/** The protocol version Draggy speaks. Servers negotiate down if they are older; one that cannot
 * agree says so in its initialize response. */
const PROTOCOL_VERSION = "2025-06-18";

/** Stops one runaway server filling the log or memory with output. */
const MAX_STDERR_CHARS = 8000;

/** The log scope for one server: `mcp.<id>`, with the id lowercased and cut to [a-z0-9_-] and 32
 * characters, so one filter picks up everything that server did. */
function scopeFor(id) {
  const clean = String(id).toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 32);
  return `mcp.${clean || "server"}`;
}

/** Splits a byte stream into whole JSON-RPC messages. A chunk from a pipe can end anywhere, so the
 * tail waits for the newline that completes it. Message bodies are never logged, only their size. */
function createLineReader(onMessage, meta = {}) {
  let buffer = "";
  const scope = meta.server ? scopeFor(meta.server) : "mcp";

  return (chunk) => {
    buffer += chunk;

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed);
        log.debug(scope, "message in", { ...meta, bytes: trimmed.length });
        onMessage(parsed);
      } catch {
        log.debug(scope, "non-json line", { ...meta, bytes: trimmed.length });
      }
    }
  };
}

/** Flattens a tool result into text. Images and audio are named rather than dropped: a model told
 * nothing came back calls the tool again. */
function renderToolResult(result) {
  if (!result || typeof result !== "object") return "";

  const blocks = Array.isArray(result.content) ? result.content : [];

  const parts = blocks.map((block) => {
    if (!block || typeof block !== "object") return "";
    if (block.type === "text") return String(block.text ?? "");
    if (block.type === "image") return `[image returned, ${block.mimeType || "unknown type"}]`;
    if (block.type === "audio") return `[audio returned, ${block.mimeType || "unknown type"}]`;
    if (block.type === "resource") {
      const resource = block.resource || {};
      if (isWidget(resource.uri)) return `[interface: ${resource.uri}]`;
      if (typeof resource.text === "string") return resource.text;
      return `[resource: ${resource.uri || "unnamed"}]`;
    }
    return "";
  });

  const text = parts.filter(Boolean).join("\n\n").trim();

  if (!text && result.structuredContent) {
    return JSON.stringify(result.structuredContent);
  }

  return text;
}

/** A tool name unique across servers, since two may both offer `search`. The prefix also tells an
 * MCP tool from a built-in one. */
function qualifiedName(serverId, toolName) {
  const clean = (value) => String(value).replace(/[^a-zA-Z0-9_]/g, "_");
  return `${clean(serverId)}__${clean(toolName)}`;
}

function splitQualifiedName(name) {
  const index = String(name).indexOf("__");
  if (index === -1) return null;
  return {
    serverId: String(name).slice(0, index),
    toolName: String(name).slice(index + 2),
  };
}

/** How long an install may take before it is treated as stuck. */
const INSTALL_TIMEOUT_MS = 180000;

/** Where servers are installed. Set once, from the app's data folder. */
let serverRoot = null;

function init(userDataPath) {
  serverRoot = path.join(userDataPath, "mcp-servers");
}

/** Runs npm to completion, hidden, and resolves with what it wrote to stderr. Scripts are refused:
 * an MCP server has no business running one on install. */
/** The npm executable and the arguments an install of `pkg` runs with. Null when npm is missing. */
function installCommand(pkg) {
  const npm = platform.resolveNpm();
  if (!npm) return null;

  return {
    file: npm.file,
    args: [
      ...npm.prefixArgs,
      "install", pkg,
      "--prefix", serverRoot,
      "--no-audit", "--no-fund", "--no-package-lock",
      "--ignore-scripts",
      "--loglevel", "error",
    ],
  };
}

/** Install lines carry the executable and its arguments, each cut short, so a failed install can be
 * reproduced from the log. Env values never go in. */
function installFields(install) {
  return {
    command: install?.file ?? null,
    args: (install?.args ?? []).map((arg) => String(arg).slice(0, 80)),
  };
}

function npmInstall(pkg) {
  const install = installCommand(pkg);
  if (!install) return Promise.resolve({ ok: false, detail: "npm could not be found" });

  fs.mkdirSync(serverRoot, { recursive: true });

  return new Promise((resolve) => {
    const child = platform.spawnHidden(
      install.file,
      install.args,
      {
        env: { ...platform.defaultShellEnv(), ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_STDERR_CHARS) stderr += chunk;
    });

    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, detail: "the download timed out" });
    }, INSTALL_TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, detail: error.message });
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, detail: stderr.trim().split("\n").slice(-3).join(" ") });
    });
  });
}

/** The absolute path of a package's JavaScript. Run directly, because npx goes through a cmd.exe
 * shim that pops a console window from a GUI app. */
function entryPointFor(pkg) {
  const dir = path.join(serverRoot, "node_modules", ...pkg.split("/"));
  const manifestPath = path.join(dir, "package.json");
  if (!fs.existsSync(manifestPath)) return null;

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }

  const bin = manifest.bin;
  const relative =
    typeof bin === "string"
      ? bin
      : bin && typeof bin === "object"
        ? bin[Object.keys(bin)[0]]
        : manifest.main;

  if (!relative) return null;

  const entry = path.join(dir, relative);
  return fs.existsSync(entry) ? entry : null;
}

/** Installs a server if it is not already on disk, and returns its entry point. */
async function provideServer(pkg, server = null) {
  const existing = entryPointFor(pkg);
  if (existing) return { entry: existing };

  const scope = scopeFor(server);
  const install = installFields(installCommand(pkg));
  log.info(scope, "installing server package", { server, transport: "stdio", package: pkg, ...install });
  const started = Date.now();
  const installed = await npmInstall(pkg);
  if (!installed.ok) {
    log.warn(scope, "server package install failed", { server, transport: "stdio", package: pkg, ...install, durMs: Date.now() - started, detail: installed.detail });
    return { error: `${pkg} could not be installed${installed.detail ? `: ${installed.detail}` : ""}.` };
  }

  const entry = entryPointFor(pkg);
  if (!entry) {
    return { error: `${pkg} installed but does not say which file to run.` };
  }

  log.info(scope, "installed server package", { server, transport: "stdio", package: pkg, ...install, durMs: Date.now() - started });
  return { entry };
}

/** Every running server, by catalogue id. */
const running = new Map();

function stateOf(entry) {
  return {
    id: entry.id,
    status: entry.status,
    error: entry.error,
    tools: entry.tools.map((tool) => ({
      name: tool.name,
      qualifiedName: qualifiedName(entry.id, tool.name),
      description: tool.description || "",
      // The server's own risk hints, passed straight through: the permission engine reads them, so
      // a tool that calls itself read-only is trusted to that extent and no further.
      annotations: tool.annotations || undefined,
      inputSchema: tool.inputSchema || { type: "object", properties: {} },
    })),
  };
}

/** Whether a server is one Draggy reaches over the network. */
function isRemote(id, config) {
  const definition = definitionFor(id, config);
  return definition?.transport === "http";
}

/** Signs in to a remote server: discovery, registration if it is offered, then the usual round trip
 * through the user's own browser. Nothing is stored until a token actually comes back. */
async function signIn(id, url, openExternal) {
  const listener = oauth.listenForCode();

  try {
    const redirectUri = await listener.ready;
    const metadata = await oauth.discover(url);

    const existing = secrets.get(`oauth:${id}`);
    const registered =
      existing?.client_id && existing?.redirect_uri === redirectUri
        ? existing
        : await oauth.register(metadata, redirectUri);

    const clientId = registered?.client_id || existing?.client_id;
    if (!clientId) {
      listener.close();
      return {
        success: false,
        error:
          "That server does not offer registration, so Draggy has no client id to sign in with.",
      };
    }

    const { verifier, challenge } = oauth.pkce();
    const state = Math.random().toString(36).slice(2);

    await openExternal(
      oauth.authorizeUrl({
        metadata,
        clientId,
        redirectUri,
        challenge,
        state,
        scope: (metadata.scopes_supported || []).join(" ") || undefined,
        resource: url,
      }),
    );

    const answer = await listener.waitForCode;

    // The state is the only thing tying the callback to the request Draggy
    // made; a mismatch means the code came from somewhere else.
    if (answer.state !== state) {
      return { success: false, error: "That sign-in did not match this request." };
    }

    const tokens = await oauth.exchange({
      metadata,
      clientId,
      clientSecret: registered?.client_secret,
      code: answer.code,
      verifier,
      redirectUri,
      resource: url,
    });

    secrets.set(`oauth:${id}`, {
      ...tokens,
      client_id: clientId,
      client_secret: registered?.client_secret ?? "",
      redirect_uri: redirectUri,
      expiresAt: oauth.expiryOf(tokens) ?? "",
    });

    log.info(scopeFor(id), "signed in", { server: id, transport: "http" });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    listener.close();
  }
}

function signOut(id) {
  secrets.remove(`oauth:${id}`);
  stopServer(id);
  return { success: true };
}

function listRunning() {
  return [...running.values()].map(stateOf);
}

function isRunning(id) {
  return running.has(id);
}

/** What the handshake settled on, for one INFO line: who answered, which protocol, how long it took. */
function handshakeSummary(transport, hello, tools, startedAt) {
  return {
    transport,
    protocol: hello?.protocolVersion ?? null,
    server: hello?.serverInfo?.name ?? null,
    serverVersion: hello?.serverInfo?.version ?? null,
    capabilities: Object.keys(hello?.capabilities || {}),
    tools,
    durMs: Date.now() - startedAt,
  };
}

/** Starts a server and completes the handshake. Never throws: a server that will not run is a
 * message in the interface, not a broken app. */
/** A server the user pasted as a URL. Only remote servers can be described like this; a local one
 * would mean running an arbitrary command. */
function remoteDefinition(id, config) {
  if (!config?.url) return null;

  return {
    id,
    name: config.name || id,
    transport: "http",
    url: String(config.url),
    remote: true,
  };
}

/** An npm package saved from the registry or entered as a custom extension. */
function packageDefinition(id, config) {
  if (!config?.package) return null;

  return {
    id,
    name: config.name || id,
    description: config.description || "",
    package: String(config.package),
    docs: config.docs || `https://www.npmjs.com/package/${config.package}`,
    args: Array.isArray(config.args) ? config.args : [],
    arguments: Array.isArray(config.argumentsList) ? config.argumentsList : [],
    env: Array.isArray(config.envDeclarations) ? config.envDeclarations : [],
    source: "registry",
  };
}

function definitionFor(id, config) {
  return (
    catalogue.findEntry(id) ||
    packageDefinition(id, config) ||
    remoteDefinition(id, config)
  );
}

/** The token a remote server is called with, and the way to renew it. */
async function tokensFor(id) {
  const stored = secrets.get(`oauth:${id}`);
  if (!stored?.access_token) return null;

  return {
    ...stored,
    expiresAt: stored.expiresAt ? Number(stored.expiresAt) : null,
  };
}

async function refreshTokens(id, url) {
  const stored = await tokensFor(id);
  if (!stored?.refresh_token) return false;

  try {
    const metadata = await oauth.discover(url);
    const next = await oauth.refresh({
      metadata,
      clientId: stored.client_id,
      clientSecret: stored.client_secret,
      refreshToken: stored.refresh_token,
      resource: url,
    });

    secrets.set(`oauth:${id}`, {
      ...stored,
      ...next,
      // A server that does not send a new refresh token means keep the old one.
      refresh_token: next.refresh_token || stored.refresh_token,
      expiresAt: oauth.expiryOf(next) ?? "",
    });

    log.info(scopeFor(id), "refreshed sign-in", { server: id, transport: "http" });
    return true;
  } catch (error) {
    log.warn(scopeFor(id), "could not refresh sign-in",{ server: id, transport: "http", reason: error.message });
    return false;
  }
}

/** Brings a remote server up: no process, one handshake over HTTP. */
async function startRemote(id, definition, fullConfig = {}) {
  const transport = createHttpTransport({
    url: definition.url,
    server: id,
    scope: scopeFor(id),
    getToken: async () => (await tokensFor(id))?.access_token ?? null,
    getHeaders: async () => {
      const headers = {};
      const env = fullConfig.env || {};
      const apiKey = env.COMPOSIO_API_KEY || env.API_KEY || env.MCP_API_KEY;
      if (apiKey) {
        headers["x-consumer-api-key"] = apiKey;
        headers["x-api-key"] = apiKey;
      }
      return headers;
    },
    onUnauthorized: () => refreshTokens(id, definition.url),
  });

  const entry = {
    id,
    child: null,
    remote: true,
    url: definition.url,
    status: "starting",
    error: null,
    tools: [],
    pending: new Map(),
    nextId: 1,
    stderr: "",
    send: (method, params) => transport.send(method, params),
    close: () => transport.close(),
  };

  running.set(id, entry);

  const handshakeAt = Date.now();

  try {
    const hello = await transport.send("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "Draggy", version: "2.0.0" },
    });

    await transport.notify("notifications/initialized", {});

    const listed = await transport.send("tools/list", {});
    entry.tools = Array.isArray(listed?.tools) ? listed.tools : [];
    entry.status = "ready";

    log.info(scopeFor(id), "connected", { ...handshakeSummary("http", hello, entry.tools.length, handshakeAt), server: id, serverName: hello?.serverInfo?.name ?? null });
    return stateOf(entry);
  } catch (error) {
    running.delete(id);
    // A status says what happened; the body of a refusal does not go to the log.
    log.warn(scopeFor(id), "could not reach server", {
      server: id,
      transport: "http",
      status: error.status ?? null,
      reason: error.status ? null : error.message,
    });

    return {
      id,
      status: "error",
      error:
        /401|403/.test(error.message) && !definition.env?.length
          ? "That server wants you to sign in first."
          : error.message,
      tools: [],
    };
  }
}

async function startServer(id, config = {}) {
  if (running.has(id)) return stateOf(running.get(id));

  const definition = definitionFor(id, config);
  if (!definition) {
    return { id, status: "error", error: `There is no server called "${id}".`, tools: [] };
  }

  // Credentials live in the encrypted store, so they have to be merged before checking requirements.
  const fullConfig = { ...config, env: secrets.withSecrets(id, config.env) };

  const missing = catalogue.missingRequirements(definition, fullConfig);
  if (missing.length > 0) {
    return {
      id,
      status: "error",
      error: `Not configured yet: ${missing.join(", ")}.`,
      tools: [],
    };
  }

  if (definition.transport === "http") return startRemote(id, definition, fullConfig);

  const spec = catalogue.commandFor(definition, fullConfig);

  if (!serverRoot) {
    return { id, status: "error", error: "Extensions are not ready yet.", tools: [] };
  }

  if (!platform.resolveNpm()) {
    return {
      id,
      status: "error",
      error:
        "npm could not be found on this machine, and extensions are installed with it. Install Node.js and try again.",
      tools: [],
    };
  }

  const provided = await provideServer(definition.package, id);
  if (provided.error) {
    return { id, status: "error", error: provided.error, tools: [] };
  }

  // Only the executable's name and the number of arguments: the paths and env values stay out.
  log.info(scopeFor(id), "spawning server", {
    server: id,
    transport: "stdio",
    command: path.basename(process.execPath),
    argCount: 1 + spec.args.length,
  });

  let child;
  try {
    child = platform.spawnHidden(process.execPath, [provided.entry, ...spec.args], {
      // The server inherits a normal shell environment plus whatever
      // credentials were entered for it, and nothing else.
      env: {
        ...platform.defaultShellEnv(),
        ELECTRON_RUN_AS_NODE: "1",
        ...secrets.withSecrets(id, spec.env),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    return { id, status: "error", error: error.message, tools: [] };
  }

  const entry = {
    id,
    child,
    status: "starting",
    error: null,
    tools: [],
    pending: new Map(),
    nextId: 1,
    stderr: "",
    stderrRing: createRing(),
  };

  running.set(id, entry);

  const settle = (message) => {
    const waiting = [...entry.pending.values()];
    entry.pending.clear();
    for (const pending of waiting) pending.reject(new Error(message));
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on(
    "data",
    createLineReader((message) => {
      if (message.id === undefined || message.id === null) return;

      const pending = entry.pending.get(message.id);
      if (!pending) return;
      entry.pending.delete(message.id);

      if (message.error) {
        pending.reject(new Error(message.error.message || "The server reported an error."));
      } else {
        pending.resolve(message.result);
      }
    }, { server: id, transport: "stdio" }),
  );

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    for (const line of chunk.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      entry.stderrRing.push(trimmed.slice(0, 500));
    }
    if (entry.stderr.length < MAX_STDERR_CHARS) entry.stderr += chunk;
  });

  child.on("error", (error) => {
    log.fail(scopeFor(id), "process error", error, { server: id, transport: "stdio" });
    entry.status = "error";
    entry.error = error.message;
    settle(error.message);
  });

  child.on("exit", (code) => {
    // Still registered means nobody asked for the stop, so this is a crash.
    const unexpected = running.get(id) === entry;
    running.delete(id);
    entry.status = "stopped";

    if (unexpected) {
      entry.exitLogged = true;
      log.error("proc.mcp", "server exited unexpectedly", {
        server: id,
        transport: "stdio",
        code,
        stderr: entry.stderrRing.dump(),
      });
    } else {
      log.info(scopeFor(id), "server stopped", { server: id, transport: "stdio", code });
    }

    settle(`The ${id} server stopped (exit code ${code}).`);
  });

  const send = (method, params, timeoutMs) =>
    new Promise((resolve, reject) => {
      if (child.exitCode !== null || !child.stdin.writable) {
        reject(new Error(`The ${id} server is not running.`));
        return;
      }

      const messageId = entry.nextId++;

      const timer = setTimeout(() => {
        entry.pending.delete(messageId);
        reject(new Error(`The ${id} server did not answer ${method} in time.`));
      }, timeoutMs);

      entry.pending.set(messageId, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: messageId, method, params })}\n`);
    });

  const notify = (method, params) => {
    if (child.stdin.writable) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    }
  };

  entry.send = send;

  const handshakeAt = Date.now();

  try {
    const hello = await send(
      "initialize",
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "Draggy", version: "1.1.6" },
      },
      HANDSHAKE_TIMEOUT_MS,
    );

    notify("notifications/initialized", {});

    const listed = await send("tools/list", {}, HANDSHAKE_TIMEOUT_MS);
    entry.tools = Array.isArray(listed?.tools) ? listed.tools : [];
    entry.status = "ready";

    log.info(scopeFor(id), "started", { ...handshakeSummary("stdio", hello, entry.tools.length, handshakeAt), server: id, serverName: hello?.serverInfo?.name ?? null });
    return stateOf(entry);
  } catch (error) {
    // stderr is usually the only account of what went wrong. Without it the
    // user gets "did not answer in time" and nothing else.
    const detail = entry.stderr.trim().split("\n").slice(-4).join(" ").slice(0, 400);

    stopServer(id);
    // A crash during the handshake has already been logged as one block by the exit handler.
    if (!entry.exitLogged) {
      log.error("proc.mcp", "server failed the handshake", {
        server: id,
        transport: "stdio",
        reason: error.message,
        stderr: entry.stderrRing.dump(),
      });
    }

    return {
      id,
      status: "error",
      error: detail ? `${error.message}: ${detail}` : error.message,
      tools: [],
    };
  }
}

function stopServer(id, now = false) {
  const entry = running.get(id);
  if (!entry) return { success: true };

  running.delete(id);

  if (entry.remote) {
    // Nothing to kill: say goodbye to the session and let it go.
    void entry.close?.();
    return { success: true };
  }

  try {
    // Ending stdin is how the protocol says goodbye; the tree kill is for the
    // server that ignores it, and for anything the server started itself.
    entry.child.stdin.end();
    if (now) platform.killTreeSync(entry.child);
    else platform.killTree(entry.child);
  } catch (error) {
    log.swallow(scopeFor(id), error, "already gone, which is the state we wanted");
  }

  return { success: true };
}

/** For quitting, so every kill has finished before Draggy has. */
function stopAll() {
  for (const id of [...running.keys()]) stopServer(id, true);
}

/** How much markup a widget may be before it is treated as a mistake. */
const MAX_WIDGET_CHARS = 256 * 1024;

/** Whether a uri names an interface rather than a document. */
function isWidget(uri) {
  return typeof uri === "string" && uri.startsWith("ui://");
}

/** The ui:// resource a tool pointed at, if it pointed at one. */
function widgetUri(result) {
  const blocks = Array.isArray(result?.content) ? result.content : [];

  for (const block of blocks) {
    if (isWidget(block?.resource?.uri)) return block.resource.uri;
    if (block?.type === "resource_link" && isWidget(block.uri)) return block.uri;
  }

  return null;
}

/** Reads a widget's HTML from its server for tools that respond with an interface. */
async function readWidget(entry, uri) {
  try {
    const resource = await entry.send("resources/read", { uri }, CALL_TIMEOUT_MS);
    const contents = Array.isArray(resource?.contents) ? resource.contents : [];

    // Prefer the part that says it is HTML; fall back to the first thing
    // with any text in it, since not every server sets a mime type.
    const withText = contents.filter(
      (one) => typeof one?.text === "string" && one.text.trim(),
    );

    const html =
      withText.find((one) => String(one.mimeType || "").includes("html")) ||
      withText[0];

    if (!html) return null;

    const markup = String(html.text);

    if (markup.length > MAX_WIDGET_CHARS) {
      log.warn(scopeFor(entry.id), "widget too large to show",{ server: entry.id, transport: entry.remote ? "http" : "stdio", chars: markup.length });
      return null;
    }

    return markup;
  } catch (error) {
    log.warn(scopeFor(entry.id), "could not read widget",{ server: entry.id, transport: entry.remote ? "http" : "stdio", reason: error.message });
    return null;
  }
}

async function callTool(serverId, toolName, args, options = {}) {
  const entry = running.get(serverId);
  const transport = entry ? (entry.remote ? "http" : "stdio") : "none";
  if (!entry) {
    log.warn(scopeFor(serverId), "cannot call tool, server not running", { cid: options.cid, server: serverId, transport, toolName });
    return { success: false, error: `The ${serverId} server is not running.` };
  }

  const started = Date.now();
  // Arguments are the model's or the user's content, so only a short hash of them is logged.
  const argHash = createHash("sha256").update(JSON.stringify(args || {})).digest("hex").slice(0, 8);
  log.info(scopeFor(serverId), "tool call", { cid: options.cid, server: serverId, transport, toolName, argHash });

  try {
    const result = await entry.send(
      "tools/call",
      { name: toolName, arguments: args || {} },
      CALL_TIMEOUT_MS,
    );

    const text = renderToolResult(result);
    const durationMs = Date.now() - started;

    // `isError` means the tool failed, as distinct from the call failing.
    // Both are worth reporting, and they mean different things.
    if (result?.isError) {
      log.warn(scopeFor(serverId), "tool returned an error",{ cid: options.cid, server: serverId, transport, toolName, durMs: durationMs, resultChars: text.length, isError: true });
      return { success: false, error: text || "The tool reported an error." };
    }

    const uri = options.widgets !== false ? widgetUri(result) : null;
    const html = uri ? await readWidget(entry, uri) : null;

    log.info(scopeFor(serverId), "tool finished",{ cid: options.cid, server: serverId, transport, toolName, durMs: durationMs, resultChars: text ? text.length : 0, isError: false });
    return {
      success: true,
      text: text || (html ? "(the tool answered with a widget)" : "(the tool returned nothing)"),
      ...(html ? { app: { uri, html } } : {}),
    };
  } catch (error) {
    log.fail(scopeFor(serverId), "tool call threw", error,{ cid: options.cid, server: serverId, transport, toolName, durMs: Date.now() - started, isError: true });
    return { success: false, error: error.message };
  }
}

module.exports = {
  init,
  definitionFor,
  signIn,
  signOut,
  isRemote,
  entryPointFor,
  PROTOCOL_VERSION,
  createLineReader,
  renderToolResult,
  qualifiedName,
  splitQualifiedName,
  widgetUri,
  MAX_WIDGET_CHARS,
  startServer,
  stopServer,
  stopAll,
  callTool,
  listRunning,
  isRunning,
};
