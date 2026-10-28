import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createTaskManager } = require("./tasks.cjs");

/** A pseudo-terminal that does what the test tells it to. */
function fakePty() {
  const pty = {
    written: [],
    killed: false,
    dataListener: () => {},
    exitListener: () => {},
    write: (data) => pty.written.push(data),
    resize: (cols, rows) => (pty.size = [cols, rows]),
    onData: (listener) => (pty.dataListener = listener),
    onExit: (listener) => (pty.exitListener = listener),
    print: (text) => pty.dataListener(text),
    exit: (exitCode = 0) => pty.exitListener({ exitCode, signal: 0 }),
  };
  return pty;
}

let folder;
let ptys;
let events;
let tasks;

function manager(extra = {}) {
  return createTaskManager({
    logDir: path.join(folder, "logs"),
    onEvent: (event) => events.push(event),
    ptyAvailableImpl: () => true,
    spawnPtyImpl: () => {
      const pty = fakePty();
      ptys.push(pty);
      return pty;
    },
    killPtyImpl: (pty) => {
      pty.killed = true;
      pty.exit(1);
    },
    ...extra,
  });
}

const base = () => ({ chatId: "c1", cwd: folder, command: "npm run dev" });

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-tasks-"));
  ptys = [];
  events = [];
  tasks = manager();
});

afterEach(() => {
  tasks.stopAll();
  fs.rmSync(folder, { recursive: true, force: true });
});

describe("starting", () => {
  it("starts a task on a pseudo-terminal and numbers it within its chat", () => {
    const first = tasks.start(base());
    const second = tasks.start({ ...base(), command: "npm test" });
    const other = tasks.start({ ...base(), chatId: "c2" });

    expect(first.task).toMatchObject({ id: "t1", mode: "pty", status: "running", canInput: true });
    expect(second.task.id).toBe("t2");
    expect(other.task.id).toBe("t1");
    expect(events.filter((event) => event.type === "started")).toHaveLength(3);
  });

  it("refuses an empty command and a missing folder", () => {
    expect(tasks.start({ ...base(), command: "  " }).error).toMatch(/No command/);
    expect(tasks.start({ ...base(), cwd: path.join(folder, "gone") }).error).toMatch(/folder/);
  });

  it("allows five running tasks per chat and names them when the sixth is refused", () => {
    for (let i = 0; i < 5; i += 1) expect(tasks.start({ ...base(), command: `job ${i}` }).task).toBeTruthy();
    const refused = tasks.start({ ...base(), command: "job 5" });

    expect(refused.error).toMatch(/5 background tasks/);
    expect(refused.error).toMatch(/job 0/);
    expect(tasks.start({ ...base(), chatId: "c2" }).task).toBeTruthy();
  });

  it("frees a slot when a task ends", () => {
    for (let i = 0; i < 5; i += 1) tasks.start({ ...base(), command: `job ${i}` });
    ptys[0].exit(0);
    expect(tasks.start({ ...base(), command: "job 5" }).task).toBeTruthy();
  });

  it("falls back to pipes when no pseudo-terminal is available", () => {
    const streams = [];
    const piped = manager({
      ptyAvailableImpl: () => false,
      spawnStreamImpl: (_spec, handlers) => {
        const stream = { kill: () => handlers.onExit({ code: null, signal: "SIGTERM" }), handlers };
        streams.push(stream);
        return stream;
      },
    });
    const { task } = piped.start(base());
    streams[0].handlers.onStdout("hello\n");

    expect(task).toMatchObject({ mode: "pipe", canInput: false });
    expect(piped.write("c1", "t1", "x").error).toMatch(/cannot take input/);
    expect(piped.output("c1", "t1").output).toBe("hello\n");
    piped.stopAll();
  });
});

