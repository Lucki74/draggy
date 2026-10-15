import { Children, isValidElement, useMemo, useRef, useState } from "react";
import { editTotals, summarizeWork } from "./workSummary";
import { Icon, Spark } from "../ui";
import { useTranscriptView } from "./transcriptView";
import type { SearchStep } from "../types";

interface WorkGroupProps {
  steps: SearchStep[];
  /** Still being worked on: the block stays open until the turn moves past it. */
  active: boolean;
  language: string;
  t: (key: string) => string;
  children: React.ReactNode;
}

// All tool steps between two stretches of prose, folded into one block with a summary in words.
export function WorkGroup({ steps, active, language, t, children }: WorkGroupProps) {
  // Verbose keeps every block open; otherwise a block is open while it runs.
  const view = useTranscriptView();
  const expanded = active || view === "verbose";
  const [open, setOpen] = useState(expanded);
  const [wasExpanded, setWasExpanded] = useState(expanded);
  if (expanded !== wasExpanded) {
    setWasExpanded(expanded);
    setOpen(expanded);
  }

  const summary = summarizeWork(steps, language, t);
  const totals = useMemo(() => editTotals(steps), [steps]);
  const running = steps.some((step) => !step.isComplete);
  const body = useRef<HTMLOListElement>(null);

  // Folds the block and every output opened inside it, so it reopens tidy.
  const collapseAll = () => {
    body.current?.querySelectorAll("details[open]").forEach((details) => details.removeAttribute("open"));
    setOpen(false);
  };

  return (
    <div className="mb-4">
      <div className="flex items-center gap-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="group/work flex items-center gap-2 min-h-7 max-w-full text-start text-[13px] text-text-secondary hover:text-text-primary rounded-xs focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {(running || summary.failed > 0) && (
          <span className="flex w-4 justify-center flex-shrink-0">
            {running ? <Spark /> : <Icon name="warning-circle" size={16} className="text-danger" />}
          </span>
        )}
        <span className="min-w-0">{summary.text}</span>
        {(totals.added > 0 || totals.removed > 0) && (
          <span className="font-mono text-[12px] tabular-nums whitespace-nowrap">
            <span className="text-ok">+{totals.added}</span> <span className="text-danger">-{totals.removed}</span>
          </span>
        )}
        <Icon name="caret-right" size={12} mirrored className={`flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && !running && (
        <button
          type="button"
          onClick={collapseAll}
          className="ms-auto flex-shrink-0 text-[12px] text-text-secondary hover:text-text-primary underline-offset-2 hover:underline"
        >
          {t("collapseAll")}
        </button>
      )}
      </div>
      <ol ref={body} hidden={!open} className="mt-1 ms-2 ps-3 border-s border-rule">
        {Children.toArray(children).map((child, index) => (
          <li key={isValidElement(child) ? child.key : index} className="flex gap-2">
            <span aria-hidden="true" className="w-4 flex-shrink-0 pt-1.5 text-end text-[12px] leading-4 tabular-nums text-text-tertiary">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">{child}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}
export default WorkGroup;
