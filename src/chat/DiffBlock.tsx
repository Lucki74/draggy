import { useMemo, useState } from "react";
import { describeDiff, diffLines } from "./diff";
import type { DiffLine } from "./diff";

interface DiffBlockProps {
  before: string;
  after: string;
  t: (key: string) => string;
}

/** How many lines are shown before the block asks to be opened up. */
const PREVIEW_LINES = 14;

const TINTS: Record<DiffLine["kind"], string> = {
  added: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  removed: "bg-red-500/10 text-red-600 dark:text-red-400",
  context: "text-[var(--text-muted)]",
};

const MARKS: Record<DiffLine["kind"], string> = {
  added: "+",
  removed: "-",
  context: " ",
};

/**
 * What an edit did, in the shape every developer already reads. The whole file
 * is never shown: the point of the block is that the change is small enough to
 * check at a glance, and anything that is not can be opened.
 */
export default function DiffBlock({ before, after, t }: DiffBlockProps) {
  const diff = useMemo(() => diffLines(before, after), [before, after]);
  const [open, setOpen] = useState(false);

  if (diff.summary) {
    return (
      <p className="mt-2 ml-7 text-xs font-bold tracking-tight text-[var(--text-muted)]">
        {diff.summary}
      </p>
    );
  }

  if (diff.hunks.length === 0) return null;

  const rows = diff.hunks.flatMap((hunk, index) =>
    hunk.skipped > 0 || index > 0
      ? [{ gap: hunk.skipped }, ...hunk.lines]
      : hunk.lines,
  );

  const shown = open ? rows : rows.slice(0, PREVIEW_LINES);
  const hidden = rows.length - shown.length;

  return (
    <div className="mt-2 ml-7 overflow-hidden rounded-xl border-[3px] border-[var(--border-light)]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-panel)]">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
          {describeDiff(diff)}
        </span>
      </div>

      <div className="overflow-x-auto bg-[var(--bg-base)]">
        {shown.map((row, index) =>
          "gap" in row ? (
            <div
              key={`gap-${index}`}
              className="px-3 py-1 text-[10px] font-bold tracking-wider text-[var(--text-muted)] opacity-60 border-y border-[var(--border-light)]"
            >
              {row.gap > 0 ? `… ${row.gap}` : "…"}
            </div>
          ) : (
            <div
              key={`${index}-${row.before}-${row.after}`}
              className={`flex font-mono text-xs leading-5 ${TINTS[row.kind]}`}
            >
              <span className="w-10 flex-shrink-0 select-none pr-2 text-right opacity-40">
                {row.before === null ? "" : row.before + 1}
              </span>
              <span className="w-10 flex-shrink-0 select-none pr-2 text-right opacity-40">
                {row.after === null ? "" : row.after + 1}
              </span>
              <span className="flex-shrink-0 select-none pr-2 opacity-70">
                {MARKS[row.kind]}
              </span>
              <span className="whitespace-pre pr-3">{row.text || " "}</span>
            </div>
          ),
        )}
      </div>

      {hidden > 0 && (
        <button
          onClick={() => setOpen(true)}
          className="w-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-panel)] hover:text-[var(--text-main)]"
        >
          {t("showMoreLines")}
        </button>
      )}
    </div>
  );
}