describe("output", () => {
  it("returns only new output on each read and keeps a cursor", () => {
    tasks.start(base());
    ptys[0].print("one\ntwo\n");
    const first = tasks.output("c1", "t1");
    ptys[0].print("three\n");
    const second = tasks.output("c1", "t1");
    const third = tasks.output("c1", "t1");

    expect(first.output).toBe("one\ntwo\n");
    expect(second.output).toBe("three\n");
    expect(third.output).toBe("");
    expect(second.next).toBe(14);
  });

  it("reads from an explicit offset without moving the cursor", () => {
    tasks.start(base());
    ptys[0].print("abcdef");
    expect(tasks.output("c1", "t1", { since: 3 }).output).toBe("def");
    expect(tasks.output("c1", "t1").output).toBe("abcdef");
  });

  it("returns the last lines or the matching lines", () => {
    tasks.start(base());
    ptys[0].print("a\nERROR b\nc\nERROR d\ne\n");

    expect(tasks.output("c1", "t1", { tail: 2 }).output).toBe("ERROR d\ne");
    expect(tasks.output("c1", "t1", { grep: "error" }).output).toBe("2: ERROR b\n4: ERROR d");
    expect(tasks.output("c1", "t1", { grep: "(" }).error).toMatch(/regular expression/);
  });

  it("strips color codes and folds repeated lines", () => {
    tasks.start(base());
    ptys[0].print("\u001b[32mok\u001b[0m\nwait\nwait\nwait\nwait\n");
    expect(tasks.output("c1", "t1").output).toBe("ok\nwait (x4)\n");
  });

  it("clips a long output and points at the full log", () => {
    tasks.start(base());
    ptys[0].print("x".repeat(60_000));
    const read = tasks.output("c1", "t1");

    expect(read.truncated).toBe(true);
    expect(read.output).toMatch(/Full log: task t1/);
    expect(read.output.length).toBeLessThan(31_000);
  });

  it("writes the whole output to a log file", () => {
    tasks.start(base());
    ptys[0].print("hello\n");
    const log = fs.readdirSync(path.join(folder, "logs"));
    expect(log).toHaveLength(1);
    expect(fs.readFileSync(path.join(folder, "logs", log[0]), "utf8")).toBe("hello\n");
  });

  it("says so for an unknown task", () => {
    expect(tasks.output("c1", "t9").error).toMatch(/no task t9/);
    expect(tasks.output("c2", "t1").error).toMatch(/no task/);
  });
});

describe("ending", () => {
  it("marks exit 0 as exited and other codes as failed", () => {
    tasks.start(base());
    tasks.start(base());
    ptys[0].exit(0);
    ptys[1].exit(2);

    const [a, b] = tasks.list("c1");
    expect(a).toMatchObject({ status: "exited", exitCode: 0, canInput: false });
    expect(b).toMatchObject({ status: "failed", exitCode: 2 });
  });

  it("reports an ended task once through the inbox, with the end of its output", () => {
    tasks.start(base());
    ptys[0].print(Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"));
    ptys[0].exit(1);

    const items = tasks.takeInbox("c1");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "t1", status: "failed", exitCode: 1, command: "npm run dev" });
    expect(items[0].tail.split("\n")).toHaveLength(20);
    expect(items[0].tail).toMatch(/line 39$/);
    expect(tasks.takeInbox("c1")).toEqual([]);
  });

  it("announces the end with a wake flag", () => {
    tasks.start(base());
    ptys[0].exit(0);
    expect(events.find((event) => event.type === "ended")).toMatchObject({ chatId: "c1", wake: true });
  });

  it("does not report or wake for a task the user or the model stopped", () => {
    tasks.start(base());
    const stopped = tasks.stop("c1", "t1");
    expect(stopped.task.id).toBe("t1");

    expect(tasks.list("c1")[0]).toMatchObject({ status: "stopped" });
    expect(tasks.takeInbox("c1")).toEqual([]);
    expect(events.find((event) => event.type === "ended")).toMatchObject({ wake: false });
    expect(ptys[0].killed).toBe(true);
  });

  it("stopping an ended task says it had ended", () => {
    tasks.start(base());
    ptys[0].exit(0);
    expect(tasks.stop("c1", "t1").alreadyEnded).toBe(true);
  });

  it("ignores a second exit", () => {
    tasks.start(base());
    ptys[0].exit(0);
    ptys[0].exit(5);
    expect(tasks.list("c1")[0].exitCode).toBe(0);
    expect(tasks.takeInbox("c1")).toHaveLength(1);
  });
});

