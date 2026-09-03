import { Fragment, memo, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Blocks,
  Check,
  ChevronRight,
  Copy,
  Download,
  File,
  FileCode,
  FileText,
  Film,
  Globe,
  Library,
  Lightbulb,
  Loader2,
  MousePointer,
  Pencil,
  RefreshCw,
  Scan,
  Search,
  Send,
  Terminal,
  Type,
  User,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import Logo from "./../Logo";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-async";
import { atomDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { translations } from "./../translations";
import {
  hostnameOf,
  hueFor,
  normalizeMath,
  sanitizeContent,
  siteLabel,
} from "./../utils";
import {
  INLINE_COMPONENTS,
  MARKDOWN_COMPONENTS,
  REHYPE_PLUGINS,
  REMARK_PLUGINS,
} from "./markdown";
import type {
  AppSettings,
  Message,
  SearchStep,
  TurnMetrics,
} from "./../types";

/**
 * One message and all that hangs off it: steps, metrics, files, sites. The
 * `memo` is load-bearing, or every streamed token re-renders the whole chat.
 */

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
  extension: Blocks,
};

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
 * How long the reveal takes, whatever the size: a note types out, a document
 * scrolls past. Either way it ends together, so nobody is left watching.
 */
const FILE_REVEAL_MS = 1600;
const FILE_FRAME_MS = 1000 / 60;

/**
 * A file the model wrote, typed into the card. A tool call arrives whole, so
 * revealing it here is what turns a stuck-looking spinner into something read.
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
          <span
            className="inline-block w-2 h-4 bg-gray-300 align-middle animate-pulse"
            style={{ marginLeft: "1rem", marginBottom: "1rem" }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The badge beside a search result, drawn from the site name rather than
 * fetched, so nobody else learns which pages the user is looking at.
 */
/**
 * The site's icon, over `draggy://` since the renderer may not load remote
 * images. No icon or no network keeps the coloured letter rather than a gap.
 */
function SiteBadge({ hostname }: { hostname: string }) {
  const label = siteLabel(hostname);
  const hue = hueFor(label);

  // Which host failed, not whether one did, so a reused row tries again
  // instead of inheriting the last site's missing icon.
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
            <div className="flex flex-col w-full p-4 font-bold leading-relaxed wrap-anywhere max-w-full border-[3px] rounded-xl bg-[var(--bg-inverted)] text-[var(--text-inverted)] border-[var(--border-dark)] rounded-tr-none shadow-[4px_4px_0_var(--border-dark)]">
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
            /**
             * wrap-anywhere, not break-words: only `anywhere` reduces
             * min-content, so one enormous word cannot widen the whole chat.
             */
            <div
              className={
                msg.role === "user"
                  ? "p-4 font-bold leading-relaxed wrap-anywhere max-w-full border-[3px] rounded-xl bg-[var(--bg-inverted)] text-[var(--text-inverted)] border-[var(--border-dark)] rounded-tr-none shadow-[4px_4px_0_var(--border-dark)]"
                  : text === "" && steps.length === 0 && isGenerating && isLast
                    ? "p-3 px-4 rounded-2xl bg-[var(--bg-panel)] border-[3px] border-[var(--border-light)] w-fit"
                    : "p-4 font-bold leading-relaxed wrap-anywhere max-w-full border-[3px] rounded-xl bg-[var(--bg-panel)] text-[var(--text-main)] border-[var(--border-light)] rounded-tl-none shadow-[4px_4px_0_var(--border-light)] markdown-body"
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
export default MessageItem;
