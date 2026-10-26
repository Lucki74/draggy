const crypto = require("crypto");
const platform = require("./platform.cjs");
const { buildEnv } = require("./exec.cjs");
const { shellInvocation } = require("./shells.cjs");
const { log } = require("./logger.cjs");

/** Interactive shells on a pseudo-terminal. The renderer asks for one, gets an id minted here, and
 * can only write to, resize or close the sessions its own window opened. */

const MAX_SESSIONS = 8;
const MAX_WRITE_CHARS = 65536;
/** An unfinished escape sequence is held back for the next chunk, up to this many characters. */
const MAX_PENDING_ESCAPE = 8192;

/** Variables that usually hold a credential. A shell the user types into does not need them, and a
 * program they run would inherit them. */
const SECRET_ENV =
  /(^|_)(API_?KEY|APIKEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIALS?|AUTH)(_|$)|^(ANTHROPIC|OPENAI|GEMINI|GOOGLE_API|AWS_SECRET|AZURE_CLIENT_SECRET|NPM_CONFIG__AUTH)/i;

function filterEnv(env) {
  const kept = {};
  for (const [key, value] of Object.entries(env)) {
    if (!SECRET_ENV.test(key)) kept[key] = value;
  }
  return kept;
}

/* eslint-disable no-control-regex -- escape sequences are made of control characters */
// Everything between the escape and its terminator. OSC ends with BEL or ST, the others with ST.
const OSC = /\u001b\]([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g;
const STRING_SEQUENCE = /\u001b[P_^X][^\u001b]*\u001b\\/g;
const UNFINISHED = /\u001b(?:[\]P_^X][^\u001b\u0007]*)?$/;
// C1 controls other than the ones UTF-8 text cannot produce anyway: 8-bit OSC, DCS and the like.
const C1 = /[\u0080-\u009f]/g;

/** A filter for what a shell prints. Window titles (OSC 0 to 2), clipboard writes (OSC 52), device
 * strings and every other OSC are dropped: output from a program is not a way to change the
 * clipboard or the app. Hyperlinks (OSC 8) pass and the renderer checks their address. A sequence
 * split between two chunks is held until it ends. */
function createSanitizer() {
  let pending = "";

  return function sanitize(chunk) {
    let text = pending + String(chunk);
    pending = "";

    const open = UNFINISHED.exec(text);
    if (open) {
      const held = text.slice(open.index);
      text = text.slice(0, open.index);
      if (held.length <= MAX_PENDING_ESCAPE) pending = held;
    }

    return text
      .replace(OSC, (whole, body) => (body.startsWith("8;") ? whole : ""))
      .replace(STRING_SEQUENCE, "")
      .replace(C1, "");
  };
}

/** The arguments of an interactive session for each shell. */
function interactiveArgs(shell) {
  if (shell === "bash") return ["--login", "-i"];
  if (shell === "sh") return ["-i"];
  if (shell === "pwsh" || shell === "powershell") return ["-NoLogo"];
  return [];
}

const clamp = (value, low, high, fallback) => {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : fallback;
};

function createShellHost(deps = {}) {
  const spawnPty = deps.spawnPty || platform.spawnPty;
  const killPty = deps.killPty || platform.killPty;
  const sessions = new Map();

  const owned = (id, owner) => {
    const session = sessions.get(String(id));
    return session && session.owner === owner ? session : null;
  };

  /** Opens a shell in a folder. `owner` is the window that asked; events go to its callbacks. */
  function open({ owner, cwd, shell, defaultShell, cols, rows, onData, onExit }) {
    if (!deps.spawnPty && !platform.ptyAvailable()) {
      return { success: false, unavailable: true, error: "The terminal is not available on this computer." };
    }
    if (sessions.size >= MAX_SESSIONS) {
      return { success: false, error: `At most ${MAX_SESSIONS} terminals can be open at once.` };
    }

    const invocation = shellInvocation("", shell === "default" ? undefined : shell, {
      defaultShell,
      ...(deps.invocation || {}),
    });
    if (invocation.error) return { success: false, error: invocation.error };

    const id = `pty-${crypto.randomBytes(8).toString("hex")}`;
    let terminal;
    try {
      terminal = spawnPty(invocation.file, interactiveArgs(invocation.shell), {
        cwd,
        cols: clamp(cols, 2, 500, 80),
        rows: clamp(rows, 1, 200, 24),
        env: { ...filterEnv(buildEnv(invocation.env, deps.baseEnv)), TERM: "xterm-256color", COLORTERM: "truecolor" },
      });
    } catch (error) {
      log.warn("proc.pty", "terminal did not start", { shell: invocation.shell, error: error?.message });
      return { success: false, error: error?.message || "The terminal did not start." };
    }

    const sanitize = createSanitizer();
    const session = { id, owner, terminal, shell: invocation.shell, closed: false };
    sessions.set(id, session);
    log.info("proc.pty", "terminal opened", { id, shell: invocation.shell, pid: terminal.pid });

    terminal.onData((data) => {
      const clean = sanitize(data);
      if (clean) onData?.(id, clean);
    });
    terminal.onExit(({ exitCode }) => {
      if (session.closed) return;
      session.closed = true;
      sessions.delete(id);
      log.info("proc.pty", "terminal closed", { id, exitCode });
      onExit?.(id, exitCode);
    });

    return { success: true, id, shell: invocation.shell, ...(invocation.notice ? { notice: invocation.notice } : {}) };
  }

  /** Keystrokes and pastes from the user. Only text, only for a session the caller owns. */
  function write(id, owner, data) {
    const session = owned(id, owner);
    if (!session || typeof data !== "string" || data.length > MAX_WRITE_CHARS) return false;
    session.terminal.write(data);
    return true;
  }

  function resize(id, owner, cols, rows) {
    const session = owned(id, owner);
    if (!session) return false;
    try {
      session.terminal.resize(clamp(cols, 2, 500, 80), clamp(rows, 1, 200, 24));
      return true;
    } catch (error) {
      log.swallow("proc.pty", error, "the shell exited while the pane was resized");
      return false;
    }
  }

  function close(id, owner) {
    const session = owned(id, owner);
    if (!session) return false;
    session.closed = true;
    sessions.delete(session.id);
    killPty(session.terminal);
    return true;
  }

  /** Every session a window opened, for when that window goes away. */
  function closeOwner(owner) {
    for (const session of [...sessions.values()]) {
      if (session.owner === owner) close(session.id, owner);
    }
  }

  /** Kills every shell and its children before Draggy exits. */
  function stopAll() {
    for (const session of [...sessions.values()]) {
      session.closed = true;
      killPty(session.terminal, true);
    }
    sessions.clear();
  }

  return { open, write, resize, close, closeOwner, stopAll, count: () => sessions.size };
}

module.exports = { createShellHost, createSanitizer, filterEnv, interactiveArgs, MAX_SESSIONS, MAX_WRITE_CHARS };