describe("waiting", () => {
  it("resolves when the task ends", async () => {
    tasks.start(base());
    const waiting = tasks.wait("c1", "t1", { seconds: 5 });
    ptys[0].exit(0);
    expect(await waiting).toMatchObject({ reason: "ended", task: { status: "exited" } });
  });

  it("resolves when new output matches", async () => {
    tasks.start(base());
    ptys[0].print("Ready on port 1\n");
    const waiting = tasks.wait("c1", "t1", { seconds: 5, until: "ready on port 3000" });
    ptys[0].print("Ready on port 3000\n");
    expect((await waiting).reason).toBe("matched");
  });

  it("ignores output from before the wait began", async () => {
    tasks.start(base());
    ptys[0].print("ready\n");
    const waiting = tasks.wait("c1", "t1", { seconds: 1, until: "ready" });
    ptys[0].exit(0);
    expect((await waiting).reason).toBe("ended");
  });

  it("times out while the task keeps running", async () => {
    tasks.start(base());
    const result = await tasks.wait("c1", "t1", { seconds: 1 });
    expect(result).toMatchObject({ reason: "timeout", task: { status: "running" } });
  });

  it("can be cancelled", async () => {
    tasks.start(base());
    const controller = new AbortController();
    const waiting = tasks.wait("c1", "t1", { seconds: 60, signal: controller.signal });
    controller.abort();
    expect((await waiting).reason).toBe("aborted");
  });

  it("returns at once for a task that already ended", async () => {
    tasks.start(base());
    ptys[0].exit(0);
    expect((await tasks.wait("c1", "t1", { seconds: 60 })).reason).toBe("ended");
  });
});

describe("typing", () => {
  it("passes input and resizes", () => {
    tasks.start(base());
    expect(tasks.write("c1", "t1", "y\r").task).toBeTruthy();
    expect(ptys[0].written).toEqual(["y\r"]);
    expect(tasks.resize("c1/t1", 100, 40)).toBe(true);
    expect(ptys[0].size).toEqual([100, 40]);
  });

  it("refuses input once the task has ended", () => {
    tasks.start(base());
    ptys[0].exit(0);
    expect(tasks.write("c1", "t1", "y").error).toMatch(/already ended/);
  });

  it("hands the terminal output to a pane that attaches", () => {
    tasks.start(base());
    ptys[0].print("\u001b[2Jhi");
    expect(tasks.snapshot("c1/t1").data).toBe("\u001b[2Jhi");
    expect(tasks.snapshot("c1/nope")).toBeNull();
  });
});

describe("adopting a running command", () => {
  it("takes the output so far and everything after it", () => {
    let killed = false;
    const adopted = tasks.adopt({ chatId: "c1", command: "npm run build", shell: "bash", cwd: folder, output: "step 1\n", kill: () => (killed = true) });

    expect(adopted.task).toMatchObject({ id: "t1", mode: "adopted", canInput: false });
    adopted.push("step 2\n");
    expect(tasks.output("c1", "t1").output).toBe("step 1\nstep 2\n");
    adopted.exit({ code: 0, signal: null, error: null });
    expect(tasks.list("c1")[0].status).toBe("exited");
    expect(tasks.takeInbox("c1")).toHaveLength(1);

    tasks.adopt({ chatId: "c1", command: "x", shell: "bash", cwd: folder, output: "", kill: () => (killed = true) });
    tasks.stop("c1", "t2");
    expect(killed).toBe(true);
  });

  it("counts toward the limit", () => {
    for (let i = 0; i < 5; i += 1) tasks.adopt({ chatId: "c1", command: `j${i}`, shell: "bash", cwd: folder, output: "", kill: () => {} });
    expect(tasks.adopt({ chatId: "c1", command: "j5", shell: "bash", cwd: folder, output: "", kill: () => {} }).error).toMatch(/5 background tasks/);
  });
});

describe("cleaning up", () => {
  it("kills every running task and removes the logs on quit", () => {
    tasks.start(base());
    tasks.start({ ...base(), chatId: "c2" });
    tasks.stopAll();

    expect(ptys.every((pty) => pty.killed)).toBe(true);
    expect(fs.existsSync(path.join(folder, "logs"))).toBe(false);
  });

  it("forgets the finished tasks of a deleted chat and keeps running ones", () => {
    tasks.start(base());
    tasks.start(base());
    ptys[0].exit(0);
    tasks.forget("c1");

    expect(tasks.list("c1").map((task) => task.id)).toEqual(["t2"]);
    expect(tasks.takeInbox("c1")).toEqual([]);
  });

  it("reports whether a chat has anything running", () => {
    expect(tasks.hasRunning("c1")).toBe(false);
    tasks.start(base());
    expect(tasks.hasRunning("c1")).toBe(true);
    ptys[0].exit(0);
    expect(tasks.hasRunning("c1")).toBe(false);
  });
});
