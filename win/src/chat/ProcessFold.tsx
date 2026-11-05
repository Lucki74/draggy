import { useMemo, useState } from "react";
import { Icon, Spark } from "../ui";
import { editTotals } from "./workSummary";
import type { SearchStep } from "../types";

interface ProcessFoldProps {
  steps: SearchStep[];
  /** The turn is still running: the fold reads "Processing…" and stays open. */
  live?: boolean;
  t: (key: string) => string;
  children: React.ReactNode;
}

/** A turn's reasoning, tool calls and earlier prose under one line. Open while it runs, closed once it is done. */
export function ProcessFold({ steps, live = false, t, children }: ProcessFoldProps) {
  const [clicked, setClicked] = useState(false);
  const totals = useMemo(() => editTotals(steps), [steps]);
  const open = live || clicked;
  const label = live
    ? t("workProcessing")
    : t(steps.length === 1 ? "workProcess_one" : "workProcess_other").replace("{n}", String(steps.length));

  return (
    <div className="mb-4" data-testid="process-fold">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setClicked((value) => !value)}
        className="flex min-h-7 max-w-full items-center gap-2 rounded-xs text-start text-[13px] text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {live && (
          <span className="flex w-4 justify-center">
            <Spark />
          </span>
        )}
        <span className="min-w-0">{label}</span>
        {(totals.added > 0 || totals.removed > 0) && (
          <span className="whitespace-nowrap font-mono text-[12px] tabular-nums">
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
