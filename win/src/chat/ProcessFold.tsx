import { useEffect, useMemo, useState } from "react";
import { Icon } from "../ui";
import { editTotals, isWorkStep, stepTotals, summarizeWork } from "./workSummary";
import Rail, { type RailEntry } from "./Rail";
import type { TranscriptView } from "./transcriptView";
import type { SearchStep } from "../types";

interface ProcessFoldProps {
  steps: SearchStep[];
  entries: RailEntry[];
  /** The turn is still running: the chain is open and the row reads as working. */
  live: boolean;
  /** How long the finished turn took, shown after the summary. */
  durationMs?: number;
  view: TranscriptView;
  language: string;
  t: (key: string) => string;
}

/** 9s, 1m 05s: short enough to sit after a summary. */
function formatSpan(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** Milliseconds since the row mounted, ticking once a second while `running`. */
function useRunningFor(running: boolean) {
  const [from] = useState(() => Date.now());
  const [now, setNow] = useState(from);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now - from;
}

/** A turn's reasoning and tool calls on one rail under a single header line.
 * Open while it runs; once done the normal view folds it and the other views keep it open. */
export function ProcessFold({ steps, entries, live, durationMs, view, language, t }: ProcessFoldProps) {
  // null follows the turn and the view. A click overrides it.
  const [clicked, setClicked] = useState<boolean | null>(null);
  const open = clicked ?? (live || view !== "normal");
  const totals = useMemo(() => editTotals(steps), [steps]);
  // One edited file shows its counts on its own card, so the header adds them only for several.
  const edits = useMemo(() => steps.filter((step) => stepTotals(step)).length, [steps]);
  const work = useMemo(() => steps.filter(isWorkStep), [steps]);
  const failedSteps = work.filter((step) => step.type === "error" || step.failed);
  const summary = summarizeWork(work.filter((step) => !failedSteps.includes(step)), language, t).text;
  const failedText = failedSteps.length > 0 ? summarizeWork(failedSteps, language, t).text : "";
  const runningFor = useRunningFor(live);
  const span = live ? runningFor : durationMs;
  const time = span !== undefined && span >= 1000 ? formatSpan(span) : "";
  const head = live ? t("working") : time ? t("workedFor").replace("{time}", time) : "";
  const dot = <span aria-hidden="true" className="text-text-tertiary">·</span>;

  return (
    <div className="mb-4" data-testid="process-fold">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setClicked(!open)}
        className="flex min-h-7 max-w-full items-center gap-1.5 rounded-xs text-start text-[13px] text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {head && <span data-testid={live ? undefined : "process-time"} className="whitespace-nowrap tabular-nums">{head}</span>}
        {live && time && <span data-testid="process-time" className="whitespace-nowrap tabular-nums text-text-tertiary">{time}</span>}
        {!live && summary && (
          <>
            {head && dot}
            <span className="min-w-0 truncate">{summary}</span>
          </>
        )}
        {!live && failedText && (
          <>
            {dot}
            <span className="whitespace-nowrap text-danger">{failedText}</span>
          </>
        )}
        {!live && !open && edits > 1 && (totals.added > 0 || totals.removed > 0) && (
          <span className="step-fade ms-1 whitespace-nowrap font-mono text-[12px] tabular-nums">
            <span className="text-ok">+{totals.added}</span> <span className="text-danger">−{totals.removed}</span>
          </span>
        )}
        <Icon name="caret-right" size={12} mirrored className={`flex-shrink-0 transition-transform duration-[250ms] ${open ? "rotate-90" : ""}`} />
      </button>
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-[450ms] ease-[cubic-bezier(.23,1,.32,1)] ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="min-h-0 overflow-hidden">
          {open ? <Rail entries={entries} focus={live && view === "normal"} running={live} t={t} /> : null}
        </div>
      </div>
    </div>
  );
}
export default ProcessFold;
