import type { Terminal } from "@xterm/xterm";
import { logSwallow } from "../logger";

/** One xterm instance on a container. Kept apart from the pane so the pane can be tested with this
 * module replaced. */

export interface TerminalView {
  write: (data: string) => void;
  focus: () => void;
  /** Fits to the container and returns the new size, or null when it has no size yet. */
  fit: () => { cols: number; rows: number } | null;
  size: () => { cols: number; rows: number };
  selection: () => string;
  dispose: () => void;
}

export interface TerminalViewOptions {
  onInput: (data: string) => void;
  /** Only addresses with these schemes are followed. */
  onLink: (uri: string) => void;
  fontSize?: number;
}

const LINK_SCHEMES = /^https?:\/\//i;

export async function createTerminalView(container: HTMLElement, options: TerminalViewOptions): Promise<TerminalView> {
  const [{ Terminal: XTerm }, { FitAddon }] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/xterm/css/xterm.css"),
  ]);
  const fitAddon = new FitAddon();
  const terminal: Terminal = new XTerm({
    cursorBlink: true,
    scrollback: 5000,
    fontFamily: '"JetBrains Mono Variable", Consolas, monospace',
    fontSize: options.fontSize ?? 13,
    allowProposedApi: false,
    linkHandler: {
      activate: (_event, uri) => {
        if (LINK_SCHEMES.test(uri)) options.onLink(uri);
      },
    },
  });
  terminal.loadAddon(fitAddon);
  terminal.open(container);

  // Only a person's keys reach the shell. A script that dispatches a key event is not one.
  terminal.attachCustomKeyEventHandler((event) => event.isTrusted);
  terminal.onData((data) => options.onInput(data));

  return {
    write: (data) => terminal.write(data),
    focus: () => terminal.focus(),
    fit: () => {
      try {
        fitAddon.fit();
        return terminal.cols > 0 && terminal.rows > 0 ? { cols: terminal.cols, rows: terminal.rows } : null;
      } catch (error) {
        logSwallow("terminal", error, "the container has no size while hidden");
        return null;
      }
    },
    size: () => ({ cols: terminal.cols, rows: terminal.rows }),
    selection: () => terminal.getSelection(),
    dispose: () => terminal.dispose(),
  };
}
