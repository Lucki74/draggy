import { useMemo, useState } from "react";
import { Icon } from "../ui";
import { editTotals } from "./workSummary";
import type { SearchStep } from "../types";

interface ProcessFoldProps {
  steps: SearchStep[];
  t: (key: string) => string;
  children: React.ReactNode;
}

/** A finished turn's reasoning, tool calls and earlier prose, folded under one line. Closed until clicked. */
export function ProcessFold({ steps, t, children }: ProcessFoldProps) {
  const [open, setOpen] = useState(false);
  const totals = useMemo(() => editTotals(steps), [steps]);
  const label = t(steps.length === 1 ? "workProcess_one" : "workProcess_other").replace("{n}", String(steps.length));

  return (
    <div className="mb-4" data-testid="process-fold">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 min-h-7 max-w-full text-start text-[13px] text-text-secondary hover:text-text-primary rounded-xs focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <span className="min-w-0">{label}</span>
        {(totals.added > 0 || totals.removed > 0) && (
          <span className="font-mono text-[12px] tabular-nums whitespace-nowrap">
            <span className="text-ok">+{totals.added}</span> <span className="text-danger">-{totals.removed}</span>
          </span>
        )}
        <Icon name="caret-right" size={12} mirrored className={`flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && <div className="mt-1 ms-2 ps-3 border-s border-rule">{children}</div>}
    </div>
  );
}
export default ProcessFold;
