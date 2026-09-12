const { log } = require("./logger.cjs");
const platform = require("./platform.cjs");
const fs = require("fs");
const path = require("path");
const catalogue = require("./mcpCatalogue.cjs");
const secrets = require("./secrets.cjs");
const { createHttpTransport } = require("./mcpHttp.cjs");
const oauth = require("./mcpOauth.cjs");

/**
 * Talking to MCP servers: a spawned program, JSON-RPC over stdio, one message a
 * line. Enabling one runs someone else's code, so nothing starts on its own.
 */

/** How long to wait for a server to answer `initialize` before giving up. */
const HANDSHAKE_TIMEOUT_MS = 60000;

/** How long any single tool call may take. */
const CALL_TIMEOUT_MS = 120000;

/**
 * The protocol version Draggy speaks. Servers negotiate down if they are older;
 * one that cannot agree says so in its initialize response.
 */
const PROTOCOL_VERSION = "2025-06-18";

/** Stops one runaway server filling the log or memory with output. */
const MAX_STDERR_CHARS = 8000;

/**
 * Splits a byte stream into whole JSON-RPC messages. A chunk from a pipe can
 * end anywhere, so the tail waits for the newline that completes it.
 */
function createLineReader(onMessage) {
  let buffer = "";

  return (chunk) => {
    buffer += chunk;

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        onMessage(JSON.parse(trimmed));
      } catch {
        // Servers write ordinary logging to stdout more often than they should.
        // A line that is not JSON is not a protocol error worth killing over.
      }
    }
  };
}

/**
 * Flattens a tool result into text. Images and audio are named rather than
 * dropped: a model told nothing came back calls the tool again.
 */
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

/**
 * A tool name unique across servers, since two may both offer `search`. The
 * prefix also tells an MCP tool from a built-in one.
 */
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

/**
 * Runs npm to completion, hidden, and resolves with what it wrote to stderr.
 * Scripts are refused: an MCP server has no business running one on install.
 */
