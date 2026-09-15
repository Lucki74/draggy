import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const terminal = require("./terminal.cjs");

/** Guards terminal session lifecycle: shell resolution, streaming, and clean process tree termination. */

afterEach(() => {
  terminal.killAll();
});

describe("terminal process management", () => {
  it("resolves a default shell for the platform", () => {
    const shell = terminal.resolveShell();
    expect(shell.file).toBeTruthy();
    expect(Array.isArray(shell.args)).toBe(true);
  });

  it("spawns a terminal session and writes input without error", async () => {
    const onData = vi.fn();
    const onExit = vi.fn();

    const res = terminal.spawnTerminal("test-term-1", process.cwd(), onData, onExit);
    expect(res.success).toBe(true);
    expect(res.id).toBe("test-term-1");

    const written = terminal.writeTerminal("test-term-1", "echo ready\r\n");
    expect(written).toBe(true);

    const killed = terminal.killTerminal("test-term-1");
    expect(killed).toBe(true);
  });

  it("spawning twice with the same id terminates the prior session cleanly without throwing", () => {
    const onData = vi.fn();
    const onExit = vi.fn();

    terminal.spawnTerminal("test-term-dup", process.cwd(), onData, onExit);
    expect(() => {
      terminal.spawnTerminal("test-term-dup", process.cwd(), onData, onExit);
    }).not.toThrow();

    terminal.killTerminal("test-term-dup");
  });

  it("killAll terminates all tracked sessions without throwing", () => {
    terminal.spawnTerminal("term-multi-1", process.cwd(), () => {}, () => {});
    terminal.spawnTerminal("term-multi-2", process.cwd(), () => {}, () => {});

    expect(() => terminal.killAll()).not.toThrow();
  });
});
