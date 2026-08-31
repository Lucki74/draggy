import { useRef, useEffect, useState, useMemo, useCallback, memo, Fragment } from "react";
import { ErrorBoundary } from "./ErrorBoundary";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  User,
  Loader2,
  ChevronRight,
  Copy,
  RefreshCw,
  Check,
  Square,
  Globe,
  Search,
  FileText,
  FileUp,
  X,
  Plus,
  Brain,
  ImageIcon,
  Film,
  Lightbulb,
  MousePointer,
  Type,
  Scan,
  FileCode,
  Download,
  Pencil,
  File,
  Cpu,
  AlertTriangle,
  Mic,
  MicOff,
  Library,
  Terminal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Logo from "./Logo";
import { pickGreeting } from "./greetings";
import TypedGreeting from "./TypedGreeting";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkBreaks from "remark-breaks";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-async";
import { atomDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { visit } from "unist-util-visit";
import type { Node as UnistNode, Parent as UnistParent } from "unist";
import { selectableModels } from "./modelKinds";
import { translations } from "./translations";
import {
  isBinary,
  sanitizeContent,
  normalizeMath,
  hostnameOf,
  hueFor,
  siteLabel,
  writeLocalStorage,
} from "./utils";
import {
  describeContextUse,
  getModelInfo,
  isCloudModel,
  listInstalledModels,
  needsTextModeTools,
  warmModel,
} from "./ollama";
import { KEEP_ALIVE } from "./agent/agentLoop";
import { isSpeechSupported, startRecording, transcribe } from "./speech";
import type { Recorder } from "./speech";
import type { InstalledModel, ModelInfo } from "./ollama";

interface InlineMathNode extends UnistNode {
  value: string;
}

function remarkFixCurrencyMath() {
  return (tree: UnistNode) => {
    visit(
      tree,
      "inlineMath",
      (node: InlineMathNode, index, parent: UnistParent | undefined) => {
        if (typeof index !== "number" || !parent) return;
        const val = node.value;
        if (
          /^\d/.test(val) &&
          val.includes(" ") &&
          !/[\\^_=+\-*/<>|(){}[\]]/.test(val)
        ) {
          parent.children[index] = {
            type: "text",
            value: `$${val}$`,
          } as UnistNode;
        }
      },
    );
  };
}

const REMARK_PLUGINS = [
  remarkGfm,
  remarkMath,
  remarkFixCurrencyMath,
  remarkBreaks,
];

const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "className"],
  },
};

const REHYPE_PLUGINS = [
  rehypeRaw,
  [rehypeSanitize, SANITIZE_SCHEMA],
  rehypeKatex,
] as never;
const MAX_INPUT_HEIGHT = 150;

const MAX_TEXT_FILE_BYTES = 1024 * 1024;

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

const DOCUMENT_EXTENSIONS = ["docx", "pptx", "xlsx"];

const TEXT_EXTENSIONS = [
  "txt", "md", "markdown", "rst", "log", "csv", "tsv", "json", "jsonc",
  "yaml", "yml", "xml", "toml", "ini", "cfg", "conf", "env", "properties",
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "html", "htm", "css", "scss",
  "sass", "less", "vue", "svelte", "astro", "svg",
  "py", "rb", "go", "rs", "java", "kt", "kts", "swift", "c", "h", "cpp",
  "cc", "hpp", "cs", "php", "lua", "r", "pl", "dart", "scala", "clj", "ex",
  "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd", "sql", "graphql",
  "gradle", "dockerfile", "makefile", "gitignore", "editorconfig",
];

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const THINKING_ORDER: AppSettings["thinkingMode"][] = ["low", "medium", "high"];
const WEB_MODE_ORDER: AppSettings["webMode"][] = ["auto", "on", "off"];

const WEB_MODE_LABELS: Record<AppSettings["webMode"], string> = {
  auto: "webAuto",
  on: "webOn",
  off: "webOff",
};

const nextThinkingMode = (current: AppSettings["thinkingMode"]) =>
  THINKING_ORDER[(THINKING_ORDER.indexOf(current) + 1) % THINKING_ORDER.length];

const nextWebMode = (current: AppSettings["webMode"]) =>
  WEB_MODE_ORDER[(WEB_MODE_ORDER.indexOf(current) + 1) % WEB_MODE_ORDER.length];

const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });

// A file named .jpg is not necessarily a JPEG. HEIC photos exported from a
// phone, truncated downloads and empty files all reach this point looking
// plausible, and neither Chromium nor the model can decode them. Decoding it
// here turns a cryptic model error into a clear message at the point of upload.
const canDecodeImage = async (file: File): Promise<boolean> => {
  if (file.size === 0) return false;

  try {
    const bitmap = await createImageBitmap(file);
    const usable = bitmap.width > 0 && bitmap.height > 0;
    bitmap.close();
    return usable;
  } catch {
    return false;
  }
};

const SLASH_COMMANDS = [
  { id: "new", label: "newDiscussion" },
  { id: "model", label: "model" },
  { id: "web", label: "webSearch" },
  { id: "think", label: "thinkingMode" },
  { id: "voice", label: "voiceInput" },
  { id: "code", label: "runCode" },
  { id: "files", label: "addFiles" },
  { id: "settings", label: "settings" },
];

const MODEL_CAPABILITIES = [
  { id: "tools", label: "capabilityTools" },
  { id: "vision", label: "capabilityVision" },
  { id: "thinking", label: "thinking" },
];

const INLINE_COMPONENTS = {
  p: (props: React.HTMLAttributes<HTMLElement>) => <span {...props} />,
};

const STEP_ICONS: Partial<Record<SearchStep["type"], LucideIcon>> = {
  searching: Search,
  opening: Search,
  reading: FileText,
  navigating: Send,
  loaded: Check,
  scanned: Scan,
  clicking: MousePointer,
  typing: Type,
  library: Library,
  run_code: Terminal,
};

import type {
  ChatSession,
  AppSettings,
  Attachment,
  Message,
  SearchStep,
  TurnMetrics,
} from "./types";

interface ChatScreenProps {
  model: string;
  chat: ChatSession;
  onSendMessage: (content: string, attachments?: Attachment[]) => void;
  onRegenerate: (index: number) => void;
  onSwitchVersion: (messageIndex: number, versionIndex: number) => void;
  onEditMessage: (messageIndex: number, newContent: string) => void;
  onStopGeneration: () => void;
  onContinueGeneration: () => void;
  onDismissOutOfContext: () => void;
  onSelectModel: (name: string) => void;
  onOpenSettings: (tab: "appearance" | "models") => void;
  onNewChat: () => void;
  settings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
}

interface CodeBlockProps {
  language: string;
  value: string;
}

