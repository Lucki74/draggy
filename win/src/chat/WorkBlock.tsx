import { Fragment, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon, Spark } from "../ui";
import SiteBadge from "./SiteBadge";
import ResearchRunCard from "./ResearchRunCard";
import { fillComposer } from "./mentions";
import ReactMarkdown from "react-markdown";
import { hostnameOf } from "../utils";
import { INLINE_COMPONENTS, REHYPE_PLUGINS, REMARK_PLUGINS } from "./markdown";
import AppFrame from "./AppFrame";
import { displayModelName } from "../llama";
import UnifiedDiff from "./UnifiedDiff";
import { diffStats } from "../project/gitView";
import ApprovalCard from "./ApprovalCard";
import LiveArgs from "./LiveArgs";
import QuestionCard from "./QuestionCard";
import ResearchPlanCard from "./ResearchPlanCard";
import { useTranscriptView } from "./transcriptView";
import { OpenFileContext } from "./openFileContext";
import DiffBlock from "./DiffBlock";
import { RailContext, leadingSpaces } from "./railContext";
import { FilePreview } from "./FilePreview";
import ImageCard from "./ImageCard";
import { loadLabel, type LoadStage } from "./loadLabel";
import { stepTotals } from "./workSummary";
import { stepView, type StepView } from "./stepView";
import { TailBox } from "./LiveArgs";
import type { ApprovalAnswer, SearchStep } from "../types";

/** The state of a step: the ember spark while it runs, then a quiet filled dot, or a red cross.
 * One dot per step, never a check: a chain of green checks reads as noise. */
