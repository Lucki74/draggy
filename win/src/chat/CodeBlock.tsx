import { useState } from "react";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-async";
import { SYNTAX_THEME } from "./syntaxTheme";
import { Icon } from "../ui";
import { copyText } from "../utils";
import { translate } from "../i18n";
import { requestPrefill, shellForLanguage } from "../terminal/terminalBus";

/** A fenced code block: language, copy button, highlighted source. Its own file because fast
 * refresh wants components or constants exported, not both. */

interface CodeBlockProps {
  language: string;
  value: string;
}

export function CodeBlock({ language, value }: CodeBlockProps) {
  const [isCopied, setIsCopied] = useState(false);
  const lang = typeof document !== "undefined" ? document.documentElement.lang || "en" : "en";
  const t = (key: string) => translate(lang, key);

  const copyCode = async () => {
    if (!(await copyText(value))) return;
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const runShell = shellForLanguage(language);

  return (
    <div dir="ltr" data-code={language} className="my-4 rounded-md overflow-hidden border border-rule bg-surface-base max-w-full">
      <div data-copy-skip className="flex items-center justify-between h-9 ps-4 pe-2 border-b border-rule">
        <span className="font-mono text-[12px] text-text-secondary">{language}</span>
        <div className="flex items-center gap-1">
        {runShell ? (
          <button
            type="button"
            onClick={(event) => {
              // Only a click by a person puts a command on a prompt.
              if (event.isTrusted) requestPrefill({ command: value, shell: runShell });
            }}
            title={t("runInTerminal")}
            className="flex items-center gap-1.5 h-7 px-2 rounded-xs text-[12px] text-text-secondary hover:text-text-primary hover:bg-surface-raised"
          >
            <Icon name="terminal-window" size={14} />
            <span>{t("runInTerminal")}</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={copyCode}
          className="flex items-center gap-1.5 h-7 px-2 rounded-xs text-[12px] text-text-secondary hover:text-text-primary hover:bg-surface-raised"
        >
          <Icon name={isCopied ? "check" : "copy"} size={14} />
          <span>{isCopied ? t("codeCopied") : t("copyCode")}</span>
        </button>
        </div>
      </div>
      <SyntaxHighlighter
        style={SYNTAX_THEME}
        language={language}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: "12px 16px",
          background: "transparent",
          overflowX: "auto",
        }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
}

interface CodeProps {
  className?: string;
  children?: React.ReactNode;
}

const LANGUAGE_ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  py: "python",
  rs: "rust",
  cs: "csharp",
  sh: "bash",
  zsh: "bash",
  ps1: "powershell",
  html: "markup",
  xml: "markup",
  svg: "markup",
  yml: "yaml",
  docker: "dockerfile",
};

function normalizePrismLanguage(raw: string): string {
  const lower = String(raw || "").toLowerCase();
  return LANGUAGE_ALIASES[lower] ?? lower;
}

export function MarkdownCode({ className, children }: CodeProps) {
  const match = /language-([A-Za-z0-9_#-]+)/.exec(className || "");

  return match ? (
    <CodeBlock
      language={normalizePrismLanguage(match[1])}
      value={String(children).replace(/\n$/, "")}
    />
  ) : (
    <code className="bg-surface-raised px-1.5 py-0.5 rounded-xs text-[0.875em] font-mono">
      {children}
    </code>
  );
}
