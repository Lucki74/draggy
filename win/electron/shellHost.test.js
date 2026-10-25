import { createRequire } from "node:module";
import os from "node:os";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createShellHost, createSanitizer, filterEnv, MAX_SESSIONS } = require("./shellHost.cjs");
const platform = require("./platform.cjs");

/** Interactive shells: what the renderer may do, what it is shielded from, and that nothing outlives the app. */

function fakePty() {
  const made = [];
  const spawnPty = (file, args, options) => {
    const handlers = { data: [], exit: [] };
    const terminal = {
      pid: 4000 + made.length,
      file,
      args,
      options,
      written: [],
      resized: null,
      killed: false,
      onData: (fn) => handlers.data.push(fn),
      onExit: (fn) => handlers.exit.push(fn),
      write: (text) => terminal.written.push(text),
      resize: (cols, rows) => (terminal.resized = [cols, rows]),
      kill: () => (terminal.killed = true),
      emit: (text) => handlers.data.forEach((fn) => fn(text)),
      exit: (exitCode) => handlers.exit.forEach((fn) => fn({ exitCode })),
    };
    made.push(terminal);
    return terminal;
  };
  const killed = [];
  const killPty = (terminal, sync) => {
    terminal.killed = true;
    killed.push({ terminal, sync });
  };
  return { made, killed, spawnPty, killPty };
}

const host = (fake, extra = {}) =>
  createShellHost({
    spawnPty: fake.spawnPty,
    killPty: fake.killPty,
    baseEnv: { PATH: "/bin", OPENAI_API_KEY: "sk-secret", HOME: "/home/x" },
    invocation: { platform: "win32", find: (name) => (name === "bash" ? "/fake/bash" : null), ...extra },
  });

const WINDOW = 7;

describe("opening a terminal", () => {
  it("mints the id itself and starts an interactive shell in the folder", () => {
    const fake = fakePty();
    const result = host(fake).open({ owner: WINDOW, cwd: os.tmpdir(), shell: "bash", cols: 100, rows: 30 });

    expect(result.success).toBe(true);
    expect(result.id).toMatch(/^pty-[0-9a-f]{16}$/);
    expect(fake.made[0]).toMatchObject({ file: "/fake/bash", args: ["--login", "-i"] });
    expect(fake.made[0].options).toMatchObject({ cwd: os.tmpdir(), cols: 100, rows: 30 });
  });

  it("keeps credentials out of the shell's environment", () => {
    const fake = fakePty();
    host(fake).open({ owner: WINDOW, cwd: os.tmpdir(), shell: "bash" });

    const env = fake.made[0].options.env;
    expect(env.PATH).toBe("/bin");
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.TERM).toBe("xterm-256color");
  });

  it("filters names that hold a secret and keeps the rest", () => {
    const kept = filterEnv({ GITHUB_TOKEN: "x", MY_SECRET: "x", DB_PASSWORD: "x", ANTHROPIC_KEY: "x", PATH: "p", AUTHOR: "me" });
    expect(Object.keys(kept).sort()).toEqual(["AUTHOR", "PATH"]);
  });

  it("limits how many terminals are open", () => {
    const fake = fakePty();
    const terminals = host(fake);
    for (let index = 0; index < MAX_SESSIONS; index += 1) {
      expect(terminals.open({ owner: WINDOW, cwd: os.tmpdir(), shell: "bash" }).success).toBe(true);
    }
    expect(terminals.open({ owner: WINDOW, cwd: os.tmpdir(), shell: "bash" }).success).toBe(false);
  });

  it("says so when the shell asked for is not installed", () => {
    const result = host(fakePty()).open({ owner: WINDOW, cwd: os.tmpdir(), shell: "pwsh" });
    expect(result).toMatchObject({ success: false });
    expect(result.error).toMatch(/not installed/);
  });
});