function CodeBlock({ language, value }: CodeBlockProps) {
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

function MarkdownCode({ className, children }: CodeProps) {
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

const MARKDOWN_COMPONENTS = { code: MarkdownCode };

const formatTokens = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);

function MetricsFooter({
  metrics,
  t,
}: {
  metrics: TurnMetrics;
  t: (key: string) => string;
}) {
  const contextUsed = metrics.promptTokens + metrics.responseTokens;
  const contextPercent =
    metrics.contextWindow > 0
      ? Math.min(100, Math.round((contextUsed / metrics.contextWindow) * 100))
      : 0;

  const cells: string[] = [
    `${metrics.tokensPerSecond.toFixed(1)} ${t("tokensPerSecond")}`,
    `${formatTokens(metrics.responseTokens)} ${t("tokensOut")}`,
  ];

  if (metrics.timeToFirstTokenMs !== null) {
    cells.push(`${(metrics.timeToFirstTokenMs / 1000).toFixed(2)}s ${t("toFirstToken")}`);
  }

  cells.push(
    `${formatTokens(contextUsed)} / ${formatTokens(metrics.contextWindow)} ${t("context")} (${contextPercent}%)`,
  );

  if (metrics.gpuPercent !== null) {
    cells.push(
      metrics.gpuPercent >= 100
        ? `100% ${t("onGpu")}`
        : `${metrics.gpuPercent}% ${t("onGpu")} / ${100 - metrics.gpuPercent}% ${t("onCpu")}`,
    );
  }

  if (metrics.loadMs > 250) {
    cells.push(`${(metrics.loadMs / 1000).toFixed(1)}s ${t("modelLoad")}`);
  }

  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] tabular-nums"
      title={`${metrics.model} · ${t("promptTokens")} ${metrics.promptTokens}`}
    >
      {cells.map((cell, index) => (
        <Fragment key={cell}>
          {index > 0 && (
            <span aria-hidden="true" className="opacity-40">
              ·
            </span>
          )}
          <span className="whitespace-nowrap">{cell}</span>
        </Fragment>
      ))}
    </div>
  );
}

function LibraryHits({
  hits,
  t,
}: {
  hits: NonNullable<SearchStep["libraryHits"]>;
  t: (key: string) => string;
}) {
  return (
    <div className="flex flex-col gap-1.5 pl-5 mt-2">
      {hits.map((hit, index) => (
        <button
          key={index}
          onClick={() => window.electronAPI?.openFile?.(hit.path)}
          title={hit.path}
          className="flex items-center gap-3 p-2.5 rounded-xl border-[2px] border-[var(--border-light)] bg-[var(--bg-base)] hover:bg-[var(--hover-bg)] transition-all text-left"
        >
          <FileText className="w-4 h-4 flex-shrink-0 opacity-70" />
          <span className="text-xs font-bold truncate flex-1 min-w-0">{hit.name}</span>
          <span className="text-[10px] font-bold text-[var(--text-muted)] flex-shrink-0">
            {(hit.score * 100).toFixed(0)}% {t("match")}
          </span>
        </button>
      ))}
    </div>
  );
}

function CodeRunOutput({ step, t }: { step: SearchStep; t: (key: string) => string }) {
  const hasOutput = Boolean(step.stdout || step.stderr);
  if (!hasOutput) return null;

  return (
    <div className="pl-5 mt-2 space-y-2">
      {step.stdout && (
        <pre className="p-3 rounded-xl border-[2px] border-[var(--border-light)] bg-[var(--bg-base)] text-xs overflow-x-auto whitespace-pre-wrap break-words">
          {step.stdout}
        </pre>
      )}
      {step.stderr && (
        <pre className="p-3 rounded-xl border-[2px] border-red-500/40 bg-red-500/5 text-xs text-red-500 overflow-x-auto whitespace-pre-wrap break-words">
          <span className="block mb-1 font-bold uppercase tracking-wider opacity-70">
            {t("stderr")}
          </span>
          {step.stderr}
        </pre>
      )}
    </div>
  );
}


const CODE_EXTENSIONS = new Set([
  "js", "jsx", "ts", "tsx", "py", "html", "css", "scss", "json", "yml", "yaml",
  "sh", "bash", "ps1", "cpp", "c", "h", "cs", "rs", "go", "java", "rb", "php",
  "sql", "toml", "xml", "swift", "kt", "lua", "r",
]);

/**
 * How long the reveal should take, whatever the file size. A short note types
 * out character by character; a long document scrolls past quickly. Either way
 * it finishes in about the same time, so the user is never left watching.
 */
const FILE_REVEAL_MS = 1600;
const FILE_FRAME_MS = 1000 / 60;

/**
 * A file the model wrote.
 *
 * The content is typed into the card rather than appearing all at once. Ollama
 * hands over a tool call in a single message, so for most models there is no
 * way to show the file growing as it is generated; revealing it here is what
 * turns a spinner that looks stuck into something legible.
 */
