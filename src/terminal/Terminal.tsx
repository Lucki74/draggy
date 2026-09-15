import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Terminal as TerminalIcon, Trash2, X } from "lucide-react";

/** Interactive terminal running in the project folder with command history and streaming output.
 * Clicking the tab close button kills the process tree. */

interface TerminalProps {
  id?: string;
  cwd?: string;
  onKill: () => void;
  t: (key: string) => string;
}

export default function Terminal({ id = "term-1", cwd, onKill, t }: TerminalProps) {
  const [output, setOutput] = useState<string>("");
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [activeShell, setActiveShell] = useState<string>("pwsh");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const api = window.electronAPI?.terminal;

  useEffect(() => {
    if (!api) return;

    let mounted = true;
    void api.spawn(id, cwd).then((result) => {
      if (!mounted) return;
      if (result?.shell) setActiveShell(result.shell.replace(/\.exe$/i, ""));
    });

    const stopData = api.onData((payload) => {
      if (payload.id !== id) return;
      setOutput((prev) => prev + payload.data);
    });

    const stopExit = api.onExit((payload) => {
      if (payload.id !== id) return;
      setOutput((prev) => `${prev}\r\n[Process exited with code ${payload.code}]\r\n`);
    });

    return () => {
      mounted = false;
      stopData();
      stopExit();
    };
  }, [api, id, cwd]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output]);

  const sendCommand = (cmd: string) => {
    if (!api) return;
    const trimmed = cmd.trim();
    if (trimmed) {
      setHistory((prev) => [...prev, cmd]);
    }
    setHistoryIndex(-1);
    setInput("");
    api.write(id, `${cmd}\r\n`);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendCommand(input);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (history.length === 0) return;
      const nextIdx = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIdx);
      setInput(history[nextIdx] ?? "");
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (historyIndex === -1) return;
      const nextIdx = historyIndex + 1;
      if (nextIdx >= history.length) {
        setHistoryIndex(-1);
        setInput("");
      } else {
        setHistoryIndex(nextIdx);
        setInput(history[nextIdx] ?? "");
      }
    } else if (event.ctrlKey && event.key.toLowerCase() === "c") {
      event.preventDefault();
      api?.write(id, "\x03");
    } else if (event.ctrlKey && event.key.toLowerCase() === "l") {
      event.preventDefault();
      setOutput("");
    }
  };

  const handleKill = () => {
    api?.kill(id);
    onKill();
  };

  const promptPrefix = cwd ? `PS ${cwd}>` : `PS>`;

  return (
    <div
      className="flex h-full min-w-0 flex-col bg-[#121212] text-[#e0e0e0] font-mono text-[13px]"
      onClick={() => inputRef.current?.focus()}
    >
      <div
        className="flex items-center justify-between border-b-[3px] bg-[#1a1a1a] px-2 py-1 select-none"
        style={{ borderColor: "var(--border-light)" }}
      >
        <div className="flex items-center">
          <div className="flex items-center gap-2 rounded-t-md bg-[#121212] border-t-2 border-l-2 border-r-2 border-[var(--border-light)] px-3 py-1 text-xs font-bold text-[#e0e0e0]">
            <TerminalIcon className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            <span>{activeShell}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleKill();
              }}
              title={t("killTerminal")}
              aria-label={t("killTerminal")}
              className="ml-1 rounded p-0.5 text-[var(--text-muted)] hover:bg-[#2a2a2a] hover:text-white transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOutput("");
            }}
            title="Clear"
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[#2a2a2a] hover:text-white transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 whitespace-pre-wrap break-all select-text font-mono leading-relaxed">
        {output}
        <div className="flex items-center mt-1">
          <span className="text-cyan-400 font-bold select-none mr-2">{promptPrefix}</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            autoFocus
            spellCheck={false}
            className="flex-1 bg-transparent border-none outline-none text-[#e0e0e0] font-mono caret-white min-w-0"
          />
        </div>
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
