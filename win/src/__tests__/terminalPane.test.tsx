// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import TerminalPane from "../terminal/TerminalPane";
import { resetSessions } from "../terminal/terminalSessions";
import { appendAgentBlock, finishAgentBlock, requestPrefill, resetTerminalBus, startAgentBlock } from "../terminal/terminalBus";
import { translations } from "../translations";

/** The pane opens shells in the project, keeps them across a remount, puts a code block's command on a
 * prompt without running it, and shows the agent's commands read-only. */

const t = (key: string) => translations.en[key] || key;

const views: Array<{ write: ReturnType<typeof vi.fn> }> = [];

vi.mock("../terminal/xtermView", () => ({
  createTerminalView: vi.fn(async () => {
    const view = {
      write: vi.fn(),
      focus: vi.fn(),
      fit: () => ({ cols: 90, rows: 25 }),
      size: () => ({ cols: 90, rows: 25 }),
      selection: () => "",
      dispose: vi.fn(),
    };
    views.push(view);
    return view;
  }),
}));

let data: (event: { id: string; data: string }) => void = () => {};
let exit: (event: { id: string; exitCode: number }) => void = () => {};
let shell: Record<string, ReturnType<typeof vi.fn>>;
let counter = 0;

beforeEach(() => {
  views.length = 0;
  counter = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  shell = {
    open: vi.fn(async (_workspace: string, options: { shell?: string }) => ({
      success: true,
      id: `pty-${++counter}`,
      shell: options.shell ?? "bash",
    })),
    write: vi.fn(async () => true),
    resize: vi.fn(async () => true),
    close: vi.fn(async () => true),
    onData: vi.fn((cb) => {
      data = cb;
      return () => {};
    }),
    onExit: vi.fn((cb) => {
      exit = cb;
      return () => {};
    }),
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = { shell };
});

afterEach(() => {
  cleanup();
  resetSessions();
  resetTerminalBus();
  vi.unstubAllGlobals();
});

describe("the terminal pane", () => {
  it("opens a shell in the workspace and sends the fitted size", async () => {
    render(<TerminalPane workspaceId="w1" t={t} defaultShell="auto" />);

    await waitFor(() => expect(shell.open).toHaveBeenCalledWith("w1", { shell: undefined, defaultShell: undefined }));
    await waitFor(() => expect(shell.resize).toHaveBeenCalledWith("pty-1", 90, 25));
    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });

  it("opens one shell under strict mode", async () => {
    render(
      <StrictMode>
        <TerminalPane workspaceId="w1" t={t} defaultShell="auto" />
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(1));
    expect(shell.open).toHaveBeenCalledTimes(1);
  });

  it("shows output and marks a shell that ended", async () => {
    render(<TerminalPane workspaceId="w1" t={t} />);
    await waitFor(() => expect(views).toHaveLength(1));

    act(() => data({ id: "pty-1", data: "hello" }));
    expect(views[0].write).toHaveBeenCalledWith("hello");

    act(() => exit({ id: "pty-1", exitCode: 0 }));
    expect(await screen.findByText(/ended/)).toBeTruthy();
  });

  it("keeps its shells when the pane is closed and opened again", async () => {
    const first = render(<TerminalPane workspaceId="w1" t={t} />);
    await waitFor(() => expect(views).toHaveLength(1));
    first.unmount();

    render(<TerminalPane workspaceId="w1" t={t} />);
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(shell.open).toHaveBeenCalledTimes(1);
  });

  it("closes a tab through the host", async () => {
    render(<TerminalPane workspaceId="w1" t={t} />);
    await waitFor(() => expect(views).toHaveLength(1));

    fireEvent.click(screen.getByLabelText("Close terminal"));
    expect(shell.close).toHaveBeenCalledWith("pty-1");
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("says so when the terminal is not available", async () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      shell: { ...shell, open: vi.fn(async () => ({ success: false, unavailable: true })) },
    };
    render(<TerminalPane workspaceId="w1" t={t} />);

    expect(await screen.findByText(translations.en.terminalUnavailable)).toBeTruthy();
  });

  it("puts a command on the prompt without pressing Enter", async () => {
    render(<TerminalPane workspaceId="w1" t={t} />);
    await waitFor(() => expect(views).toHaveLength(1));

    act(() => requestPrefill({ command: "npm test\n", shell: "bash" }));
    await waitFor(() => expect(shell.write).toHaveBeenCalledWith("pty-1", "npm test"));
    expect(shell.write.mock.calls.every(([, text]) => !String(text).includes("\r"))).toBe(true);
  });

  it("sends a multi-line command as a paste", async () => {
    render(<TerminalPane workspaceId="w1" t={t} />);
    await waitFor(() => expect(views).toHaveLength(1));

    act(() => requestPrefill({ command: "echo a\necho b", shell: "bash" }));
    await waitFor(() => expect(shell.write).toHaveBeenCalledWith("pty-1", "\u001b[200~echo a\necho b\u001b[201~"));
  });

  it("starts a shell of the right kind for a command when none matches", async () => {
    render(<TerminalPane workspaceId="w1" t={t} />);
    await waitFor(() => expect(views).toHaveLength(1));

    act(() => requestPrefill({ command: "Get-Date", shell: "pwsh" }));
    await waitFor(() => expect(shell.open).toHaveBeenCalledWith("w1", { shell: "pwsh", defaultShell: undefined }));
  });

  it("shows the agent's commands as read-only blocks", async () => {
    render(<TerminalPane workspaceId="w1" t={t} />);
    act(() => startAgentBlock({ id: "r1", command: "git status", shell: "bash" }));
    act(() => appendAgentBlock("r1", "clean"));
    act(() => finishAgentBlock("r1", { status: "done", exitCode: 0 }));

    expect(await screen.findByText("git status")).toBeTruthy();
    expect(screen.getByText("clean")).toBeTruthy();
    expect(screen.getByText("exit 0")).toBeTruthy();
    expect(screen.getByText("git status").closest("[data-status]")?.querySelector("textarea,input")).toBeNull();
  });
});
