import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Button, EmberCaret, Icon, Spark, type IconName } from "../ui";
import ReactMarkdown from "react-markdown";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-async";
import { SYNTAX_THEME } from "./syntaxTheme";
import { hostnameOf, hueFor, siteLabel } from "../utils";
import { INLINE_COMPONENTS, REHYPE_PLUGINS, REMARK_PLUGINS } from "./markdown";
import AppFrame from "./AppFrame";
import { displayModelName } from "../llama";
import UnifiedDiff from "./UnifiedDiff";
import { diffStats } from "../project/gitView";
import ApprovalCard from "./ApprovalCard";
import QuestionCard from "./QuestionCard";
import { useTranscriptView } from "./transcriptView";
import { OpenFileContext } from "./openFileContext";
import { OpenDiffContext } from "./openDiffContext";
import DiffBlock from "./DiffBlock";
import { FilePreview } from "./FilePreview";
import ImageCard from "./ImageCard";
import { loadLabel, type LoadStage } from "./loadLabel";
import type { ApprovalAnswer, SearchStep } from "../types";

const STEP_ICONS: Partial<Record<SearchStep["type"], IconName>> = {
  searching: "magnifying-glass",
  opening: "magnifying-glass",
  results: "globe-simple",
  reading: "file-text",
  navigating: "arrow-square-out",
  loaded: "check",
  scanned: "scan",
  clicking: "cursor-click",
  typing: "text-aa",
  library: "books",
  run_code: "terminal",
  command: "terminal-window",
  plan: "check-circle",
  extension: "puzzle-piece",
  // The same book as the Skills tab, so a loaded skill never reads as a web search.
  skill: "book-open",
  edit_file: "pencil-simple",
  git: "git-branch",
};

function LibraryHits({
  hits,
  t,
}: {
  hits: NonNullable<SearchStep["libraryHits"]>;
  t: (key: string) => string;
}) {
  return (
    <div className="flex flex-col ps-6 mt-1">
      {hits.map((hit, index) => (
        <button
          key={index}
          onClick={() => window.electronAPI?.openFile?.(hit.path)}
          title={hit.path}
          className="flex items-center gap-2 h-8 px-2 rounded-xs hover:bg-surface-raised text-start"
        >
          <Icon name="file-text" size={14} className="flex-shrink-0 text-text-secondary" />
          <span className="font-mono text-[12px] text-text-primary truncate flex-1 min-w-0">{hit.name}</span>
          <span className="text-[12px] tabular-nums text-text-secondary flex-shrink-0">
            {(hit.score * 100).toFixed(0)}% {t("match")}
          </span>
        </button>
      ))}
    </div>
  );
}

// A diff git printed, folded until the user wants it.
function GitDiffOutput({ diff, t }: { diff: string; t: (key: string) => string }) {
  const { added, removed } = diffStats(diff);
  const verbose = useTranscriptView() === "verbose";

  return (
    <details className="ps-6 mt-1" open={verbose}>
      <summary className="cursor-pointer text-[12px] text-text-secondary hover:text-text-primary">
        {t("gitShowDiff")}{" "}
        <span className="text-ok tabular-nums">+{added}</span>{" "}
        <span className="text-danger tabular-nums">-{removed}</span>
      </summary>
      <div className="mt-2">
        <UnifiedDiff diff={diff} />
      </div>
    </details>
  );
}