function StepMark({ active, failed }: { active: boolean; failed: boolean }) {
  // On a rail the rail draws the mark.
  if (useContext(RailContext)) return null;
  return (
    <span className="flex w-3 flex-shrink-0 items-center justify-center">
      {failed ? (
        <Icon name="x-circle" size={12} className="text-danger" />
      ) : active ? (
        <Spark />
      ) : (
        <span aria-hidden="true" className="step-dot size-[5px] rounded-full bg-text-secondary/60" />
      )}
    </span>
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
  const verbose = useTranscriptView() === "verbose";
  const { added, removed } = diffStats(diff);

  return (
    <details className="ms-5 mt-1" open={verbose}>
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

/** Command output one line per row: a long line wraps under itself, and the box scrolls only down. */
function OutputLines({ text, tone, label, follow }: { text: string; tone: string; label?: string; follow: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  // While the command runs the newest line stays in view.
  useLayoutEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  });
  const lines = text.replace(/\r?\n$/, "").split(/\r?\n/);
  return (
    <div
      ref={box}
      data-testid="command-output"
      className={`max-h-[360px] overflow-y-auto overflow-x-hidden rounded-[8px] border border-rule bg-surface-base px-3 py-2.5 font-mono text-[12.5px] leading-[1.6] ${tone}`}
    >
      {label && <div className="mb-1 font-sans text-text-secondary">{label}</div>}
      <div className="code-wrap">
        {lines.map((line, index) => (
          <div key={index} style={{ "--ind": leadingSpaces(line) } as React.CSSProperties}>
            {line || " "}
          </div>
        ))}
      </div>
    </div>
  );
}

function CodeRunOutput({ step, t }: { step: SearchStep; t: (key: string) => string }) {
  const hasOutput = Boolean(step.stdout || step.stderr);
  if (!hasOutput) return null;
  const follow = !step.isComplete;

  return (
    <div className="ms-5 mt-1.5 space-y-2">
      {step.stdout && <OutputLines text={step.stdout} tone="text-text-secondary" follow={follow} />}
      {step.stderr && <OutputLines text={step.stderr} tone="text-danger" label={t("stderr")} follow={follow} />}
    </div>
  );
}

/** A file edit as a folded card: the verb, file and counts on one line, the diff inside. */
function EditCard({ step, verb, active, t }: { step: SearchStep; verb: string; active: boolean; t: (key: string) => string }) {
  const verbose = useTranscriptView() === "verbose";
  const [clicked, setClicked] = useState<boolean | null>(null);
  const expanded = clicked ?? verbose;
  const totals = stepTotals(step);
  const path = step.filepath ?? "";
  const name = step.filename || path.split(/[\\/]/).pop() || t("untitledFile");
  const folder = path.endsWith(name) ? path.slice(0, path.length - name.length).replace(/[\\/]$/, "") : "";

  return (
    <div className="step-rise overflow-hidden rounded-sm border border-rule bg-surface-base" data-testid="edit-card">
      <button
        type="button"
        data-testid="step-details-toggle"
        aria-expanded={expanded}
        aria-label={expanded ? t("hideStepDetails") : t("showStepDetails")}
        onClick={() => setClicked(!expanded)}
        className="rail-row flex h-[34px] w-full items-center gap-2 px-3 text-start text-[13px] text-text-secondary hover:bg-surface-raised"
      >
        <Icon name="file-code" size={14} className="flex-shrink-0 text-text-tertiary" />
        <span className={`flex-shrink-0${active ? " live-sweep" : ""}`}>{verb}</span>
        <span className="min-w-0 truncate font-mono text-[12.5px] text-text-primary" title={path || undefined}>{name}</span>
        {folder && <span className="min-w-0 truncate text-[12px] text-text-tertiary">{folder}</span>}
        <span className="ms-auto flex flex-none items-center gap-2 ps-2">
          {totals && (
            <span className="whitespace-nowrap font-mono text-[12px] tabular-nums">
              <span className="text-ok">+{totals.added}</span> <span className="text-danger">−{totals.removed}</span>
            </span>
          )}
          <Icon name="caret-right" size={12} mirrored className={`text-text-tertiary transition-transform ${expanded ? "rotate-90" : ""}`} />
        </span>
      </button>
      {expanded && (
        <div className="border-t border-rule">
          <DiffBlock before={step.before!} after={step.after!} filePath={step.filepath} bare t={t} />
        </div>
      )}
    </div>
  );
}

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
  const canToggle = PREVIEWABLE_EXTENSIONS.has(extension);
  const [viewMode, setViewMode] = useState<"preview" | "source">("preview");

  const [revealed, setRevealed] = useState(0);

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
  // A finished document opens as its rendered preview; everything else is the raw text in the tail box.
  const showingPreview = canToggle && !writing && viewMode === "preview";
  const shown = writing || !animate
    ? content
    : content.slice(0, Math.min(revealed, content.length));
  const lineCount = content ? content.split("\n").length : 0;
  const actionClass = "text-[12px] text-text-secondary hover:text-text-primary underline-offset-2 hover:underline disabled:no-underline disabled:text-text-tertiary";

  return (
    <div className="step-rise mb-3.5 w-full" data-testid="file-step">
      <div className="flex min-h-6 items-center gap-2 text-[13px] text-text-secondary">
        <StepMark active={writing} failed={false} />
        <span className="min-w-0">{writing ? t("writingFile") : t("fileCreated")}</span>
        <span className="ms-auto flex flex-shrink-0 items-center gap-3 ps-2">
          {canToggle && !writing && (
            <button type="button" onClick={() => setViewMode(viewMode === "preview" ? "source" : "preview")} className={actionClass}>
              {t(viewMode === "preview" ? "source" : "preview")}
            </button>
          )}
          {step.filepath && !writing && (
            <button type="button" onClick={() => window.electronAPI?.openFile?.(step.filepath!)} className={actionClass}>
              {t("openFile")}
            </button>
          )}
          {step.checkpointId !== undefined && onRevert && !writing && (
            <button type="button" disabled={isReverted} onClick={() => onRevert(step.checkpointId as number)} className={actionClass}>
              {isReverted ? t("changeUndone") : t("undoChange")}
            </button>
          )}
        </span>
      </div>
      <dl className="ms-5 mt-0.5 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3.5 gap-y-0.5 font-mono text-[12.5px] leading-[1.6]">
        <dt className="text-text-tertiary">file</dt>
        <dd className="m-0 break-words text-text-primary">{step.filename || t("untitledFile")}</dd>
        <dt className="col-span-2 text-text-tertiary">content</dt>
        <dd className="col-span-2 m-0">
          {showingPreview ? (
            <div className="mt-1.5 max-h-[320px] overflow-y-auto rounded-[8px] border border-rule bg-surface-base">
              <FilePreview filename={step.filename || "file.txt"} content={shown} t={t} isWriting={false} />
            </div>
          ) : (
            <TailBox text={shown} open={writing} />
          )}
        </dd>
      </dl>
      {!writing && lineCount > 0 && (
        <div className="step-rise ms-5 mt-1 text-[13px] text-text-tertiary">
          {t(lineCount === 1 ? "createdWithLines_one" : "createdWithLines_other").replace("{n}", String(lineCount))}
        </div>
      )}
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

/** A command step reads "Ran `command`": the command in backticks, an exit note after it. */
function splitCommand(content: string): { head: string; command: string; tail: string } | null {
  const start = content.indexOf("`");
  const end = content.lastIndexOf("`");
  if (start < 0 || end <= start) return null;
  return { head: content.slice(0, start), command: content.slice(start + 1, end), tail: content.slice(end + 1) };
}

/** The command on one line, cut short; a caret opens the whole of it for a long or many-line command. */
function CommandLine({ content, active }: { content: string; active: boolean }) {
  const [open, setOpen] = useState(false);
  const parts = splitCommand(content);
  if (!parts) return null;
  const firstLine = parts.command.split("\n")[0];
  const more = parts.command.includes("\n") || parts.command.length > 90;

  return (
    <span className={`flex min-w-0 flex-1 gap-1 ${open ? "items-start" : "items-center"} ${active ? "" : "text-text-primary"}`}>
      <span className={`flex-shrink-0 whitespace-pre${active ? " live-sweep" : ""}`}>{parts.head}</span>
      {open ? (
        <code className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded-sm bg-surface-raised px-1.5 py-0.5 font-mono text-[12px]">
          {parts.command}
        </code>
      ) : (
        <code className="min-w-0 truncate rounded-sm bg-surface-raised px-1.5 font-mono text-[12px]">{firstLine}</code>
      )}
      {parts.tail && <span className="flex-shrink-0 whitespace-pre">{parts.tail}</span>}
      {more && (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={open ? "Collapse command" : "Show full command"}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-sm text-text-tertiary hover:text-text-primary"
        >
          <Icon name="caret-right" size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
      )}
    </span>
  );
}

/** A folded step's first argument on its own row, cut to one line: "Read format.ts". */
function ArgTag({ view }: { view: StepView }) {
  const first = view.args[0]?.[1].split(/\r?\n/)[0];
  if (!first) return null;
  return <span className="min-w-0 truncate font-mono text-[12.5px] text-text-tertiary">{first}</span>;
}

/** A step's arguments as mono key and value rows. */
function ArgRows({ view }: { view: StepView }) {
  return (
    <dl className="ms-5 mt-0.5 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3.5 gap-y-0.5 font-mono text-[12.5px] leading-[1.6]">
      {view.args.map(([key, value]) => (
        <Fragment key={key}>
          <dt className="step-fade text-text-tertiary">{key}</dt>
          <dd className="step-fade m-0 whitespace-pre-wrap break-words text-text-primary">{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
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
  const openInCanvas = useContext(OpenFileContext);
  const verbose = useTranscriptView() === "verbose";
  // null follows the step: details show while it runs and fold once it is done. A click overrides it.
  const [clicked, setClicked] = useState<boolean | null>(null);
  if (step.type === "results" && step.results && step.results.length > 0) {
    const resultsView = stepView(step, t);
    return (
      <div key={step.id} className="step-rise mb-3.5">
        <div className="rail-row flex min-h-6 items-center gap-2 text-[13px] text-text-secondary">
          <StepMark active={false} failed={false} />
          {resultsView ? (
            <>
              <span className="flex-shrink-0">{resultsView.name}</span>
              <ArgTag view={resultsView} />
            </>
          ) : (
            <span className="markdown-inline">
              <ReactMarkdown
                remarkPlugins={REMARK_PLUGINS}
                rehypePlugins={REHYPE_PLUGINS}
                components={INLINE_COMPONENTS}
              >
                {step.content}
              </ReactMarkdown>
            </span>
          )}
        </div>
        <details className="group/results" open={verbose}>
          <summary className="ms-5 mt-1 flex cursor-pointer select-none list-none items-center gap-1.5 text-[13px] text-text-tertiary hover:text-text-secondary [&::-webkit-details-marker]:hidden">
            <span>{resultsView?.result ?? ""}</span>
            <Icon name="caret-right" size={12} mirrored className="transition-transform group-open/results:rotate-90" />
          </summary>
        <div className="ms-5 mt-1 grid grid-cols-[minmax(0,1fr)]">
          {step.results.map((result, rIdx) => {
            const hostname = hostnameOf(result.url);
            return (
              <a
                key={rIdx}
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                title={result.snippet || result.title}
                className="-mx-2 flex h-8 items-center gap-2.5 rounded-xs px-2 no-underline hover:bg-surface-raised group/link [&>*:first-child]:mt-0"
                onClick={(e) => {
                  e.preventDefault();
                  window.open(result.url, "_blank");
                }}
              >
                <SiteBadge hostname={hostname} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary group-hover/link:underline">{result.title}</span>
                <span className="max-w-[40%] flex-shrink-0 truncate text-[12px] text-text-tertiary">{hostname.replace(/^www\./i, "")}</span>
              </a>
            );
          })}
        </div>
        </details>
      </div>
    );
  }

  if (step.type === "question") {
    return <QuestionCard key={step.id} step={step} t={t} />;
  }

  if (step.type === "research_plan") {
    return <ResearchPlanCard key={step.id} step={step} t={t} />;
  }

  if (step.type === "research_run") {
    return <ResearchRunCard key={step.id} step={step} t={t} />;
  }

  if (step.type === "approval") {
    // The call it allowed shows right after it, so only the verbose view repeats the yes.
    if (step.answer && step.answer !== "no" && !verbose) return null;
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

  if (step.type === "tool_call") {
    return <LiveArgs key={step.id} step={step} />;
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

  const failed = step.type === "error" || Boolean(step.failed);
  const isActive = !step.isComplete;
  // A file read opens from its step; a folder listing has no file to open. File changes show only their diff.
  const openable = !isActive && step.filepath && step.type === "reading" && step.filename;
  const totals = isActive ? null : stepTotals(step);
  const view = stepView(step, t);
  const openStep = () =>
    openInCanvas ? openInCanvas(step.filepath!) : window.electronAPI?.openFile?.(step.filepath!);

  const payload =
    step.type === "library" && step.libraryHits?.length ? (
      <LibraryHits hits={step.libraryHits} t={t} />
    ) : step.type === "run_code" || step.type === "command" ? (
      <CodeRunOutput step={step} t={t} />
    ) : step.type === "git" && step.fileContent ? (
      <GitDiffOutput diff={step.fileContent} t={t} />
    ) : null;

  if (step.type === "edit_file" && step.before !== undefined && step.after !== undefined && !failed) {
    return <EditCard step={step} verb={view?.name ?? step.content.split(/\*\*|`/)[0].trim()} active={isActive} t={t} />;
  }

  const hasDetails = Boolean(view?.args.length || (view?.result && !isActive) || payload);
  const expanded = clicked ?? (isActive || verbose);

  return (
    <div key={step.id} className="step-rise mb-3.5">
      <div className="rail-row flex items-center gap-2 min-h-6 text-[13px] text-text-secondary">
        <StepMark active={isActive} failed={failed} />
        {view ? (
          <>
            <span className={`${expanded ? "min-w-0" : "flex-shrink-0"}${isActive ? " live-sweep" : ""}`}>{view.name}</span>
            {!expanded && <ArgTag view={view} />}
          </>
        ) : step.runId && step.fileContent && splitCommand(step.content) ? (
          <CommandLine content={step.content} active={isActive} />
        ) : (
          <span className={`markdown-inline min-w-0${isActive ? " live-sweep" : ""}`}>
            <ReactMarkdown
              remarkPlugins={REMARK_PLUGINS}
              rehypePlugins={REHYPE_PLUGINS}
              components={INLINE_COMPONENTS}
            >
              {step.content}
            </ReactMarkdown>
          </span>
        )}

        {/* Failed step keeps original description so failure is explicit rather than silent. */}
        {failed && !view && <span className="text-[12px] text-danger">{t("stepFailed")}</span>}
        {hasDetails && (
          <button
            type="button"
            data-testid="step-details-toggle"
            onClick={() => setClicked(!expanded)}
            aria-expanded={expanded}
            aria-label={expanded ? t("hideStepDetails") : t("showStepDetails")}
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-sm text-text-tertiary hover:text-text-primary"
          >
            <Icon name="caret-right" size={12} mirrored className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
          </button>
        )}

        <span className="ms-auto flex items-center gap-3 flex-shrink-0 ps-2">
          {totals && (!view || !expanded) && (
            <span className="font-mono text-[12px] tabular-nums whitespace-nowrap">
              <span className="text-ok">+{totals.added}</span> <span className="text-danger">-{totals.removed}</span>
            </span>
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
          {step.checkpointId !== undefined && onRevert && step.type !== "edit_file" && (
            <button
              type="button"
              onClick={() => onRevert(step.checkpointId as number)}
              disabled={isReverted}
              className="text-[12px] text-text-secondary hover:text-text-primary underline-offset-2 hover:underline disabled:no-underline disabled:text-text-tertiary"
            >
              {isReverted ? t("changeUndone") : t("undoChange")}
            </button>
          )}
          {failed && step.retryUrl && (
            <>
              <button
                type="button"
                onClick={() => fillComposer(t("researchRetryPrompt").replace("{url}", step.retryUrl!))}
                className="text-[12px] text-text-secondary hover:text-text-primary underline-offset-2 hover:underline"
              >
                {t("researchRetry")}
              </button>
              {/^https?:/i.test(step.retryUrl) && (
                <button
                  type="button"
                  onClick={() => window.open(step.retryUrl, "_blank")}
                  className="text-[12px] text-text-secondary hover:text-text-primary underline-offset-2 hover:underline"
                >
                  {t("researchOpenInBrowser")}
                </button>
              )}
            </>
          )}
          {isActive && step.type === "command" && step.runId && (
            <button
              type="button"
              onClick={() => void window.electronAPI?.commands?.detach(step.runId as string)}
              title={`${t("sendToBackground")} (Ctrl+Alt+B)`}
              className="text-[12px] text-text-secondary hover:text-text-primary underline-offset-2 hover:underline"
            >
              {t("sendToBackground")}
            </button>
          )}
        </span>
      </div>
      {expanded && view && <ArgRows view={view} />}
      {view?.result && !isActive && (expanded || failed) && <div className={`step-rise ms-5 mt-1 text-[13px] ${failed ? "text-danger" : "text-text-tertiary"}`}>{view.result}</div>}
      {expanded && payload}
    </div>
  );
}
export default WorkBlock;