describe("using a terminal", () => {
  const opened = () => {
    const fake = fakePty();
    const terminals = host(fake);
    const output = [];
    const exits = [];
    const { id } = terminals.open({
      owner: WINDOW,
      cwd: os.tmpdir(),
      shell: "bash",
      onData: (sessionId, data) => output.push([sessionId, data]),
      onExit: (sessionId, code) => exits.push([sessionId, code]),
    });
    return { fake, terminals, id, output, exits };
  };

  it("passes output on with the session id and reports the exit once", () => {
    const { fake, id, output, exits } = opened();
    fake.made[0].emit("hello");
    fake.made[0].exit(0);
    fake.made[0].exit(0);

    expect(output).toEqual([[id, "hello"]]);
    expect(exits).toEqual([[id, 0]]);
  });

  it("writes and resizes only for the window that opened it", () => {
    const { fake, terminals, id } = opened();

    expect(terminals.write(id, 99, "rm -rf /")).toBe(false);
    expect(terminals.resize(id, 99, 10, 10)).toBe(false);
    expect(terminals.close(id, 99)).toBe(false);
    expect(terminals.write(id, WINDOW, "ls\r")).toBe(true);
    expect(terminals.resize(id, WINDOW, 120, 40)).toBe(true);

    expect(fake.made[0].written).toEqual(["ls\r"]);
    expect(fake.made[0].resized).toEqual([120, 40]);
    expect(fake.made[0].killed).toBe(false);
  });

  it("refuses non-text and oversized input and unknown ids", () => {
    const { terminals, id } = opened();
    expect(terminals.write(id, WINDOW, { not: "text" })).toBe(false);
    expect(terminals.write(id, WINDOW, "x".repeat(70000))).toBe(false);
    expect(terminals.write("pty-nope", WINDOW, "ls")).toBe(false);
  });

  it("closes one terminal, and all of a window's when it goes away", () => {
    const { fake, terminals, id } = opened();
    terminals.open({ owner: WINDOW, cwd: os.tmpdir(), shell: "bash" });
    terminals.open({ owner: 8, cwd: os.tmpdir(), shell: "bash" });

    expect(terminals.close(id, WINDOW)).toBe(true);
    expect(fake.made[0].killed).toBe(true);
    terminals.closeOwner(WINDOW);
    expect(fake.made.map((terminal) => terminal.killed)).toEqual([true, true, false]);
    expect(terminals.count()).toBe(1);
  });

  it("kills every shell on the way out, synchronously", () => {
    const { fake, terminals } = opened();
    terminals.open({ owner: 8, cwd: os.tmpdir(), shell: "bash" });
    terminals.stopAll();

    expect(fake.killed.every((entry) => entry.sync === true)).toBe(true);
    expect(fake.made.every((terminal) => terminal.killed)).toBe(true);
    expect(terminals.count()).toBe(0);
  });
});

describe("what a program may print", () => {
  const ESC = "\u001b";
  const BEL = "\u0007";

  it("passes colours, cursor moves and hyperlinks", () => {
    const sanitize = createSanitizer();
    const text = `${ESC}[31mred${ESC}[0m${ESC}[2J${ESC}]8;;https://example.com${BEL}link${ESC}]8;;${BEL}`;
    expect(sanitize(text)).toBe(text);
  });

  it("drops clipboard writes, window titles and other OSC strings", () => {
    const sanitize = createSanitizer();
    expect(sanitize(`a${ESC}]52;c;aGVsbG8=${BEL}b`)).toBe("ab");
    expect(sanitize(`a${ESC}]0;evil title${ESC}\\b`)).toBe("ab");
    expect(sanitize(`a${ESC}]2;title${BEL}b`)).toBe("ab");
    expect(sanitize(`a${ESC}]1337;File=x${BEL}b`)).toBe("ab");
  });

  it("drops device strings and 8-bit controls", () => {
    const sanitize = createSanitizer();
    expect(sanitize(`a${ESC}Pq data${ESC}\\b`)).toBe("ab");
    expect(sanitize(`a${ESC}_app data${ESC}\\b`)).toBe("ab");
    expect(sanitize("a\u009d52;c;x\u0007b")).toBe("a52;c;x\u0007b");
  });

  it("holds a sequence split between two chunks until it ends", () => {
    const sanitize = createSanitizer();
    expect(sanitize(`a${ESC}]52;c;aGVs`)).toBe("a");
    expect(sanitize(`bG8=${BEL}b`)).toBe("b");
    expect(sanitize(`x${ESC}`)).toBe("x");
    expect(sanitize("[31my")).toBe(`${ESC}[31my`);
  });

  it("does not hold an endless string forever", () => {
    const sanitize = createSanitizer();
    sanitize(`${ESC}]52;${"x".repeat(9000)}`);
    expect(sanitize("plain")).toBe("plain");
  });
});

describe.skipIf(process.platform !== "win32" || !platform.ptyAvailable())("a real terminal", () => {
  it("runs a command and reports its exit", async () => {
    const terminals = createShellHost();
    let output = "";
    const done = new Promise((resolve) => {
      const result = terminals.open({
        owner: WINDOW,
        cwd: os.tmpdir(),
        shell: "cmd",
        onData: (id, data) => {
          output += data;
          if (/draggy-ok/.test(output.replace(/echo draggy-ok/g, ""))) resolve(id);
        },
      });
      expect(result.success).toBe(true);
      setTimeout(() => terminals.write(result.id, WINDOW, "echo draggy-ok\r"), 500);
    });

    await done;
    terminals.stopAll();
    expect(terminals.count()).toBe(0);
  }, 20000);
});
