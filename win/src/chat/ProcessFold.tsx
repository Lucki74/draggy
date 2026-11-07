import { useEffect, useMemo, useState } from "react";
import { Icon, Spark } from "../ui";
import { editTotals, isWorkStep, stepTotals, summarizeWork } from "./workSummary";
import type { SearchStep } from "../types";

interface ProcessFoldProps {
  steps: SearchStep[];
  /** The turn is still running: the chain is open and the row reads as working. */
  live: boolean;
  /** How long the finished turn took, shown after the summary. */
  durationMs?: number;
  language: string;
  t: (key: string) => string;
  children: React.ReactNode;
}

/** A turn's reasoning and tool calls in one chain. Open while it runs, folded under a summary once done, one click reopens it. */
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

export function ProcessFold({ steps, live, durationMs, language, t, children }: ProcessFoldProps) {
  // null follows the turn: open while it runs, folded after. A click overrides it.
  const [clicked, setClicked] = useState<boolean | null>(null);
  const open = clicked ?? live;
  const totals = useMemo(() => editTotals(steps), [steps]);
  // One edited file shows its counts in its own diff, so the row adds them only for several.
  const edits = useMemo(() => steps.filter((step) => stepTotals(step)).length, [steps]);
  const runningFor = useRunningFor(live);
  const span = live ? runningFor : durationMs;
  const label = live ? t("processing") : summarizeWork(steps.filter(isWorkStep), language, t).text;

  return (
    <div className="mb-4" data-testid="process-fold">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setClicked(!open)}
        className="flex min-h-7 max-w-full items-center gap-2 rounded-xs text-start text-[13px] text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {live && (
          <span className="flex w-4 justify-center">
            <Spark />
          </span>
        )}
        <span className="min-w-0">{label}</span>
        {span !== undefined && span >= 1000 && (
          <span data-testid="process-time" className="whitespace-nowrap tabular-nums text-text-secondary/70">{formatSpan(span)}</span>
        )}
        {!live && edits > 1 && (totals.added > 0 || totals.removed > 0) && (
          <span className="step-fade whitespace-nowrap font-mono text-[12px] tabular-nums">
            <span className="text-ok">+{totals.added}</span> <span className="text-danger">-{totals.removed}</span>
          </span>
        )}
        <Icon name="caret-right" size={12} mirrored className={`flex-shrink-0 transition-transform duration-[250ms] ${open ? "rotate-90" : ""}`} />
      </button>
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-[450ms] ease-[cubic-bezier(.23,1,.32,1)] ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="ms-[7px] mt-1 border-s border-rule pb-1 ps-4">{open ? children : null}</div>
        </div>
      </div>
    </div>
  );
}
export default ProcessFold;
