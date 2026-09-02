import { useState } from "react";
import { Check, Copy } from "lucide-react";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-async";
import { atomDark } from "react-syntax-highlighter/dist/esm/styles/prism";

/**
 * A fenced code block: language, copy button, highlighted source. Its own file
 * because fast refresh wants components or constants exported, not both.
 */

interface CodeBlockProps {
  language: string;
  value: string;
}

export function CodeBlock({ language, value }: CodeBlockProps) {
  const [isCopied, setIsCopied] = useState(false);

  const copyCode = () => {
    navigator.clipboard.writeText(value);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="my-3 rounded-xl overflow-x-auto border-[3px] border-[var(--border-light)] bg-[#1e1e1e] max-w-full">
      <div className="flex items-center justify-between px-4 py-2 bg-[#2b2b2b] border-b-[3px] border-[var(--border-light)] min-w-max">
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
          {language}
        </span>
        <button
          onClick={copyCode}
          className="flex items-center space-x-1.5 text-xs font-bold text-[var(--text-muted)] hover:text-white transition-colors"
        >
          {isCopied ? (
            <>
              <Check className="w-3.5 h-3.5 text-green-500" />
              <span>Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <SyntaxHighlighter
        style={atomDark}
        language={language}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: "1rem",
          background: "transparent",
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

export function MarkdownCode({ className, children }: CodeProps) {
  const match = /language-(\w+)/.exec(className || "");

  return match ? (
    <CodeBlock
      language={match[1]}
      value={String(children).replace(/\n$/, "")}
    />
  ) : (
    <code className="bg-[var(--hover-bg)] px-1.5 py-0.5 rounded-md border-2 border-[var(--border-light)]">
      {children}
    </code>
  );
}
