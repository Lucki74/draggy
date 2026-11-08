import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon, Spark } from "../ui";
import ResearchRunCard from "./ResearchRunCard";
import SiteBadge from "./SiteBadge";
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
import { OpenFileContext, ProjectRootContext } from "./openFileContext";
import { relativePath } from "../files/tree";
import DiffBlock from "./DiffBlock";
import { leadingSpaces } from "./railContext";
import { FilePreview } from "./FilePreview";
import ImageCard from "./ImageCard";
import { loadLabel, type LoadStage } from "./loadLabel";
import { stepTotals } from "./workSummary";
import { stepView } from "./stepView";
import { TailBox } from "./LiveArgs";
import { StepLine, linkClass } from "./StepLine";
import type { ApprovalAnswer, SearchStep } from "../types";

/** A written file sits off the rail, so it draws its own mark: the spark while it is written. */
function StepMark({ active }: { active: boolean }) {
  return (
    <span className="flex w-3 flex-shrink-0 items-center justify-center">
      {active ? <Spark /> : <span aria-hidden="true" className="size-[5px] rounded-full bg-text-secondary/60" />}
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
    <div className="-ms-2 flex flex-col">
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
    <details open={verbose}>
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

// Lines that read as a pass or a failure get the matching tone.
const lineTone = (line: string) =>
  /✓|√/.test(line) ? "text-ok" : /×|✗|\bFAIL\b|Error\b|exit code [1-9]/.test(line) ? "text-danger" : undefined;

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
      className={`max-h-[360px] overflow-y-auto overflow-x-hidden rounded-xs bg-surface-tint px-3 py-2 font-mono text-[12px] leading-[19px] ${tone}`}
    >
      {label && <div className="mb-1 font-sans text-text-secondary">{label}</div>}
      <div className="code-wrap">
        {lines.map((line, index) => (
          <div key={index} className={lineTone(line)} style={{ "--ind": leadingSpaces(line) } as React.CSSProperties}>
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
    <div className="space-y-2">
      {step.stdout && <OutputLines text={step.stdout} tone="text-text-secondary" follow={follow} />}
      {step.stderr && <OutputLines text={step.stderr} tone="text-danger" label={t("stderr")} follow={follow} />}
    </div>
  );
}

/** Whole seconds since `from`, ticking once a second while `running`. */
function useSeconds(from: number | undefined, running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return from === undefined ? 0 : Math.max(0, Math.floor((now - from) / 1000));
}

/** The seconds a live step has run, or in the verbose view how long a finished one took. */
function StepTime({ step }: { step: SearchStep }) {
  const verbose = useTranscriptView() === "verbose";
  const live = !step.isComplete;
  const seconds = useSeconds(step.startedAt, live);
  const text = live ? (seconds >= 1 ? `${seconds}s` : "") : verbose && step.tookMs !== undefined ? `${(step.tookMs / 1000).toFixed(1)}s` : "";
  if (!text) return null;
  return <span className="ms-auto flex-none ps-2 text-[12px] tabular-nums text-text-tertiary">{text}</span>;
}

/** A file edit as a folded card: the file and counts on one line, the diff inside. */
function EditCard({ step, verb, active, t }: { step: SearchStep; verb: string; active: boolean; t: (key: string) => string }) {
  const verbose = useTranscriptView() === "verbose";
  const [clicked, setClicked] = useState<boolean | null>(null);
  const expanded = clicked ?? verbose;
  const totals = active ? null : stepTotals(step);
  const root = useContext(ProjectRootContext);
  const path = root && step.filepath ? relativePath(root, step.filepath) : (step.filepath ?? "");
  const name = step.filename || path.split(/[\\/]/).pop() || t("untitledFile");
  const folder = path.endsWith(name) ? path.slice(0, path.length - name.length) : "";

  return (
    <div
      className={`step-rise overflow-hidden rounded-sm border bg-surface-base transition-colors duration-300 ${active ? "border-[color-mix(in_srgb,var(--accent)_35%,var(--rule))]" : "border-rule"}`}
      data-testid="edit-card"
    >
      <button
        type="button"
        data-testid="step-details-toggle"
        aria-expanded={expanded}
        aria-label={expanded ? t("hideStepDetails") : t("showStepDetails")}
        onClick={() => setClicked(!expanded)}
        className="step-line flex min-h-[34px] w-full items-center gap-2 px-2.5 text-start text-[13px] text-text-secondary hover:text-text-primary"
      >
        <Icon name="file-code" size={14} className="flex-shrink-0 text-text-tertiary" />
        {active && <span className="flex-shrink-0 live-sweep">{verb}</span>}
        <span className="min-w-0 flex-none truncate font-mono text-[12px] text-text-primary" title={path || undefined}>{name}</span>
        {folder && <span className="min-w-0 truncate font-mono text-[12px] text-text-tertiary">{folder}</span>}
        {totals && (
          <span className="ms-auto flex-none whitespace-nowrap font-mono text-[12px] tabular-nums">
            <span className="text-ok">+{totals.added}</span> <span className="text-danger">−{totals.removed}</span>
          </span>
        )}
        <span className={`step-caret flex-none text-text-tertiary${totals ? "" : " ms-auto"}`}>
          <Icon name="caret-right" size={11} mirrored className={`transition-transform duration-[250ms] ${expanded ? "rotate-90" : ""}`} />
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
        <StepMark active={writing} />
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
  const root = useContext(ProjectRootContext);
  const verbose = useTranscriptView() === "verbose";
  // null follows the step: details show while it runs and fold once it is done. A click overrides it.
  const [clicked, setClicked] = useState<boolean | null>(null);
  if (step.type === "results" && step.results && step.results.length > 0) {
    const resultsView = stepView(step, t);
    const query = resultsView?.args[0]?.[1];
    const open = clicked ?? verbose;
    const list = (
      <div role="list" className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
        {step.results.map((result, rIdx) => {
          const hostname = hostnameOf(result.url).replace(/^www\./i, "");
          return (
            <div role="listitem" key={rIdx}>
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                title={result.snippet || result.title}
                className="-ms-1.5 flex min-h-[26px] items-center gap-2 rounded-xs px-1.5 text-[13px] !text-text-secondary !no-underline hover:bg-surface-tint hover:!text-text-primary"
                onClick={(e) => {
                  e.preventDefault();
                  window.open(result.url, "_blank");
                }}
              >
                <SiteBadge hostname={hostname} small />
                <span className="min-w-0 truncate">{result.title}</span>
                <span className="ms-auto max-w-[40%] flex-none truncate ps-2 text-[12px] text-text-tertiary">{hostname}</span>
              </a>
            </div>
          );
        })}
      </div>
    );
    return (
      <StepLine
        verb={t("searchedFor")}
        target={query ? t("quotedQuery").replace("{q}", query) : undefined}
        meta={resultsView?.result}
        active={false}
        open={open}
        onToggle={() => setClicked(!open)}
        time={<StepTime step={step} />}
        details={list}
        t={t}
      />
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

  const target = view?.args[0]?.[1];
  const longTarget = Boolean(target && (target.includes("\n") || target.length > 80));
  const fileInfo = openable ? (
    <div className="flex items-center gap-3 font-mono text-[12px] text-text-tertiary">
      <span className="min-w-0 break-all">{root ? relativePath(root, step.filepath!) : step.filepath}</span>
      <button type="button" onClick={openStep} title={step.filepath} className={`flex-none font-sans ${linkClass}`}>
        {t("openFile")}
      </button>
    </div>
  ) : null;
  const details = payload || fileInfo ? <>{payload}{fileInfo}</> : null;
  const hasOutput = step.type === "run_code" || step.type === "command" ? Boolean(step.stdout || step.stderr) : Boolean(payload);
  const hasDetails = hasOutput || Boolean(fileInfo) || longTarget;
  const open = clicked ?? (hasDetails && (verbose || (isActive && hasOutput)));
  const mono = ["command", "run_code", "reading", "library", "error"].includes(step.type);
  const verb = view ? view.name : (
    <span className="markdown-inline">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={INLINE_COMPONENTS}>
        {step.content}
      </ReactMarkdown>
    </span>
  );

  const actions = (
    <>
      {step.checkpointId !== undefined && onRevert && step.type !== "edit_file" && (
        <button
          type="button"
          onClick={() => onRevert(step.checkpointId as number)}
          disabled={isReverted}
          className={`${linkClass} disabled:no-underline disabled:text-text-tertiary`}
        >
          {isReverted ? t("changeUndone") : t("undoChange")}
        </button>
      )}
      {failed && step.retryUrl && (
        <>
          <button type="button" onClick={() => fillComposer(t("researchRetryPrompt").replace("{url}", step.retryUrl!))} className={linkClass}>
            {t("researchRetry")}
          </button>
          {/^https?:/i.test(step.retryUrl) && (
            <button type="button" onClick={() => window.open(step.retryUrl, "_blank")} className={linkClass}>
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
          className={linkClass}
        >
          {t("sendToBackground")}
        </button>
      )}
    </>
  );
  const hasActions =
    (step.checkpointId !== undefined && onRevert && step.type !== "edit_file") ||
    (failed && step.retryUrl) ||
    (isActive && step.type === "command" && step.runId);

  return (
    <StepLine
      verb={verb}
      target={target}
      mono={mono}
      meta={failed ? (view?.result ?? t("stepFailed")) : view?.result}
      failed={failed}
      active={isActive}
      open={open}
      onToggle={hasDetails ? () => setClicked(!open) : undefined}
      time={<StepTime step={step} />}
      actions={hasActions ? actions : undefined}
      details={details}
      t={t}
    />
  );
}
export default WorkBlock;