function npmInstall(pkg) {
  const npm = platform.resolveNpm();
  if (!npm) return Promise.resolve({ ok: false, detail: "npm could not be found" });

  fs.mkdirSync(serverRoot, { recursive: true });

  return new Promise((resolve) => {
    const child = platform.spawnHidden(
      npm.file,
      [
        ...npm.prefixArgs,
        "install", pkg,
        "--prefix", serverRoot,
        "--no-audit", "--no-fund", "--no-package-lock",
        "--ignore-scripts",
        "--loglevel", "error",
      ],
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

/**
 * The JavaScript a package says to run, as an absolute path.
 *
 * Running it directly is what keeps a console window off the screen: npx starts
 * a package through a `cmd.exe` shim, and Electron is a GUI binary with no
 * console, so that shim gets a brand new visible one.
 */
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
async function provideServer(pkg) {
  const existing = entryPointFor(pkg);
  if (existing) return { entry: existing };

  const installed = await npmInstall(pkg);
  if (!installed.ok) {
    return { error: `${pkg} could not be installed${installed.detail ? `: ${installed.detail}` : ""}.` };
  }

  const entry = entryPointFor(pkg);
  if (!entry) {
    return { error: `${pkg} installed but does not say which file to run.` };
  }

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
      // The server's own risk hints, passed straight through: the permission
      // engine reads them, so a tool that calls itself read-only is trusted to
      // that extent and no further.
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

/**
 * Signs in to a remote server: discovery, registration if it is offered, then
 * the usual round trip through the user's own browser. Nothing is stored until
 * a token actually comes back.
 */
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

    log.info("mcp", `signed in to ${id}`);
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

/**
 * Starts a server and completes the handshake. Never throws: a server that will
 * not run is a message in the interface, not a broken app.
 */
/**
 * A server Draggy was told about rather than one it ships: a URL the user
 * pasted in. Remote servers are the only ones that can be described this way,
 * because a local one would mean running an arbitrary command.
 */
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

function definitionFor(id, config) {
  return catalogue.findEntry(id) || remoteDefinition(id, config);
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

    log.info("mcp", `refreshed the sign-in for ${id}`);
    return true;
  } catch (error) {
    log.warn("mcp", `could not refresh the sign-in for ${id}: ${error.message}`);
    return false;
  }
}

/** Brings a remote server up: no process, one handshake over HTTP. */
async function startRemote(id, definition) {
  const transport = createHttpTransport({
    url: definition.url,
    getToken: async () => (await tokensFor(id))?.access_token ?? null,
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

  try {
    await transport.send("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "Draggy", version: "2.0.0" },
    });

    await transport.notify("notifications/initialized", {});

    const listed = await transport.send("tools/list", {});
    entry.tools = Array.isArray(listed?.tools) ? listed.tools : [];
    entry.status = "ready";

    log.info("mcp", `${id} connected with ${entry.tools.length} tools`);
    return stateOf(entry);
  } catch (error) {
    running.delete(id);
    log.warn("mcp", `${id} could not be reached: ${error.message}`);

    return {
      id,
      status: "error",
      error: /401|403/.test(error.message)
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

  if (definition.transport === "http") return startRemote(id, definition);

  const missing = catalogue.missingRequirements(definition, config);
  if (missing.length > 0) {
    return {
      id,
      status: "error",
      error: `Not configured yet: ${missing.join(", ")}.`,
      tools: [],
    };
  }

  const spec = catalogue.commandFor(definition, config);

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

  const provided = await provideServer(definition.package);
  if (provided.error) {
    return { id, status: "error", error: provided.error, tools: [] };
  }

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
    }),
  );

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    // Kept, capped, and only surfaced when the server fails to start. Most
    // servers write ordinary startup chatter here.
    if (entry.stderr.length < MAX_STDERR_CHARS) entry.stderr += chunk;
  });

  child.on("error", (error) => {
    entry.status = "error";
    entry.error = error.message;
    settle(error.message);
  });

  child.on("exit", (code) => {
    running.delete(id);
    entry.status = "stopped";
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

  try {
    await send(
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

    log.info("mcp", `${id} started with ${entry.tools.length} tools`);
    return stateOf(entry);
  } catch (error) {
    // stderr is usually the only account of what went wrong. Without it the
    // user gets "did not answer in time" and nothing else.
    const detail = entry.stderr.trim().split("\n").slice(-4).join(" ").slice(0, 400);

    stopServer(id);
    log.warn("mcp", `${id} failed to start: ${error.message} ${detail}`);

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
  } catch {
    // Already gone, which is the state we wanted.
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

/**
 * Reads a widget's HTML from the server that offered it. Only called when the
 * user has switched widgets on for that server: an interface written by
 * somebody else is a bigger step than a line of text, so it is asked for.
 */
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
      log.warn("mcp", `${uri} is too large to show (${markup.length} characters)`);
      return null;
    }

    return markup;
  } catch (error) {
    log.warn("mcp", `could not read ${uri}: ${error.message}`);
    return null;
  }
}

async function callTool(serverId, toolName, args, options = {}) {
  const entry = running.get(serverId);
  if (!entry) {
    return { success: false, error: `The ${serverId} server is not running.` };
  }

  try {
    const result = await entry.send(
      "tools/call",
      { name: toolName, arguments: args || {} },
      CALL_TIMEOUT_MS,
    );

    const text = renderToolResult(result);

    // `isError` means the tool failed, as distinct from the call failing.
    // Both are worth reporting, and they mean different things.
    if (result?.isError) {
      return { success: false, error: text || "The tool reported an error." };
    }

    const uri = options.widgets ? widgetUri(result) : null;
    const html = uri ? await readWidget(entry, uri) : null;

    return {
      success: true,
      text: text || (html ? "(the tool answered with a widget)" : "(the tool returned nothing)"),
      ...(html ? { app: { uri, html } } : {}),
    };
  } catch (error) {
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
