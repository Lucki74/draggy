/** JSONL JSON-RPC over a child's stdio. Codex's app-server leaves out the "jsonrpc" field and the Gemini
 * CLI's ACP requires it, so the field is an option rather than a rule. */

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_LINE_BYTES = 8 * 1024 * 1024;
const NEWLINE = 0x0a;

class RpcError extends Error {
  constructor(message, code, data) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}

/** Calls a handler for each complete line; a line over the limit is dropped whole, so a runaway never grows the buffer. */
function splitLines(stream, maxLineBytes, onLine, onOversize) {
  let pieces = [];
  let size = 0;
  let skipping = false;
  stream.on("data", (chunk) => {
    let buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    for (let at = buf.indexOf(NEWLINE); at !== -1; at = buf.indexOf(NEWLINE)) {
      const head = buf.subarray(0, at);
      buf = buf.subarray(at + 1);
      if (skipping || size + head.length > maxLineBytes) {
        if (!skipping) onOversize(size + head.length);
        skipping = false;
      } else if (size + head.length > 0) {
        onLine(Buffer.concat([...pieces, head]).toString("utf8"));
      }
      pieces = [];
      size = 0;
    }
    if (skipping || buf.length === 0) return;
    if (size + buf.length > maxLineBytes) {
      onOversize(size + buf.length);
      pieces = [];
      size = 0;
      skipping = true;
      return;
    }
    pieces.push(buf);
    size += buf.length;
  });
}

function createRpc({
  input,
  output,
  jsonrpc = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxLineBytes = DEFAULT_MAX_LINE_BYTES,
  onNotification = () => {},
  onRequest = null,
  onClose = () => {},
  log = null,
}) {
  let nextId = 1;
  let closedWith = null;
  const pending = new Map();

  const write = (message) => {
    if (closedWith) return false;
    output.write(`${JSON.stringify(jsonrpc ? { jsonrpc: "2.0", ...message } : message)}\n`);
    return true;
  };

  function close(reason = new RpcError("The runtime closed its connection", "closed")) {
    if (closedWith) return;
    closedWith = reason;
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(reason);
    }
    pending.clear();
    onClose(reason);
  }

  function call(method, params, options = {}) {
    if (closedWith) return Promise.reject(closedWith);
    const id = nextId++;
    const wait = options.timeoutMs ?? timeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new RpcError(`${method} got no answer in ${wait} ms`, "timeout"));
      }, wait);
      pending.set(id, { resolve, reject, timer });
      write(params === undefined ? { id, method } : { id, method, params });
    });
  }

  function notify(method, params) {
    return write(params === undefined ? { method } : { method, params });
  }

  async function answer({ id, method, params }) {
    if (!onRequest) {
      write({ id, error: { code: -32601, message: `${method} is not handled` } });
      return;
    }
    try {
      const result = await onRequest(method, params);
      write({ id, result: result ?? null });
    } catch (error) {
      const code = Number.isInteger(error?.code) ? error.code : -32603;
      write({ id, error: { code, message: String(error?.message || "Request failed") } });
    }
  }

  function receive(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      // The line is not logged: it may be half of an auth payload.
      log?.(`dropped a line that is not JSON (${line.length} chars)`);
      return;
    }
    if (!message || typeof message !== "object") return;
    if (typeof message.method === "string") {
      if (message.id !== undefined && message.id !== null) void answer(message);
      else onNotification(message.method, message.params);
      return;
    }
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    clearTimeout(waiting.timer);
    if (message.error) {
      const { message: text, code, data } = message.error;
      waiting.reject(new RpcError(String(text || "Request failed"), code, data));
    } else {
      waiting.resolve(message.result);
    }
  }

  splitLines(input, maxLineBytes, receive, (bytes) => log?.(`dropped a line of ${bytes} bytes over the limit`));
  input.on("end", () => close());
  input.on("close", () => close());
  input.on("error", (error) => close(new RpcError(error.message, "closed")));
  output.on("error", (error) => close(new RpcError(error.message, "closed")));

  return { call, notify, close, get closed() { return closedWith !== null; } };
}

const REDACTED = "[redacted]";
const SECRET_FIELD = /("(?:[\w-]*token|[\w-]*secret|api_?key|apiKey|authorization|password|code|state)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi;
const SECRET_PARAM = /\b((?:code|state|[\w-]*token|key|client_secret)=)[^&\s"'<>]+/gi;

/** Strips every token-shaped thing from a runtime's log line; nothing of a token is kept, not even a prefix. */
function redact(text) {
  return String(text)
    .replace(SECRET_FIELD, `$1"${REDACTED}"`)
    .replace(SECRET_PARAM, `$1${REDACTED}`)
    .replace(/\b(Bearer|Basic)\s+[^\s"',]+/gi, `$1 ${REDACTED}`)
    .replace(/\beyJ[\w-]+\.[\w-]+(?:\.[\w-]*)?/g, REDACTED)
    .replace(/\b(?:sk|pk|rk)-[\w-]{8,}/g, REDACTED)
    .replace(/\bya29\.[\w-]+/g, REDACTED)
    .replace(/[A-Za-z0-9_\-+/]{32,}={0,2}/g, (run) => (run.split("/").some(opaque) ? REDACTED : run));
}

/** A path's folders are short; a token's run of letters and digits is not. */
function opaque(part) {
  return part.length >= 24 && /[A-Za-z]/.test(part) && /\d/.test(part);
}

/** Sends each stderr line, redacted, to the log; a runtime prints its sign-in URLs and payloads there. */
function drainStderr(stream, write, maxLineBytes = 64 * 1024) {
  splitLines(stream, maxLineBytes, (line) => write(redact(line)), (bytes) => write(`[a line of ${bytes} bytes]`));
}

module.exports = { createRpc, drainStderr, splitLines, redact, RpcError, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_LINE_BYTES };