function CodeRunOutput({ step, t }: { step: SearchStep; t: (key: string) => string }) {
  const hasOutput = Boolean(step.stdout || step.stderr);
  if (!hasOutput) return null;

  return (
    <div className="ps-6 mt-1 space-y-2">
      {step.stdout && (
        <pre className="p-3 rounded-sm border border-rule bg-surface-base font-mono text-[12px] leading-5 text-text-primary overflow-x-auto whitespace-pre-wrap break-words max-h-64">
          {step.stdout}
        </pre>
      )}
      {step.stderr && (
        <pre className="p-3 rounded-sm border border-rule bg-surface-base font-mono text-[12px] leading-5 text-danger overflow-x-auto whitespace-pre-wrap break-words max-h-64">
          <span className="block mb-1 font-sans text-text-secondary">
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

// Offers document vs source view only when format has meaningful markup rendering.
const PREVIEWABLE_EXTENSIONS = new Set([
  "docx", "doc", "pdf",
  "pptx", "ppt",
  "xlsx", "xls", "csv",
  "md", "markdown", "mdx",
  "html", "htm",
]);

// Matches typing speed across file sizes so large cards reveal at a readable pace.
const FILE_REVEAL_MS = 1600;
const FILE_FRAME_MS = 1000 / 60;

function FileCard({
  step,
  animate,
  onRevert,
  isReverted,
  t,
}: {
  step: SearchStep;
  animate: boolean;
  onRevert?: (checkpointId: number) => void;
  isReverted: boolean;
  t: (key: string) => string;
}) {
  const content = step.fileContent || "";
  const extension = step.filename?.split(".").pop()?.toLowerCase() || "";
  const isCode = CODE_EXTENSIONS.has(extension);
  const canToggle = PREVIEWABLE_EXTENSIONS.has(extension);
  const [viewMode, setViewMode] = useState<"preview" | "source">("preview");

  const [revealed, setRevealed] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // A file already on screen from an earlier reply is shown whole.
    if (!animate || content.length === 0) return;

    const perFrame = Math.max(
      1,
      Math.ceil(content.length / (FILE_REVEAL_MS / FILE_FRAME_MS)),
    );

    let shown = 0;
    let frame = 0;

    const tick = () => {
      shown = Math.min(content.length, shown + perFrame);
      setRevealed(shown);
      if (shown < content.length) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animate, content]);

  // Status follows the step only; the typewriter reveal must not keep the card "Writing…".
  const writing = !step.isComplete;
  // For previewable documents, show preview both while writing and when complete (unless user chose source).
  // For non-previewable files (code/text), show the streaming editor while writing, then windowed preview when complete.
  const showingPreview = canToggle ? viewMode === "preview" : !writing;
  const shown = writing || !animate
    ? content
    : content.slice(0, Math.min(revealed, content.length));

  const isScrolledToBottom = useRef(true);

  const handleBodyScroll = () => {
    const body = bodyRef.current;
    if (!body) return;
    const distance = body.scrollHeight - body.scrollTop - body.clientHeight;
    isScrolledToBottom.current = distance <= 24;
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.deltaY < 0) {
      isScrolledToBottom.current = false;
    }
  };

  useEffect(() => {
    if (!writing || !isScrolledToBottom.current) return;
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [shown, writing]);

  const lineCount = content ? content.split("\n").length : 0;

  const CodeWithCaret = useCallback(
    ({ children, ...props }: React.HTMLProps<HTMLElement>) => (
      <code {...props}>
        {children}
        {writing && <EmberCaret className="ms-0.5 inline-block align-middle" />}
      </code>
    ),
    [writing],
  );

  return (
    <div className="mb-4 border border-rule rounded-md overflow-hidden bg-surface-base w-full">
      <div className="flex items-center justify-between gap-3 h-11 ps-3 pe-2 border-b border-rule">
        <div className="flex items-center gap-2 min-w-0">
          <Icon name={isCode ? "file-code" : "file"} size={16} className="flex-shrink-0 text-text-secondary" />
          <span className="font-mono text-[13px] text-text-primary truncate">
            {step.filename || t("untitledFile")}
          </span>
          <span className="flex items-center gap-1.5 text-[12px] text-text-secondary whitespace-nowrap">
            {writing ? (
              <>
                <Spark />
                {t("writingFile")}
              </>
            ) : (
              <>
                {t("fileCreated")}
                {lineCount > 0 ? ` · ${lineCount} ${t("lines")}` : ""}
              </>
            )}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {canToggle && (
            <div className="flex rounded-pill border border-rule p-0.5 text-[12px]">
              {(["preview", "source"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={viewMode === mode}
                  onClick={() => setViewMode(mode)}
                  className={`h-6 px-2.5 rounded-pill transition-colors ${
                    viewMode === mode ? "bg-surface-raised text-text-primary" : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {t(mode)}
                </button>
              ))}
            </div>
          )}

          {step.filepath && !writing && (
            <Button
              variant="ghost"
              size="dense"
              icon={<Icon name="arrow-square-out" size={14} />}
              onClick={() => window.electronAPI?.openFile?.(step.filepath!)}
            >
              {t("openFile")}
            </Button>
          )}

          {step.checkpointId !== undefined && onRevert && !writing && (
            <Button
              variant="ghost"
              size="dense"
              disabled={isReverted}
              onClick={() => onRevert(step.checkpointId as number)}
            >
              {isReverted ? t("changeUndone") : t("undoChange")}
            </Button>
          )}
        </div>
      </div>

      <div
        ref={bodyRef}
        onScroll={handleBodyScroll}
        onWheel={handleWheel}
        className={`p-0 w-full relative ${
          showingPreview ? "" : "max-h-[320px] overflow-y-auto"
        } ${
          "bg-surface-base"
        }`}
      >
        {showingPreview ? (
          <FilePreview
            filename={step.filename || "file.txt"}
            content={shown}
            t={t}
            isWriting={writing}
          />
        ) : isCode ? (
          <div className="relative">
            <SyntaxHighlighter
              language={extension || "javascript"}
              style={SYNTAX_THEME}
              customStyle={{
                margin: 0,
                padding: "1rem",
                background: "transparent",
                fontSize: "13px",
              }}
              wrapLines
              wrapLongLines
              CodeTag={CodeWithCaret}
            >
              {shown}
            </SyntaxHighlighter>
          </div>
        ) : (
          <pre className="m-0 p-4 font-mono text-[13px] leading-5 text-text-primary whitespace-pre-wrap break-words">
            {shown}
            {writing && <EmberCaret className="ms-0.5 inline-block align-middle" />}
          </pre>
        )}
      </div>
    </div>
  );
}

// Shows the steps of a wait as the engine reports them: nothing here is estimated.
function LoadingStep({ step, t }: { step: SearchStep; t: (key: string) => string }) {
  const [now, setNow] = useState(() => Date.now());
  const [stage, setStage] = useState<LoadStage | null>(null);

  // The engine's own log says which part of the wait it is in.
  useEffect(() => {
    if (!step.model) return;
    return window.electronAPI?.gguf?.onStage?.(setStage);
  }, [step.model]);

  useEffect(() => {
    if (!step.retry) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [step.retry]);

  const label = step.retry
    ? t("providerRetrying")
        .replace("{seconds}", String(Math.max(0, Math.ceil((step.retry.until - now) / 1000))))
        .replace("{attempt}", String(step.retry.attempt))
        .replace("{of}", String(step.retry.of))
    : step.model
      ? loadLabel(stage, { model: displayModelName(step.model), extending: step.extending, t })
      : step.content;

  return (
    <div className="flex items-center gap-2 h-7 mb-2 text-[13px] text-text-secondary">
      <Spark />
      <span className="tabular-nums">{label}</span>
    </div>
  );
}

// Hostname-based icon or fallback letter to protect user privacy.
function SiteBadge({ hostname }: { hostname: string }) {
  const label = siteLabel(hostname);
  const hue = hueFor(label);

  // Tracks host errors so reused rows retry instead of sticking to missing icons.
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
      className="w-5 h-5 rounded-sm flex-shrink-0 mt-0.5 flex items-center justify-center text-[10px] font-semibold select-none"
      style={{
        backgroundColor: `hsl(${hue} 62% 46%)`,
        color: "white",
      }}
    >
      {label.slice(0, 1)}
    </span>
  );
}

export interface WorkBlockProps {
  step: SearchStep;
  live?: boolean;
  isGenerating?: boolean;
  isLast?: boolean;
  onApproval?: (approvalId: string, answer: ApprovalAnswer) => void;
  onRevert?: (checkpointId: number) => void;
  isReverted?: boolean;
  t: (key: string) => string;
}

export function WorkBlock({
  step,
  isGenerating = false,
  isLast = false,
  onApproval,
  onRevert,
  isReverted = false,
  t,
}: WorkBlockProps) {
  const verbose = useTranscriptView() === "verbose";
  const openInCanvas = useContext(OpenFileContext);
  const openDiff = useContext(OpenDiffContext);
  if (step.type === "results" && step.results && step.results.length > 0) {
    return (
      <details key={step.id} className="mb-2 group/results" open={verbose}>
        <summary className="flex items-center gap-2 min-h-7 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden text-[13px] text-text-secondary hover:text-text-primary">
          <Icon name="globe-simple" size={16} className="flex-shrink-0" />
          <span className="markdown-inline">
            <ReactMarkdown
              remarkPlugins={REMARK_PLUGINS}
              rehypePlugins={REHYPE_PLUGINS}
              components={INLINE_COMPONENTS}
            >
              {step.content}
            </ReactMarkdown>
          </span>
          <Icon name="caret-right" size={12} mirrored className="transition-transform group-open/results:rotate-90" />
        </summary>
        <div className="flex flex-col ps-6 mt-1">
          {step.results.map((result, rIdx) => {
            const hostname = hostnameOf(result.url);
            return (
              <a
                key={rIdx}
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 p-2 rounded-sm hover:bg-surface-raised group/link no-underline"
                onClick={(e) => {
                  e.preventDefault();
                  window.open(result.url, "_blank");
                }}
              >
                <SiteBadge hostname={hostname} />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] text-text-primary group-hover/link:underline truncate leading-5">
                    {result.title}
                  </p>
                  <p className="text-[12px] text-text-tertiary truncate">
                    {hostname}
                  </p>
                  {result.snippet && (
                    <p className="text-[13px] text-text-secondary mt-0.5 leading-5 line-clamp-2">
                      {result.snippet}
                    </p>
                  )}
                </div>
                <Icon name="arrow-square-out" size={14} className="text-text-tertiary flex-shrink-0 mt-0.5 opacity-0 group-hover/link:opacity-100 transition-opacity" />
              </a>
            );
          })}
        </div>
      </details>
    );
  }

  if (step.type === "question") {
    return <QuestionCard key={step.id} step={step} t={t} />;
  }

  if (step.type === "approval") {
    return (
      <ApprovalCard
        key={step.id}
        step={step}
        t={t}
        onAnswer={onApproval}
      />
    );
  }

  if (step.type === "app" && step.app) {
    return (
      <AppFrame
        key={step.id}
        serverId={step.app.serverId}
        html={step.app.html}
        t={t}
      />
    );
  }

  if (step.type === "image" && step.image) {
    return <ImageCard key={step.id} step={step} t={t} />;
  }

  if (step.type === "loading" && !step.isComplete) {
    return <LoadingStep key={step.id} step={step} t={t} />;
  }

  if (step.type === "create_file") {
    return (
      <FileCard
        key={step.id}
        step={step}
        animate={isGenerating && isLast}
        onRevert={onRevert}
        isReverted={isReverted}
        t={t}
      />
    );
  }

  const failed = step.type === "error";
  const isActive = !step.isComplete;
  // A file read or changed opens from its step; a folder listing has no file to open.
  const openable =
    !isActive && step.filepath && (step.type === "edit_file" || (step.type === "reading" && step.filename));
  const openStep = () =>
    openInCanvas ? openInCanvas(step.filepath!) : window.electronAPI?.openFile?.(step.filepath!);

  const payload =
    step.type === "library" && step.libraryHits?.length ? (
      <LibraryHits hits={step.libraryHits} t={t} />
    ) : step.type === "run_code" || step.type === "command" ? (
      <CodeRunOutput step={step} t={t} />
    ) : step.type === "git" && step.fileContent ? (
      <GitDiffOutput diff={step.fileContent} t={t} />
    ) : step.type === "edit_file" &&
      step.before !== undefined &&
      step.after !== undefined ? (
      <div className="ps-6 mt-1">
        <DiffBlock before={step.before} after={step.after} filePath={step.filepath} t={t} />
      </div>
    ) : null;

  return (
    <div key={step.id} className="mb-1">
      <div className="flex items-center gap-2 min-h-7 text-[13px] text-text-secondary">
        <span className="flex w-4 justify-center flex-shrink-0">
          <Icon
            name={failed ? "x-circle" : STEP_ICONS[step.type] || "globe-simple"}
            size={16}
            className={failed ? "text-danger" : ""}
          />
        </span>
        <span className={`markdown-inline min-w-0 ${isActive ? "" : "text-text-primary"}`}>
          <ReactMarkdown
            remarkPlugins={REMARK_PLUGINS}
            rehypePlugins={REHYPE_PLUGINS}
            components={INLINE_COMPONENTS}
          >
            {step.content}
          </ReactMarkdown>
        </span>

        {/* Failed step keeps original description so failure is explicit rather than silent. */}
        {failed && <span className="text-[12px] text-danger">{t("stepFailed")}</span>}

        <span className="ms-auto flex items-center gap-3 flex-shrink-0 ps-2">
          {openable && step.type === "edit_file" && openDiff && (
            <button
              type="button"
              onClick={() => openDiff(step.filepath)}
              title={step.filepath}
              className="text-[12px] text-text-secondary hover:text-text-primary underline-offset-2 hover:underline"
            >
              {t("openDiff")}
            </button>
          )}
          {openable && (
            <button
              type="button"
              onClick={openStep}
              title={step.filepath}
              className="text-[12px] text-text-secondary hover:text-text-primary underline-offset-2 hover:underline"
            >
              {t("openFile")}
            </button>
          )}
          {step.checkpointId !== undefined && onRevert && (
            <button
              type="button"
              onClick={() => onRevert(step.checkpointId as number)}
              disabled={isReverted}
              className="text-[12px] text-text-secondary hover:text-text-primary underline-offset-2 hover:underline disabled:no-underline disabled:text-text-tertiary"
            >
              {isReverted ? t("changeUndone") : t("undoChange")}
            </button>
          )}
          {isActive && <Spark />}
        </span>
      </div>
      {payload}
    </div>
  );
}
export default WorkBlock;
