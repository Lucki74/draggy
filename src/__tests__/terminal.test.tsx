// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import Terminal from "../terminal/Terminal";

/** Exercises the interactive Terminal component: process spawning, input sending, and killing. */

const t = (key: string) => key;

let dataCallback: ((payload: { id: string; data: string }) => void) | null = null;
let exitCallback: ((payload: { id: string; code: number }) => void) | null = null;

const spawn = vi.fn(async (id: string) => ({ success: true, id, shell: "pwsh" }));
const write = vi.fn(async () => true);
const kill = vi.fn(async () => true);

beforeEach(() => {
  dataCallback = null;
  exitCallback = null;
  spawn.mockClear();
  write.mockClear();
  kill.mockClear();

  (window as unknown as { electronAPI: unknown }).electronAPI = {
    terminal: {
      spawn,
      write,
      kill,
      onData: (cb: (p: { id: string; data: string }) => void) => {
        dataCallback = cb;
        return () => {
          dataCallback = null;
        };
      },
      onExit: (cb: (p: { id: string; code: number }) => void) => {
        exitCallback = cb;
        return () => {
          exitCallback = null;
        };
      },
    },
  };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("Terminal component", () => {
  it("spawns the shell process on mount", async () => {
    await act(async () => {
      render(<Terminal id="test-1" cwd="C:/proj" onKill={() => {}} t={t} />);
    });

    expect(spawn).toHaveBeenCalledWith("test-1", "C:/proj");
    expect(screen.getByText("pwsh")).toBeTruthy();
  });

  it("displays streaming output from onData", async () => {
    await act(async () => {
      render(<Terminal id="test-1" onKill={() => {}} t={t} />);
    });

    await act(async () => {
      dataCallback?.({ id: "test-1", data: "Hello from PowerShell\r\n" });
    });

    expect(screen.getByText(/Hello from PowerShell/)).toBeTruthy();
  });

  it("sends command on Enter key press", async () => {
    await act(async () => {
      render(<Terminal id="test-1" onKill={() => {}} t={t} />);
    });

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Get-Process" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(write).toHaveBeenCalledWith("test-1", "Get-Process\r\n");
  });

  it("kills process and invokes onKill when tab close is clicked", async () => {
    const onKill = vi.fn();
    await act(async () => {
      render(<Terminal id="test-1" onKill={onKill} t={t} />);
    });

    const closeBtn = screen.getByLabelText("killTerminal");
    fireEvent.click(closeBtn);

    expect(kill).toHaveBeenCalledWith("test-1");
    expect(onKill).toHaveBeenCalled();
  });

  it("appends exit message when process exits", async () => {
    await act(async () => {
      render(<Terminal id="test-1" onKill={() => {}} t={t} />);
    });

    await act(async () => {
      exitCallback?.({ id: "test-1", code: 0 });
    });

    expect(screen.getByText(/Process exited with code 0/)).toBeTruthy();
  });
});
