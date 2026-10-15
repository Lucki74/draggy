import { useContext, useMemo, useState } from "react";
import { describeDiff, diffLines } from "./diff";
import type { DiffLine } from "./diff";
import { OpenDiffContext } from "./openDiffContext";

interface DiffBlockProps {
  before: string;
  after: string;
  filePath?: string;
  t: (key: string) => string;
}

/** How many lines are shown before the block asks to be opened up. */
const PREVIEW_LINES = 14;

const TINTS: Record<DiffLine["kind"], string> = {
  added: "bg-[color-mix(in_srgb,var(--ok)_10%,transparent)] text-text-primary [&>span:nth-child(3)]:text-ok",
  removed: "bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-text-primary [&>span:nth-child(3)]:text-danger",
  context: "text-text-secondary",
};

const MARKS: Record<DiffLine["kind"], string> = {
  added: "+",
  removed: "-",
  context: " ",
};

/** What an edit did, in the usual diff shape. Never the whole file: the change should be checkable
 * at a glance, and larger ones can be opened. */
export default function DiffBlock({ before, after, filePath, t }: DiffBlockProps) {
  const onOpenDiff = useContext(OpenDiffContext);
  const diff = useMemo(() => diffLines(before, after), [before, after]);
  const [open, setOpen] = useState(false);

  if (diff.summary) {
    return (
      <p className="mt-1 text-[12px] text-text-secondary">
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

  return (
    <div dir="ltr" className="mt-1 overflow-hidden rounded-sm border border-rule bg-surface-base">
      <div className="flex items-center justify-between h-8 px-3 border-b border-rule">
        <span className="text-[12px] text-text-secondary">
          {describeDiff(diff)}
        </span>
        {onOpenDiff && (
          <button
            type="button"
            onClick={() => onOpenDiff(filePath)}
            className="text-[11px] text-text-secondary hover:text-text-primary hover:underline underline-offset-2"
          >
            {t("openInDiff")}
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        {shown.map((row, index) =>
          "gap" in row ? (
            <div
              key={`gap-${index}`}
              className="px-3 py-0.5 font-mono text-[12px] text-text-tertiary border-y border-rule"
            >
              {row.gap > 0 ? `… ${row.gap}` : "…"}
            </div>
          ) : (
            <div
              key={`${index}-${row.before}-${row.after}`}
              className={`flex font-mono text-[12px] leading-5 ${TINTS[row.kind]}`}
            >
              <span className="w-10 flex-shrink-0 select-none pe-2 text-end text-text-tertiary">
                {row.before === null ? "" : row.before + 1}
              </span>
              <span className="w-10 flex-shrink-0 select-none pe-2 text-end text-text-tertiary">
                {row.after === null ? "" : row.after + 1}
              </span>
              <span className="flex-shrink-0 select-none pe-2">
                {MARKS[row.kind]}
              </span>
              <span className="whitespace-pre pe-3">{row.text || " "}</span>
            </div>
          ),
        )}
      </div>

      {rows.length > PREVIEW_LINES && (
        <button
          type="button"
          onClick={() => setOpen((cur) => !cur)}
          className="w-full h-8 px-3 text-start text-[12px] text-text-secondary border-t border-rule hover:text-text-primary hover:bg-surface-raised cursor-pointer"
        >
          {open ? t("showFewerLines") : t("showMoreLines")}
        </button>
      )}
    </div>
  );
}
