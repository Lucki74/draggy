const fs = require("fs");
const path = require("path");
const { shellInvocation } = require("./shells.cjs");
const { buildEnv, spawnStream } = require("./exec.cjs");
const { spawnPty, killPty, ptyAvailable } = require("./platform.cjs");
const { log } = require("./logger.cjs");
const text = require("./taskText.cjs");

/** Background tasks: commands that keep running while the model works on something else. A task is
 * started in the background, or a foreground command is handed over when it outlasts its timeout or
 * the user sends it away. The model reads them with task_output and ends them with task_stop; the
 * user sees them in the terminal pane and can type into one that runs on a pseudo-terminal. */

const MAX_RUNNING_PER_CHAT = 5;
/** Output kept in memory per task. Older output stays in the log file. */
const RING_CHARS = 1_000_000;
const LOG_CAP_CHARS = 50_000_000;
const SNAPSHOT_CHARS = 100_000;
const INBOX_TAIL_LINES = 20;
const MAX_WAIT_SECONDS = 120;
const MAX_COMMAND_CHARS = 8_000;

const WRITE_FAILED = "Nothing could be sent: ";

function createTaskManager({
  logDir = null,
  onEvent = () => {},
  spawnPtyImpl = spawnPty,
  spawnStreamImpl = spawnStream,
  ptyAvailableImpl = ptyAvailable,
  killPtyImpl = killPty,
  now = Date.now,
} = {}) {
  /** Every task by uid (`chat/id`), and the counters that mint per-chat ids. */
  const tasks = new Map();
  const counters = new Map();
  const inboxes = new Map();
  let logReady = false;

  const emit = (event) => {
    try {
      onEvent(event);
    } catch (error) {
      log.swallow("proc.task", error, "a listener failed; the task goes on");
    }
  };

  function ensureLogDir() {
    if (!logDir) return false;
    if (logReady) return true;
    try {
      fs.mkdirSync(logDir, { recursive: true });
      logReady = true;
    } catch (error) {
      log.swallow("proc.task", error, "no log folder; the in-memory output still works");
    }
    return logReady;
  }

  function nextId(chatId) {
    const n = (counters.get(chatId) || 0) + 1;
    counters.set(chatId, n);
    return `t${n}`;
  }

  const running = (chatId) => [...tasks.values()].filter((task) => task.chatId === chatId && task.status === "running");

  function summary(task) {
    const lines = text.cleanOutput(task.ring).trimEnd().split("\n");
    return {
      uid: task.uid,
      id: task.id,
      chatId: task.chatId,
      command: task.command,
      shell: task.shell,
      mode: task.mode,
      status: task.status,
      exitCode: task.exitCode,
      signal: task.signal,
      startedAt: task.startedAt,
      endedAt: task.endedAt,
      canInput: task.status === "running" && task.mode === "pty",
      lastLine: lines[lines.length - 1] || "",
      error: task.error || null,
    };
  }

  function capError(chatId) {
    const live = running(chatId);
    const listed = live.map((task) => `${task.id} (${task.command})`).join(", ");
    return `This chat already has ${MAX_RUNNING_PER_CHAT} background tasks running: ${listed}. Stop one with task_stop first.`;
  }

  function append(task, chunk) {
    const piece = String(chunk);
    if (!piece) return;
    task.ring += piece;
    task.total += piece.length;
    if (task.ring.length > RING_CHARS) {
      const drop = task.ring.length - RING_CHARS;
      task.ring = task.ring.slice(drop);
      task.base += drop;
    }
    if (task.logPath && task.logged < LOG_CAP_CHARS) {
      try {
        fs.appendFileSync(task.logPath, piece);
        task.logged += piece.length;
      } catch (error) {
        log.swallow("proc.task", error, "the log file failed; the in-memory output still works");
        task.logPath = null;
      }
    }
    emit({ type: "output", chatId: task.chatId, uid: task.uid, chunk: piece });
    settleWaiters(task);
  }

  function settleWaiters(task) {
    for (const waiter of [...task.waiters]) waiter.check();
  }

  function finish(task, { code = null, signal = null, error = null }) {
    if (task.status !== "running") return;
    task.exitCode = code;
    task.signal = signal;
    task.endedAt = now();
    task.error = error;
    if (task.stopRequested) task.status = "stopped";
    else task.status = !error && code === 0 ? "exited" : "failed";
    task.handle = null;
    log.info("proc.task", "task ended", { status: task.status, exitCode: code, durationMs: task.endedAt - task.startedAt });

    const inbox = inboxes.get(task.chatId) || [];
    if (!task.stopRequested) {
      inbox.push({
        uid: task.uid,
        id: task.id,
        command: task.command,
        status: task.status,
        exitCode: code,
        durationMs: task.endedAt - task.startedAt,
        tail: text.tailLines(text.cleanOutput(task.ring).trimEnd(), INBOX_TAIL_LINES),
      });
      inboxes.set(task.chatId, inbox);
    }
    emit({ type: "ended", chatId: task.chatId, task: summary(task), wake: !task.stopRequested });
    settleWaiters(task);
  }

  function register({ chatId, command, shell, mode, handle, cwd }) {
    const id = nextId(chatId);
    const uid = `${chatId}/${id}`;
    const logPath = ensureLogDir() ? path.join(logDir, `${uid.replace(/[^\w.-]/g, "_")}.log`) : null;
    if (logPath) {
      try {
        fs.writeFileSync(logPath, "");
      } catch (error) {
        log.swallow("proc.task", error, "no log file for this task");
      }
    }
    const task = {
      uid,
      id,
      chatId,
      command,
      shell,
      mode,
      cwd,
      handle,
      status: "running",
      exitCode: null,
      signal: null,
      error: null,
      stopRequested: false,
      startedAt: now(),
      endedAt: null,
      ring: "",
      base: 0,
      total: 0,
      logPath,
      logged: 0,
      cursor: 0,
      waiters: [],
    };
    tasks.set(uid, task);
    return task;
  }

  /** Starts a command in the background. Resolves with the task, or an error the model can act on. */
  function start({ chatId, cwd, command, shell, defaultShell, env, cols = 120, rows = 30 }) {
    const line = String(command || "");
    if (!line.trim()) return { error: "No command was given." };
    if (line.length > MAX_COMMAND_CHARS) return { error: "That command is too long to run." };
    if (!cwd || !fs.existsSync(cwd)) return { error: "The project folder is not available." };
    if (running(chatId).length >= MAX_RUNNING_PER_CHAT) return { error: capError(chatId) };

    const invocation = shellInvocation(line, shell, { defaultShell });
    if (invocation.error) return { error: invocation.error };

    const usePty = ptyAvailableImpl();
    const task = register({ chatId, command: line, shell: invocation.shell, mode: usePty ? "pty" : "pipe", handle: null, cwd });
    const childEnv = buildEnv({ ...invocation.env, ...(env || {}), ...(usePty ? { TERM: "xterm-256color" } : {}) });
    log.info("proc.task", "task starting", { shell: invocation.shell, mode: task.mode, chars: line.length });

    try {
      if (usePty) {
        const pty = spawnPtyImpl(invocation.file, invocation.args, { cwd, env: childEnv, cols, rows });
        task.handle = {
          write: (data) => pty.write(data),
          resize: (c, r) => pty.resize(c, r),
          kill: () => killPtyImpl(pty),
          killSync: () => killPtyImpl(pty, true),
        };
        pty.onData((data) => append(task, data));
        pty.onExit(({ exitCode, signal }) => finish(task, { code: exitCode ?? null, signal: signal || null }));
      } else {
        const stream = spawnStreamImpl(
          { file: invocation.file, args: invocation.args, cwd, env: childEnv, verbatim: invocation.verbatim },
          {
            onStdout: (chunk) => append(task, chunk),
            onStderr: (chunk) => append(task, chunk),
            onExit: ({ code, signal, error }) => finish(task, { code, signal: signal || null, error: error ? error.message : null }),
          },
        );
        task.handle = { write: null, resize: null, kill: () => stream.kill(), killSync: () => stream.kill() };
      }
    } catch (error) {
      log.warn("proc.task", "task failed to start", { name: error?.name ?? null });
      finish(task, { error: error.message });
      return { task: summary(task), notice: invocation.notice };
    }

    emit({ type: "started", chatId, task: summary(task) });
    return { task: summary(task), notice: invocation.notice };
  }

  /** Takes over a foreground command that is already running. `output` is what it printed so far; the
   * caller keeps feeding the returned `push` and calls `exit` when the process ends. It has no PTY, so
   * nothing can be typed into it. */
  function adopt({ chatId, command, shell, cwd, output, kill }) {
    if (running(chatId).length >= MAX_RUNNING_PER_CHAT) return { error: capError(chatId) };
    const task = register({ chatId, command, shell, mode: "adopted", handle: null, cwd });
    task.handle = { write: null, resize: null, kill, killSync: kill };
    append(task, output || "");
    emit({ type: "started", chatId, task: summary(task) });
    return {
      task: summary(task),
      push: (chunk) => append(task, chunk),
      exit: (result) => finish(task, result),
    };
  }

  /** Looks a task up by the id the model uses (`t2`) within its chat, or by uid. */
  function find(chatId, idOrUid) {
    const key = String(idOrUid || "").trim();
    return tasks.get(key) || tasks.get(`${chatId}/${key}`) || null;
  }

  const unknown = (id) => ({ error: `There is no task ${id} in this chat. Use task_list to see them.` });

  function list(chatId) {
    return [...tasks.values()].filter((task) => task.chatId === chatId).map(summary);
  }

  function rawFrom(task, from) {
    if (from >= task.base) return { raw: task.ring.slice(from - task.base), note: "" };
    // The start fell out of memory; the log file still has it.
    if (task.logPath) {
      try {
        const all = fs.readFileSync(task.logPath, "utf8");
        return { raw: all.slice(from), note: "" };
      } catch (error) {
        log.swallow("proc.task", error, "the log is unreadable; the in-memory part is returned");
      }
    }
    return { raw: task.ring, note: "[earlier output is no longer available]\n" };
  }

  /** What the model asked to read: new output by default, or an explicit offset, the last lines, or the
   * lines matching a pattern. */
  function output(chatId, id, options = {}) {
    const task = find(chatId, id);
    if (!task) return unknown(id);

    const total = task.total;
    let body;
    let note = "";
    if (options.grep) {
      const { raw, note: gone } = rawFrom(task, 0);
      const found = text.grepLines(text.cleanOutput(raw), String(options.grep));
      if (found.error) return { error: found.error };
      body = found.text || "(no matching lines)";
      note = gone;
    } else if (options.tail) {
      const { raw, note: gone } = rawFrom(task, 0);
      body = text.tailLines(text.cleanOutput(raw).trimEnd(), Number(options.tail) || 50);
      note = gone;
    } else {
      const explicit = Number.isFinite(Number(options.since)) && options.since !== undefined && options.since !== null;
      const from = explicit ? Number(options.since) : task.cursor;
      const { raw, note: gone } = rawFrom(task, Math.min(Math.max(0, Math.floor(from)), total));
      body = text.cleanOutput(raw);
      note = gone;
      if (!explicit) task.cursor = total;
    }

    const max = Number(options.max_chars);
    const clipped = Number.isFinite(max) && max > 0 && body.length > max ? { text: body.slice(-max), truncated: true } : text.clipWithPointer(body, task.id);
    return {
      task: summary(task),
      output: note + clipped.text,
      truncated: clipped.truncated,
      next: total,
    };
  }

  /** Waits for a task to end, for a pattern to appear in new output, or for the time to pass. */
  function wait(chatId, id, { seconds = 30, until, signal } = {}) {
    const task = find(chatId, id);
    if (!task) return Promise.resolve(unknown(id));

    let pattern = null;
    if (until) {
      try {
        pattern = new RegExp(String(until), "i");
      } catch {
        return Promise.resolve({ error: "That pattern is not a valid regular expression." });
      }
    }
    const limit = Math.min(Math.max(Number(seconds) || 30, 1), MAX_WAIT_SECONDS) * 1000;
    const startTotal = task.total;

    return new Promise((resolve) => {
      let timer = null;
      const waiter = { check: () => {} };
      const done = (reason) => {
        clearTimeout(timer);
        task.waiters = task.waiters.filter((entry) => entry !== waiter);
        signal?.removeEventListener("abort", onAbort);
        resolve({ reason, task: summary(task) });
      };
      const onAbort = () => done("aborted");
      waiter.check = () => {
        if (task.status !== "running") return done("ended");
        if (pattern) {
          const fresh = text.cleanOutput(rawFrom(task, Math.max(startTotal, task.base)).raw);
          if (pattern.test(fresh)) done("matched");
        }
      };
      if (signal?.aborted) return done("aborted");
      task.waiters.push(waiter);
      timer = setTimeout(() => done("timeout"), limit);
      signal?.addEventListener("abort", onAbort, { once: true });
      waiter.check();
    });
  }

  function stop(chatId, id) {
    const task = find(chatId, id);
    if (!task) return unknown(id);
    if (task.status !== "running") return { task: summary(task), alreadyEnded: true };
    task.stopRequested = true;
    task.handle?.kill();
    return { task: summary(task) };
  }

  /** Types into a task. The model's text and the user's keystrokes both come through here. */
  function write(chatId, id, data) {
    const task = find(chatId, id);
    if (!task) return unknown(id);
    if (task.status !== "running") return { error: `Task ${task.id} has already ended.` };
    if (!task.handle?.write) return { error: `Task ${task.id} cannot take input: it was not started on a terminal.` };
    try {
      task.handle.write(String(data));
    } catch (error) {
      return { error: WRITE_FAILED + error.message };
    }
    return { task: summary(task) };
  }

  function resize(uid, cols, rows) {
    const task = tasks.get(String(uid));
    if (!task?.handle?.resize) return false;
    try {
      task.handle.resize(Math.max(2, cols | 0), Math.max(2, rows | 0));
      return true;
    } catch (error) {
      log.swallow("proc.task", error, "the terminal is gone");
      return false;
    }
  }

  /** The recent output as the terminal printed it, for a pane attaching to a running task. */
  function snapshot(uid) {
    const task = tasks.get(String(uid));
    if (!task) return null;
    return { task: summary(task), data: task.ring.slice(-SNAPSHOT_CHARS) };
  }

  /** What ended since the model last looked, each reported once. */
  function takeInbox(chatId) {
    const items = inboxes.get(chatId) || [];
    inboxes.delete(chatId);
    return items;
  }

  function hasRunning(chatId) {
    return running(chatId).length > 0;
  }

  /** Ends every task and removes their logs, synchronously, for a quit. */
  function stopAll() {
    log.info("proc.task", "stopping tasks", { running: [...tasks.values()].filter((task) => task.status === "running").length });
    for (const task of tasks.values()) {
      if (task.status !== "running") continue;
      task.stopRequested = true;
      try {
        task.handle?.killSync();
      } catch (error) {
        log.swallow("proc.task", error, "the task is already gone");
      }
    }
    if (logDir) {
      try {
        fs.rmSync(logDir, { recursive: true, force: true });
      } catch (error) {
        log.swallow("proc.task", error, "the log folder could not be removed");
      }
    }
  }

  /** Forgets finished tasks of a chat that was deleted. */
  function forget(chatId) {
    for (const [uid, task] of [...tasks]) {
      if (task.chatId !== chatId || task.status === "running") continue;
      if (task.logPath) fs.rmSync(task.logPath, { force: true });
      tasks.delete(uid);
    }
    inboxes.delete(chatId);
  }

  return { start, adopt, list, output, wait, stop, write, resize, snapshot, takeInbox, hasRunning, stopAll, forget, find, MAX_RUNNING_PER_CHAT };
}

module.exports = { createTaskManager, MAX_RUNNING_PER_CHAT, MAX_WAIT_SECONDS };