function FileCard({
  step,
  animate,
  t,
}: {
  step: SearchStep;
  animate: boolean;
  t: (key: string) => string;
}) {
  const content = step.fileContent || "";
  const extension = step.filename?.split(".").pop()?.toLowerCase() || "";
  const isCode = CODE_EXTENSIONS.has(extension);

  const [revealed, setRevealed] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // A file already on screen from an earlier reply is shown whole; only one
    // being written right now is typed out.
    if (!animate || content.length === 0) return;

    const perFrame = Math.max(
      1,
      Math.ceil(content.length / (FILE_REVEAL_MS / FILE_FRAME_MS)),
    );

    let shown = 0;
    let frame = 0;

    const step = () => {
      shown = Math.min(content.length, shown + perFrame);
      setRevealed(shown);
      if (shown < content.length) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [animate, content]);

  const writing = (animate && revealed < content.length) || !step.isComplete;
  const shown = animate ? content.slice(0, Math.min(revealed, content.length)) : content;

  useEffect(() => {
    if (!writing) return;
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [shown, writing]);

  const lineCount = content ? content.split("\n").length : 0;

  return (
    <div className="mb-5 border-2 border-[var(--border-light)] rounded-xl overflow-hidden bg-[var(--bg-base)] w-full max-w-2xl shadow-sm">
      <div className="flex items-center justify-between p-3 border-b-2 border-[var(--border-light)] bg-[var(--hover-bg)]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[var(--bg-inverted)] text-[var(--text-inverted)] flex items-center justify-center flex-shrink-0">
            {isCode ? <FileCode className="w-4 h-4" /> : <File className="w-4 h-4" />}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-bold text-[var(--text-main)] truncate">
              {step.filename || t("untitledFile")}
            </span>
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-medium">
              {writing ? (
                <>
                  <Pencil className="w-3 h-3 animate-pulse" />
                  <span>{t("writingFile")}</span>
                </>
              ) : (
                <>
                  <Check className="w-3 h-3 text-green-500" />
                  <span>
                    {t("fileCreated")}
                    {lineCount > 0 ? ` · ${lineCount} ${t("lines")}` : ""}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {step.filepath && !writing && (
          <button
            onClick={() => window.electronAPI?.openFile?.(step.filepath!)}
            className="p-2 rounded-lg bg-[var(--bg-panel)] border-2 border-[var(--border-light)] text-[var(--text-main)] hover:bg-[var(--text-main)] hover:text-[var(--bg-panel)] transition-colors flex items-center gap-2 text-xs font-bold flex-shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t("openFile")}</span>
          </button>
        )}
      </div>

      <div
        ref={bodyRef}
        className="p-0 bg-[#1e1e1e] max-h-[300px] overflow-y-auto w-full relative scroll-smooth"
      >
        {isCode ? (
          <SyntaxHighlighter
            language={extension || "javascript"}
            style={atomDark}
            customStyle={{
              margin: 0,
              padding: "1rem",
              background: "transparent",
              fontSize: "13px",
            }}
            wrapLines
            wrapLongLines
          >
            {shown}
          </SyntaxHighlighter>
        ) : (
          <pre className="m-0 p-4 font-mono text-[13px] text-gray-300 whitespace-pre-wrap leading-relaxed break-words">
            {shown}
          </pre>
        )}

        {writing && (
          <span className="inline-block w-2 h-4 bg-gray-300 align-middle animate-pulse absolute"
            style={{ position: "static", marginLeft: "1rem", marginBottom: "1rem" }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The badge beside a search result.
 *
 * Drawn from the site name rather than fetched, so the app never tells anyone
 * else which pages the user is looking at.
 */
/**
 * The site's own icon, falling back to its initial.
 *
 * The icon is fetched and cached by the main process and handed over the
 * `draggy://` protocol, since the renderer may not load images from remote
 * hosts. A site with no usable icon, or no network, silently keeps the
 * coloured letter rather than leaving a gap in the row.
 */
function SiteBadge({ hostname }: { hostname: string }) {
  const label = siteLabel(hostname);
  const hue = hueFor(label);

  // Which host failed, rather than whether one did, so a row reused for a
  // different site starts out trying again instead of inheriting the last
  // one's missing icon.
  const [failedFor, setFailedFor] = useState<string | null>(null);

  if (hostname && failedFor !== hostname) {
    return (
      <img
        src={`draggy://favicon/${encodeURIComponent(hostname)}`}
        alt=""
        aria-hidden="true"
        loading="lazy"
        onError={() => setFailedFor(hostname)}
        className="w-5 h-5 rounded-sm flex-shrink-0 mt-0.5 object-contain select-none"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="w-5 h-5 rounded-sm flex-shrink-0 mt-0.5 flex items-center justify-center text-[10px] font-bold uppercase select-none"
      style={{
        backgroundColor: `hsl(${hue} 62% 46%)`,
        color: "white",
      }}
    >
      {label.slice(0, 1)}
    </span>
  );
}

interface MessageItemProps {
  msg: Message;
  idx: number;
  isGenerating: boolean;
  isLast: boolean;
  onRegenerate: (index: number) => void;
  onSwitchVersion: (messageIndex: number, versionIndex: number) => void;
  copiedIndex: number | null;
  copyToClipboard: (text: string, idx: number) => void;
  settings: AppSettings;
  onEditMessage: (messageIndex: number, newContent: string) => void;
}

const MessageItem = memo(
  ({
    msg,
    idx,
    isGenerating,
    isLast,
    onRegenerate,
    onSwitchVersion,
    copiedIndex,
    copyToClipboard,
    settings,
    onEditMessage,
  }: MessageItemProps) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editContent, setEditContent] = useState("");
    const t = (key: string) => {
      return (
        translations[settings.language]?.[key] || translations["en"][key] || key
      );
    };

    const totalVersions = (msg.versions?.length || 0) + 1;
    const currentVersionIndex = msg.currentVersionIndex ?? totalVersions - 1;
    const currentVersionNum = currentVersionIndex + 1;

    const displayMsg =
      msg.versions && currentVersionIndex < msg.versions.length
        ? msg.versions[currentVersionIndex]
        : msg;

    const text = displayMsg.textContent ?? displayMsg.content;
    const steps = displayMsg.steps || [];

    return (
      <motion.div
        key={msg.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`message-container flex items-start space-x-4 max-w-5xl mx-auto w-full ${msg.role === "user" ? "flex-row-reverse space-x-reverse" : "flex-row"}`}
      >
        <div className="flex-shrink-0 mt-1">
          <div
            className={`w-10 h-10 flex items-center justify-center rounded-xl border-[3px] shadow-[3px_3px_0_var(--border-dark)] ${msg.role === "assistant" ? "ui-box-dark" : "ui-box"}`}
          >
            {msg.role === "assistant" ? (
              <Logo className="w-6 h-6 text-white" />
            ) : (
              <User className="w-6 h-6 text-[var(--text-main)]" />
            )}
          </div>
        </div>

        <div
          className={`flex flex-col min-w-0 max-w-[80%] ${msg.role === "user" ? "items-end" : "items-start"}`}
        >
          {msg.role === "user" &&
            msg.attachments &&
            msg.attachments.length > 0 && (
              <div className="flex flex-wrap gap-3 mb-2 justify-end">
                {msg.attachments.map((file, fIdx) => (
                  <div
                    key={fIdx}
                    className="flex flex-col rounded-xl overflow-hidden border-[3px] border-[var(--border-dark)] bg-[var(--bg-panel)] shadow-[3px_3px_0_var(--border-dark)]"
                  >
                    {file.type.startsWith("image/") ? (
                      <div className="flex flex-col">
                        <img
                          src={file.content}
                          alt={file.name}
                          className="w-48 h-48 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => window.open(file.content)}
                        />
                        <div className="px-3 py-1.5 bg-[var(--bg-inverted)] border-t-[3px] border-[var(--border-dark)]">
                          <span className="text-[10px] uppercase font-bold text-white truncate max-w-[150px] block">
                            {file.name}
                          </span>
                        </div>
                      </div>
                    ) : file.type.startsWith("video/") ? (
                      <div className="w-32 h-32 flex flex-col items-center justify-center p-2 text-center">
                        <Film className="w-8 h-8 mb-2 text-[var(--text-main)]" />
                        <span className="text-[10px] uppercase font-bold truncate w-full px-2 text-[var(--text-main)]">
                          {file.name}
                        </span>
                      </div>
                    ) : (
                      <div className="w-32 h-32 flex flex-col items-center justify-center p-2 text-center">
                        <FileText className="w-8 h-8 mb-2 text-[var(--text-main)]" />
                        <span className="text-[10px] uppercase font-bold truncate w-full px-2 text-[var(--text-main)]">
                          {file.name}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

          {isEditing && msg.role === "user" ? (
            <div className="flex flex-col w-full p-4 font-bold leading-relaxed break-words border-[3px] rounded-xl bg-[var(--bg-inverted)] text-[var(--text-inverted)] border-[var(--border-dark)] rounded-tr-none shadow-[4px_4px_0_var(--border-dark)]">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full min-h-[100px] bg-transparent outline-none resize-y text-inherit border-[3px] border-[var(--border-dark)] p-2 rounded-lg"
              />
              <div className="flex justify-end space-x-2 mt-2">
                <button
                  onClick={() => setIsEditing(false)}
                  className="px-3 py-1 rounded-lg border-[2px] border-[var(--border-dark)] hover:bg-[var(--bg-panel)] hover:text-[var(--text-main)] transition-colors"
                >
                  {t("cancel")}
                </button>
                <button
                  onClick={() => {
                    onEditMessage(idx, editContent);
                    setIsEditing(false);
                  }}
                  className="px-3 py-1 rounded-lg border-[2px] border-[var(--border-dark)] bg-[var(--bg-panel)] text-[var(--text-main)] hover:bg-[var(--bg-inverted)] hover:text-[var(--text-inverted)] transition-colors"
                >
                  {t("save")}
                </button>
              </div>
            </div>
          ) : (
            <div
              className={
                msg.role === "user"
                  ? "p-4 font-bold leading-relaxed break-words border-[3px] rounded-xl bg-[var(--bg-inverted)] text-[var(--text-inverted)] border-[var(--border-dark)] rounded-tr-none shadow-[4px_4px_0_var(--border-dark)]"
                  : text === "" && steps.length === 0 && isGenerating && isLast
                    ? "p-3 px-4 rounded-2xl bg-[var(--bg-panel)] border-[3px] border-[var(--border-light)] w-fit"
                    : "p-4 font-bold leading-relaxed break-words border-[3px] rounded-xl bg-[var(--bg-panel)] text-[var(--text-main)] border-[var(--border-light)] rounded-tl-none shadow-[4px_4px_0_var(--border-light)] markdown-body"
              }
              style={{ fontSize: "var(--chat-font-size)" }}
            >
              {msg.role === "assistant" &&
                msg.attachments &&
                msg.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-3 mb-4">
                    {msg.attachments.map((file, fIdx) => (
                      <div
                        key={fIdx}
                        className="flex flex-col rounded-lg overflow-hidden border-2 border-[var(--border-light)] bg-[var(--hover-bg)]"
                      >
                        {file.type.startsWith("image/") ? (
                          <img
                            src={file.content}
                            alt={file.name}
                            className="w-32 h-32 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => window.open(file.content)}
                          />
                        ) : (
                          <div className="w-32 h-32 flex flex-col items-center justify-center p-2 text-center">
                            {file.type.startsWith("video/") ? (
                              <Film className="w-8 h-8 mb-2" />
                            ) : (
                              <FileText className="w-8 h-8 mb-2" />
                            )}
                            <span className="text-[10px] uppercase font-bold truncate w-full px-2">
                              {file.name}
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

              {msg.role === "user" ? (
                <div className="markdown-body">
                  <ReactMarkdown
                    remarkPlugins={REMARK_PLUGINS}
                    rehypePlugins={REHYPE_PLUGINS}
                  >
                    {normalizeMath(
                      msg.content.trim()
                        ? sanitizeContent(msg.content)
                        : msg.attachments && msg.attachments.length > 0
                          ? `[${t("attachedFiles")}]`
                          : "",
                    )}
                  </ReactMarkdown>
                </div>
              ) : (
                <>
                  {steps.map((step) => {
                    // Prose the model wrote before a tool call. It is rendered
                    // exactly like the reply body, in the place it was written.
                    if (step.type === "text") {
                      if (!step.content.trim()) return null;

                      return (
                        <div key={step.id} className="mb-5">
                          <ReactMarkdown
                            remarkPlugins={REMARK_PLUGINS}
                            rehypePlugins={REHYPE_PLUGINS}
                            components={MARKDOWN_COMPONENTS}
                          >
                            {normalizeMath(sanitizeContent(step.content))}
                          </ReactMarkdown>
                        </div>
                      );
                    }

                    if (step.type === "thinking") {
                      if (!step.content) return null;

                      const isCurrentlyThinking = !step.isComplete;
                      const title = isCurrentlyThinking
                        ? t("thinking") + "..."
                        : step.thoughtTime && step.thoughtTime < 1
                          ? t("thoughtForAMoment")
                          : `${t("thoughtFor")} ${step.thoughtTime?.toFixed(1)} ${t("seconds")}`;

                      return (
                        <details
                          key={step.id}
                          className="mb-4 group"
                          open={isCurrentlyThinking}
                        >
                          <summary className="cursor-pointer p-0 m-0 text-[var(--text-muted)] text-sm font-medium flex items-center select-none list-none transition-colors hover:text-[var(--text-main)] group-open:mb-2 group/summary">
                            <div className="relative w-4 h-4 mr-2 flex items-center justify-center flex-shrink-0">
                              <Lightbulb className="w-4 h-4 opacity-70 absolute transition-opacity duration-200 group-hover/summary:opacity-0 group-open:opacity-0" />
                              <ChevronRight className="w-4 h-4 absolute opacity-0 transition-all duration-200 group-hover/summary:opacity-100 group-open:opacity-100 group-open:rotate-90" />
                            </div>
                            <span className="tracking-tight">{title}</span>
                            {isCurrentlyThinking && (
                              <Loader2 className="w-3 h-3 animate-spin ml-2 opacity-50" />
                            )}
                          </summary>
                          <div className="pl-5 pr-2 mb-6 text-[var(--text-muted)] text-[0.95em] leading-relaxed border-l-2 border-[var(--border-light)] italic opacity-80 markdown-body">
                            <ReactMarkdown
                              remarkPlugins={REMARK_PLUGINS}
                              rehypePlugins={REHYPE_PLUGINS}
                            >
                              {normalizeMath(step.content)}
                            </ReactMarkdown>
                          </div>
                        </details>
                      );
                    }

                    if (
                      step.type === "results" &&
                      step.results &&
                      step.results.length > 0
                    ) {
                      return (
                        <details key={step.id} className="mb-5 group">
                          <summary className="cursor-pointer p-0 m-0 text-[var(--text-muted)] text-sm font-medium flex items-center select-none list-none transition-colors hover:text-[var(--text-main)] group-open:mb-3 group/summary">
                            <div className="relative w-4 h-4 mr-2 flex items-center justify-center flex-shrink-0">
                              <Globe className="w-4 h-4 opacity-70 absolute transition-opacity duration-200 group-hover/summary:opacity-0 group-open:opacity-0" />
                              <ChevronRight className="w-4 h-4 absolute opacity-0 transition-all duration-200 group-hover/summary:opacity-100 group-open:opacity-100 group-open:rotate-90" />
                            </div>
                            <span className="tracking-tight markdown-inline">
                              <ReactMarkdown
                                remarkPlugins={REMARK_PLUGINS}
                                rehypePlugins={REHYPE_PLUGINS}
                                components={INLINE_COMPONENTS}
                              >
                                {step.content}
                              </ReactMarkdown>
                            </span>
                          </summary>
                          <div className="flex flex-col gap-2 pl-5 mt-2">
                            {step.results.map((result, rIdx) => {
                              const hostname = hostnameOf(result.url);
                              return (
                                <a
                                  key={rIdx}
                                  href={result.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-start gap-3 p-3 rounded-xl border-[2px] border-[var(--border-light)] bg-[var(--bg-base)] hover:bg-[var(--hover-bg)] hover:border-[var(--border-dark)] transition-all group/link no-underline"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    window.open(result.url, "_blank");
                                  }}
                                >
                                  <SiteBadge hostname={hostname} />
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-bold text-[var(--text-main)] group-hover/link:underline truncate leading-tight">
                                      {result.title}
                                    </p>
                                    <p className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">
                                      {hostname}
                                    </p>
                                    {result.snippet && (
                                      <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed line-clamp-2">
                                        {result.snippet}
                                      </p>
                                    )}
                                  </div>
                                  <ChevronRight className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0 mt-0.5 opacity-0 group-hover/link:opacity-100 transition-opacity" />
                                </a>
                              );
                            })}
                          </div>
                        </details>
                      );
                    }

                    if (step.type === "create_file") {
                      return (
                        <FileCard
                          key={step.id}
                          step={step}
                          animate={isGenerating && isLast}
                          t={t}
                        />
                      );
                    }


                    const StepIcon = STEP_ICONS[step.type] || Globe;

                    const isActive = !step.isComplete;

                    const payload =
                      step.type === "library" && step.libraryHits?.length ? (
                        <LibraryHits hits={step.libraryHits} t={t} />
                      ) : step.type === "run_code" ? (
                        <CodeRunOutput step={step} t={t} />
                      ) : null;

                    return (
                      <div
                        key={step.id}
                        className={
                          payload
                            ? "mb-3 text-[var(--text-muted)]"
                            : "flex items-center space-x-3 mb-3 text-[var(--text-muted)]"
                        }
                      >
                      <div className="flex items-center space-x-3">
                        {isActive ? (
                          <Loader2 className="w-4 h-4 animate-spin opacity-60 flex-shrink-0" />
                        ) : (
                          <StepIcon className="w-4 h-4 opacity-60 flex-shrink-0" />
                        )}
                        <span
                          className={`text-sm font-bold tracking-tight markdown-inline ${isActive ? "opacity-60" : ""}`}
                        >
                          <ReactMarkdown
                            remarkPlugins={REMARK_PLUGINS}
                            rehypePlugins={REHYPE_PLUGINS}
                            components={INLINE_COMPONENTS}
                          >
                            {step.content
                              .replace(
                                /^Navigating to/i,
                                step.isComplete ? "Visited" : "Navigating to",
                              )
                              .replace(
                                /^Scanning/i,
                                step.isComplete ? "Scanned" : "Scanning",
                              )
                              .replace(
                                /^Clicking/i,
                                step.isComplete ? "Clicked" : "Clicking",
                              )
                              .replace(
                                /^Typing/i,
                                step.isComplete ? "Typed" : "Typing",
                              )}
                          </ReactMarkdown>
                        </span>
                      </div>
                      {payload}
                      </div>
                    );
                  })}

                  <ReactMarkdown
                    remarkPlugins={REMARK_PLUGINS}
                    rehypePlugins={REHYPE_PLUGINS}
                    components={MARKDOWN_COMPONENTS}
                  >
                    {normalizeMath(text)}
                  </ReactMarkdown>
                </>
              )}
              {msg.role === "assistant" &&
                text === "" &&
                !steps.some(
                  (s) =>
                    !s.isComplete && !(s.type === "thinking" && !s.content),
                ) &&
                isGenerating &&
                isLast && (
                  <div className="typing-dots !p-0">
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                  </div>
                )}
            </div>
          )}

          {msg.role === "assistant" && !isGenerating && (
            <div className="w-full mt-2 px-1 space-y-2">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => copyToClipboard(text, idx)}
                  className="p-2 rounded-lg border-2 border-[var(--border-light)] text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)] transition-colors bg-[var(--bg-panel)] shadow-[2px_2px_0_var(--border-light)] active:shadow-none active:translate-x-[1px] active:translate-y-[1px]"
                  title={t("copyMessage")}
                >
                  {copiedIndex === idx ? (
                    <Check className="w-4 h-4 text-green-600" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
                {isLast && (
                  <button
                    onClick={() => onRegenerate(idx)}
                    className="p-2 rounded-lg border-2 border-[var(--border-light)] text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)] transition-colors bg-[var(--bg-panel)] shadow-[2px_2px_0_var(--border-light)] active:shadow-none active:translate-x-[1px] active:translate-y-[1px]"
                    title={t("regenerateResponse")}
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                )}
              </div>

              {settings.showMetrics && displayMsg.metrics && (
                <MetricsFooter metrics={displayMsg.metrics} t={t} />
              )}
            </div>
          )}

          {msg.role === "user" && !isEditing && (
            <div className="flex items-center space-x-3 text-[var(--text-muted)] font-bold text-xs select-none mt-1">
              <button
                onClick={() => {
                  setIsEditing(true);
                  setEditContent(text);
                }}
                className="p-1 hover:text-[var(--text-main)] transition-colors"
                title={t("edit")}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            </div>
          )}

          {msg.role === "assistant" && totalVersions > 1 && (
            <div className="flex items-center space-x-3 text-[var(--text-muted)] font-bold text-xs select-none mt-1">
              <button
                onClick={() => onSwitchVersion(idx, currentVersionIndex - 1)}
                disabled={currentVersionIndex <= 0}
                className="p-1 hover:text-[var(--text-main)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4 rotate-180" />
              </button>
              <span className="tabular-nums tracking-tighter">
                {currentVersionNum} / {totalVersions}
              </span>
              <button
                onClick={() => onSwitchVersion(idx, currentVersionIndex + 1)}
                disabled={currentVersionNum >= totalVersions}
                className="p-1 hover:text-[var(--text-main)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </motion.div>
    );
  },
  (prev, next) => {
    return (
      prev.msg === next.msg &&
      prev.idx === next.idx &&
      prev.isGenerating === next.isGenerating &&
      prev.isLast === next.isLast &&
      prev.copiedIndex === next.copiedIndex &&
      prev.settings === next.settings
    );
  },
);

export default function ChatScreen({
  model,
  chat,
  onSendMessage,
  onRegenerate,
  onSwitchVersion,
  onEditMessage,
  onStopGeneration,
  onContinueGeneration,
  onDismissOutOfContext,
  onSelectModel,
  onOpenSettings,
  onNewChat,
  settings,
  onUpdateSettings,
}: ChatScreenProps) {
  const t = useCallback(
    (key: string) =>
      translations[settings.language]?.[key] || translations["en"][key] || key,
    [settings.language],
  );

  const draftKey = `draft_${chat.id}`;
  const [input, setInput] = useState(
    () => localStorage.getItem(draftKey) || "",
  );
  const [loadedDraftKey, setLoadedDraftKey] = useState(draftKey);

  if (loadedDraftKey !== draftKey) {
    setLoadedDraftKey(draftKey);
    setInput(localStorage.getItem(draftKey) || "");
  }

  useEffect(() => {
    const handle = setTimeout(() => {
      writeLocalStorage(draftKey, input);
    }, 300);
    return () => clearTimeout(handle);
  }, [input, draftKey]);

  // Loading the model is the slow part of the first reply. Starting it the
  // moment there is something typed — rather than waiting for send — hides
  // that load behind however long composing the message actually takes.
  // Re-armed once the box is empty again, so a model whose keep-alive has
  // since lapsed gets warmed again next time.
  const warmedForModelRef = useRef<string | null>(null);
  useEffect(() => {
    if (!input.trim()) {
      warmedForModelRef.current = null;
      return;
    }
    if (warmedForModelRef.current === model || isCloudModel(model)) return;
    warmedForModelRef.current = model;
    warmModel(model, KEEP_ALIVE).catch(() => undefined);
  }, [input, model]);

  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<Attachment[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [micState, setMicState] = useState<
    "idle" | "recording" | "loading" | "transcribing"
  >("idle");
  const [micDetail, setMicDetail] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const [lastSlashQuery, setLastSlashQuery] = useState<string | null>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const [probedModel, setProbedModel] = useState<{
    model: string;
    info: ModelInfo | null;
  }>({ model, info: null });
  const [installedModels, setInstalledModels] = useState<InstalledModel[]>([]);

  const modelInfo = probedModel.model === model ? probedModel.info : null;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isAtBottom = useRef(true);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const preload = (
      SyntaxHighlighter as unknown as { preload?: () => Promise<unknown> }
    ).preload;
    if (!preload) return;
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => preload());
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(preload, 2000);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const probe = (attempt: number) => {
      getModelInfo(model).then((info) => {
        if (cancelled) return;
        if (info) setProbedModel({ model, info });
        else if (attempt < 5)
          timer = setTimeout(() => probe(attempt + 1), 3000);
      });
    };
    probe(0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [model]);

  useEffect(() => {
    if (!isModelMenuOpen) return;
    let cancelled = false;
    listInstalledModels()
      .then((models) => {
        if (!cancelled) setInstalledModels(selectableModels(models));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isModelMenuOpen]);

  useEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }, [input]);

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } =
      scrollContainerRef.current;
    isAtBottom.current = scrollHeight - scrollTop - clientHeight < 100;
  };

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    if (isAtBottom.current) {
      messagesEndRef.current?.scrollIntoView({ behavior });
    }
  };

  useEffect(() => {
    scrollToBottom(chat.isGenerating ? "auto" : "smooth");
  }, [chat.messages, chat.isGenerating]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        modelMenuRef.current &&
        !modelMenuRef.current.contains(event.target as Node)
      ) {
        setIsModelMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      await processFiles(Array.from(files));
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    let hasFiles = false;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === "file") {
        const file = items[i].getAsFile();
        if (file) {
          files.push(file);
          hasFiles = true;
        }
      }
    }
    if (hasFiles) {
      e.preventDefault();
      await processFiles(files);
    }
  };

  const processFiles = async (files: File[]) => {
    const accepted: Attachment[] = [];
    const rejected: string[] = [];

    for (const file of files) {
      const extension = file.name.split(".").pop()?.toLowerCase() || "";
      const isImage =
        file.type.startsWith("image/") || IMAGE_EXTENSIONS.includes(extension);

      try {
        if (isImage && !visionSupported) {
          rejected.push(`${file.name} - ${t("visionUnsupported")}`);
          continue;
        }

        if (!isImage && !acceptedExtensions.includes(extension)) {
          rejected.push(`${file.name} - ${t("unsupportedFile")}`);
          continue;
        }

        if (isImage) {
          if (file.size > MAX_IMAGE_BYTES) {
            rejected.push(`${file.name} - ${t("fileTooLarge")}`);
            continue;
          }

          if (!(await canDecodeImage(file))) {
            rejected.push(`${file.name} - ${t("unreadableImage")}`);
            continue;
          }

          accepted.push({
            name: file.name,
            type: file.type || `image/${extension || "png"}`,
            content: await readDataUrl(file),
          });
          continue;
        }

        if (DOCUMENT_EXTENSIONS.includes(extension)) {
          if (file.size > MAX_DOCUMENT_BYTES) {
            rejected.push(`${file.name} - ${t("fileTooLarge")}`);
            continue;
          }

          const bytes = new Uint8Array(await file.arrayBuffer());
          const parsed = await window.electronAPI?.readDocument(
            file.name,
            bytes,
          );

          if (!parsed?.success || !parsed.text) {
            rejected.push(`${file.name} - ${t("unsupportedFile")}`);
            continue;
          }

          accepted.push({
            name: file.name,
            type: file.type || "application/octet-stream",
            content: parsed.text,
          });
          continue;
        }

        if (file.size > MAX_TEXT_FILE_BYTES) {
          rejected.push(`${file.name} - ${t("fileTooLarge")}`);
          continue;
        }

        const content = await file.text();
        if (isBinary(content)) {
          rejected.push(`${file.name} - ${t("unsupportedFile")}`);
          continue;
        }

        accepted.push({
          name: file.name,
          type: file.type || "text/plain",
          content,
        });
      } catch {
        rejected.push(`${file.name} - ${t("unsupportedFile")}`);
      }
    }

    if (accepted.length > 0) {
      setAttachedFiles((prev) => [...prev, ...accepted]);
    }
    setFileErrors(rejected);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    await processFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  useEffect(() => {
    return () => recorderRef.current?.cancel();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isModelMenuOpen) setIsModelMenuOpen(false);
        else if (chat.isGenerating) onStopGeneration();
        return;
      }

      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();

      if (key === "k") {
        event.preventDefault();
        setIsModelMenuOpen((open) => !open);
      } else if (key === "n") {
        event.preventDefault();
        onNewChat();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isModelMenuOpen, chat.isGenerating, onStopGeneration, onNewChat]);

  const handleMicClick = async () => {
    if (micState === "loading" || micState === "transcribing") return;

    if (micState === "recording") {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (!recorder) {
        setMicState("idle");
        return;
      }

      setMicState("transcribing");
      setMicDetail("");
      try {
        const audio = await recorder.stop();
        const text = await transcribe(audio, (progress) => {
          setMicState("loading");
          setMicDetail(`${Math.round(progress.percent)}%`);
        });
        if (text) {
          setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
          inputRef.current?.focus();
        }
      } catch (err) {
        setFileErrors([
          err instanceof Error ? err.message : t("micUnavailable"),
        ]);
      } finally {
        setMicState("idle");
        setMicDetail("");
      }
      return;
    }

    try {
      recorderRef.current = await startRecording();
      setMicState("recording");
    } catch {
      setFileErrors([t("micUnavailable")]);
      setMicState("idle");
    }
  };

  const runSlashCommand = (id: string) => {
    setInput("");
    if (id === "new") onNewChat();
    else if (id === "model") setIsModelMenuOpen(true);
    else if (id === "settings") onOpenSettings("appearance");
    else if (id === "files") fileInputRef.current?.click();
    else if (id === "voice") handleMicClick();
    else if (id === "web") {
      onUpdateSettings({ ...settings, webMode: nextWebMode(settings.webMode) });
    } else if (id === "think") {
      onUpdateSettings({
        ...settings,
        thinkingMode: nextThinkingMode(settings.thinkingMode),
      });
    } else if (id === "code") {
      onUpdateSettings({ ...settings, codeExecution: !settings.codeExecution });
    }
  };

  useEffect(() => {
    if (fileErrors.length === 0) return;
    const handle = setTimeout(() => setFileErrors([]), 6000);
    return () => clearTimeout(handle);
  }, [fileErrors]);

  const removeFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (chat.isGenerating) {
      onStopGeneration();
      return;
    }

    let sanitizedInput = input.trim();
    if (isBinary(sanitizedInput)) {
      sanitizedInput = "[Invalid text input removed]";
    }

    if (!sanitizedInput && attachedFiles.length === 0) return;

    onSendMessage(sanitizedInput, attachedFiles);
    setInput("");
    localStorage.removeItem(draftKey);
    setAttachedFiles([]);
    setFileErrors([]);
    isAtBottom.current = true;
  };

  const copyToClipboard = useCallback((text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  }, []);

  const greeting = useMemo(
    () => pickGreeting(settings.language, chat.id),
    [settings.language, chat.id],
  );

  const messageChars = useMemo(
    () =>
      chat.messages.reduce((acc, m) => {
        const msgLen = Math.max(
          m.content?.length || 0,
          m.textContent?.length || 0,
        );
        return acc + msgLen + (m.attachments?.length || 0) * 4000;
      }, 0),
    [chat.messages],
  );

  const measuredTokens = useMemo(() => {
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const message = chat.messages[i];
      if (message.role !== "assistant") continue;

      const versionIndex = message.currentVersionIndex;
      const active =
        message.versions && versionIndex !== undefined && versionIndex < message.versions.length
          ? message.versions[versionIndex]
          : message;

      if (active.metrics) {
        return active.metrics.promptTokens + active.metrics.responseTokens;
      }
    }
    return null;
  }, [chat.messages]);

  const draftChars = input.length + attachedFiles.length * 4000;

  const contextUse = describeContextUse({
    measuredTokens,
    draftChars,
    historyChars: messageChars,
    maxContext: modelInfo?.contextLength ?? null,
  });

  const estimatedTokens = contextUse.usedTokens;
  const maxTokens = contextUse.windowTokens;
  const formattedUsedTokens =
    estimatedTokens === 0
      ? "0"
      : estimatedTokens < 1000
        ? estimatedTokens.toString()
        : (estimatedTokens / 1000).toFixed(1) + "k";
  const maxTokensK =
    maxTokens >= 1000 ? `${Math.round(maxTokens / 1000)}k` : String(maxTokens);
  const rawPercent = contextUse.percent;
  const percentUsed =
    estimatedTokens === 0
      ? "0"
      : Math.min(100, rawPercent).toFixed(rawPercent < 1 ? 2 : 1);
  const showContextBar = rawPercent >= 60;
  const contextTone =
    rawPercent >= 95
      ? "#ef4444"
      : rawPercent >= 80
        ? "#f59e0b"
        : "var(--text-muted)";
  const supportsNativeThinking = Boolean(
    modelInfo?.capabilities.includes("thinking"),
  );

  const toolsAreGuesswork = needsTextModeTools(modelInfo);

  const toolWarning = toolsAreGuesswork
    ? `${model} ${t("toolsNotNative")}`
    : "";
  const speechSupported = isSpeechSupported();
  const documentsSupported = Boolean(window.electronAPI);
  const codeExecutionSupported = Boolean(window.electronAPI?.runner);
  const visionSupported =
    modelInfo === null || modelInfo.capabilities.includes("vision");

  const acceptedExtensions = [
    ...TEXT_EXTENSIONS,
    ...(documentsSupported ? DOCUMENT_EXTENSIONS : []),
    ...(visionSupported ? IMAGE_EXTENSIONS : []),
  ];
  const acceptAttribute = acceptedExtensions
    .map((extension) => "." + extension)
    .join(",");

  const slashQuery =
    input.startsWith("/") && !/\s/.test(input)
      ? input.slice(1).toLowerCase()
      : null;
  const slashMatches =
    slashQuery === null
      ? []
      : SLASH_COMMANDS.filter((command) => command.id.startsWith(slashQuery));

  if (lastSlashQuery !== slashQuery) {
    setLastSlashQuery(slashQuery);
    setSlashIndex(0);
  }

  const activeSlashIndex = Math.min(
    slashIndex,
    Math.max(slashMatches.length - 1, 0),
  );

  return (
    <div
      className="w-full h-full flex flex-col bg-[var(--bg-base)] relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-blue-500/20 backdrop-blur-sm flex items-center justify-center border-4 border-dashed border-blue-500 m-4 rounded-3xl pointer-events-none"
          >
            <div className="flex flex-col items-center space-y-4">
              <FileUp className="w-20 h-20 text-blue-500 animate-bounce" />
              <p className="text-2xl font-bold text-blue-500 uppercase tracking-widest">
                {t("dropFiles")}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pt-2 drag-region h-6 flex-shrink-0 w-full z-10" />

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-6 space-y-6 pt-10"
      >
        {chat.messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)] space-y-4">
            <Logo className="w-24 h-24 opacity-40" />
            <TypedGreeting
              key={greeting}
              text={greeting}
              className="text-xl font-bold uppercase tracking-wider"
            />
          </div>
        )}

        {chat.messages.map((msg, idx) => (
          <ErrorBoundary key={msg.id}>
            <MessageItem
              msg={msg}
              idx={idx}
              isGenerating={chat.isGenerating}
              isLast={idx === chat.messages.length - 1}
              onRegenerate={onRegenerate}
              onSwitchVersion={onSwitchVersion}
              copiedIndex={copiedIndex}
              copyToClipboard={copyToClipboard}
              settings={settings}
              onEditMessage={onEditMessage}
            />
          </ErrorBoundary>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-6 bg-[var(--bg-base)] border-t-[3px] border-[var(--border-light)] shadow-[0_-4px_0_var(--border-light)] z-10">
        <div className="max-w-5xl mx-auto relative">
          {slashMatches.length > 0 && (
            <div className="absolute bottom-full mb-2 left-0 right-0 ui-box p-2 z-40 flex flex-col gap-1">
              {slashMatches.map((command, index) => (
                <button
                  key={command.id}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    runSlashCommand(command.id);
                  }}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                    index === activeSlashIndex
                      ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                      : "hover:bg-[var(--hover-bg)]"
                  }`}
                >
                  <span className="font-mono text-xs font-bold">
                    /{command.id}
                  </span>
                  <span className="text-[11px] font-bold opacity-70">
                    {t(command.label)}
                  </span>
                </button>
              ))}
            </div>
          )}

          <form onSubmit={handleSubmit} className="composer">
            <div className="overflow-hidden rounded-t-[9px] flex-shrink-0">
              {showContextBar && (
                <div className="h-1 w-full bg-[var(--hover-bg)] flex-shrink-0">
                  <div
                    className="h-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, rawPercent)}%`,
                      backgroundColor: contextTone,
                    }}
                  />
                </div>
              )}

              {chat.isOutOfContext && (
                <div className="flex items-center gap-3 px-4 py-2.5 border-b-2 border-[var(--border-light)] bg-[var(--hover-bg)]">
                  <Brain className="w-4 h-4 flex-shrink-0 text-amber-500" />
                  <p className="flex-1 min-w-0 text-xs font-bold">
                    {t("outOfContextMessage")}
                  </p>
                  <button
                    type="button"
                    onClick={onContinueGeneration}
                    className="px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-[var(--bg-inverted)] text-[var(--text-inverted)] hover:opacity-90 transition-opacity flex-shrink-0"
                  >
                    {t("continueGenerating")}
                  </button>
                  <button
                    type="button"
                    onClick={onDismissOutOfContext}
                    className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors flex-shrink-0"
                    title={t("cancel")}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={handlePaste}
              onDrop={handleDrop}
              onKeyDown={(e) => {
                if (slashMatches.length > 0) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSlashIndex((i) => (i + 1) % slashMatches.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSlashIndex(
                      (i) => (i - 1 + slashMatches.length) % slashMatches.length,
                    );
                    return;
                  }
                  if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                    e.preventDefault();
                    runSlashCommand(slashMatches[activeSlashIndex].id);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setInput("");
                    return;
                  }
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={`${t("messageModel")} ${model}...`}
              className="w-full bg-transparent px-5 pt-4 pb-2 text-[var(--text-main)] placeholder-[var(--text-muted)] font-bold resize-none overflow-y-auto focus:outline-none"
              rows={1}
              style={{ minHeight: "56px", maxHeight: `${MAX_INPUT_HEIGHT}px` }}
            />

            {fileErrors.length > 0 && (
              <div className="px-4 pb-2 flex flex-wrap gap-2">
                {fileErrors.map((message) => (
                  <span
                    key={message}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border-2 border-red-500/40 bg-red-500/10 text-red-500 text-[10px] font-bold"
                  >
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                    {message}
                  </span>
                ))}
              </div>
            )}

            {attachedFiles.length > 0 && (
              <div className="px-4 pb-2 flex flex-wrap gap-2">
                {attachedFiles.map((file, idx) => (
                  <span
                    key={idx}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border-2 border-[var(--border-light)] bg-[var(--bg-panel)] text-[10px] font-bold"
                  >
                    {file.type.startsWith("image/") ? (
                      <ImageIcon className="w-3 h-3 flex-shrink-0" />
                    ) : (
                      <FileText className="w-3 h-3 flex-shrink-0" />
                    )}
                    <span className="truncate max-w-[140px]">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      className="text-[var(--text-muted)] hover:text-red-500 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center gap-1 px-3 pb-3 pt-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="composer-pill"
                title={t("addFiles")}
              >
                <Plus className="w-4 h-4" />
              </button>
              <input
                type="file"
                multiple
                accept={acceptAttribute}
                ref={fileInputRef}
                className="hidden"
                onChange={handleFileChange}
              />

              {speechSupported && (
                <button
                  type="button"
                  onClick={handleMicClick}
                  disabled={
                    micState === "loading" || micState === "transcribing"
                  }
                  className={`composer-pill disabled:cursor-not-allowed ${
                    micState === "recording" ? "!bg-red-500 !text-white" : ""
                  }`}
                  title={t("voiceInput")}
                >
                  {micState === "recording" ? (
                    <MicOff className="w-4 h-4" />
                  ) : micState === "idle" ? (
                    <Mic className="w-4 h-4" />
                  ) : (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  )}
                  {micState === "recording" && t("listening")}
                  {micState === "loading" &&
                    `${t("loadingSpeechModel")} ${micDetail}`}
                  {micState === "transcribing" && t("transcribing")}
                </button>
              )}

              <button
                type="button"
                onClick={() =>
                  onUpdateSettings({
                    ...settings,
                    thinkingMode: nextThinkingMode(settings.thinkingMode),
                  })
                }
                className="composer-pill"
                title={
                  supportsNativeThinking
                    ? t("thinkingMode")
                    : `${t("thinkingMode")} (${t("promptBased")})`
                }
              >
                <Brain className="w-3.5 h-3.5 flex-shrink-0" />
                {t(settings.thinkingMode)}
              </button>

              <button
                type="button"
                onClick={() =>
                  onUpdateSettings({
                    ...settings,
                    webMode: nextWebMode(settings.webMode),
                  })
                }
                className={`composer-pill ${
                  settings.webMode === "on"
                    ? "!bg-[var(--bg-inverted)] !text-[var(--text-inverted)]"
                    : settings.webMode === "off"
                      ? "opacity-50"
                      : ""
                }`}
                title={
                  toolWarning && settings.webMode !== "off"
                    ? `${t("webSearch")} — ${toolWarning}`
                    : t("webSearch")
                }
              >
                {settings.webMode !== "off" && toolsAreGuesswork ? (
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-amber-500" />
                ) : (
                  <Globe className="w-3.5 h-3.5 flex-shrink-0" />
                )}
                {t(WEB_MODE_LABELS[settings.webMode])}
              </button>

              {codeExecutionSupported && (
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSettings({
                      ...settings,
                      codeExecution: !settings.codeExecution,
                    })
                  }
                  className={`composer-pill ${
                    settings.codeExecution
                      ? "!bg-[var(--bg-inverted)] !text-[var(--text-inverted)]"
                      : "opacity-50"
                  }`}
                  title={
                    toolWarning
                      ? `${t("codeExecution")} — ${toolWarning}`
                      : t("codeExecution")
                  }
                >
                  {settings.codeExecution && toolsAreGuesswork ? (
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-amber-500" />
                  ) : (
                    <Terminal className="w-3.5 h-3.5 flex-shrink-0" />
                  )}
                  {t("runCode")}
                </button>
              )}

              <div className="flex-1" />

              <div className="relative" ref={modelMenuRef}>
                <button
                  type="button"
                  onClick={() => setIsModelMenuOpen(!isModelMenuOpen)}
                  className="composer-pill max-w-[190px]"
                >
                  <Cpu className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">{model}</span>
                  <ChevronRight
                    className={`w-3 h-3 flex-shrink-0 transition-transform ${
                      isModelMenuOpen ? "rotate-90" : "-rotate-90"
                    }`}
                  />
                </button>

                <AnimatePresence>
                  {isModelMenuOpen && (
                    <motion.div
                      key="model-menu"
                      initial={{ opacity: 0, y: 8, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.97 }}
                      className="absolute bottom-[42px] right-0 w-72 ui-box p-3 z-50 flex flex-col gap-2"
                    >
                      <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                        {installedModels.length === 0 ? (
                          <p className="text-[11px] font-bold text-[var(--text-muted)] px-1 py-1">
                            {t("noModelsFound")}
                          </p>
                        ) : (
                          installedModels.map((entry) => (
                            <button
                              key={entry.name}
                              type="button"
                              onClick={() => {
                                onSelectModel(entry.name);
                                setIsModelMenuOpen(false);
                              }}
                              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                                entry.name === model
                                  ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                                  : "hover:bg-[var(--hover-bg)]"
                              }`}
                            >
                              <span className="flex-1 min-w-0 truncate text-[11px] font-bold">
                                {entry.name}
                              </span>
                              {entry.parameterSize && (
                                <span className="text-[9px] font-bold opacity-60 flex-shrink-0">
                                  {entry.parameterSize}
                                </span>
                              )}
                              {entry.name === model && (
                                <Check className="w-3.5 h-3.5 flex-shrink-0" />
                              )}
                            </button>
                          ))
                        )}
                      </div>

                      {modelInfo && modelInfo.capabilities.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {MODEL_CAPABILITIES.filter((c) =>
                            modelInfo.capabilities.includes(c.id),
                          ).map((c) => (
                            <span
                              key={c.id}
                              className="px-1.5 py-0.5 rounded border border-[var(--border-light)] text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)]"
                            >
                              {t(c.label)}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="h-[2px] bg-[var(--border-light)] w-full" />

                      <div className="flex items-center justify-between text-[10px] font-bold text-[var(--text-muted)]">
                        <span className="uppercase tracking-wider">
                          {t("contextUsed")}
                        </span>
                        <span className="tabular-nums">
                          {percentUsed}% &bull; {formattedUsedTokens} /{" "}
                          {maxTokensK}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setIsModelMenuOpen(false);
                          onOpenSettings("models");
                        }}
                        className="w-full text-left px-2 py-1.5 rounded-lg text-[11px] font-bold hover:bg-[var(--hover-bg)] transition-colors"
                      >
                        {t("manageModels")}
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <button
                type="submit"
                disabled={
                  !input.trim() &&
                  attachedFiles.length === 0 &&
                  !chat.isGenerating
                }
                className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-[var(--bg-inverted)] text-[var(--text-inverted)] hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
              >
                {chat.isGenerating ? (
                  <Square className="w-4 h-4 fill-current" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
