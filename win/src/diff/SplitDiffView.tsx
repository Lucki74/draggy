import { hunkToSplitRows, type DiffLine, type ParsedFileDiff } from "./diffParser";
import { LINE_MARKS, LINE_TINTS, useDiffHighlight, type Segment } from "./diffHighlight";
import { LineCode } from "./UnifiedDiffView";

interface SplitDiffViewProps {
  fileDiff: ParsedFileDiff;
}

function Side({ line, runs, end }: { line: DiffLine | null; runs?: Segment[]; end?: boolean }) {
  return (
    <div className={`flex-1 basis-0 min-w-0 flex items-start ${end ? "" : "border-e border-rule"} ${line ? LINE_TINTS[line.kind] : "bg-surface-raised/40"}`}>
      <span className={`w-10 flex-shrink-0 select-none pe-3 text-end text-[11px] ${line ? LINE_MARKS[line.kind] : ""}`}>
        {(end ? line?.afterLine : line?.beforeLine) ?? ""}
      </span>
      {line ? <LineCode line={line} runs={runs} className="pe-3" /> : <span className="flex-1" />}
    </div>
  );
}

/** Before and after side by side. Only used for files that have both sides. */
export function SplitDiffView({ fileDiff }: SplitDiffViewProps) {
  const runs = useDiffHighlight(fileDiff);

  return (
    <div dir="ltr" className="font-mono text-[12px] leading-5 select-text">
      {fileDiff.hunks.map((hunk, hunkIndex) => (
        <div key={hunkIndex}>
          {hunkIndex > 0 && (
            <div className="h-6 flex items-center ps-12 text-[11px] text-text-tertiary bg-surface-raised/50 select-none truncate">
              {hunk.header}
            </div>
          )}
          {hunkToSplitRows(hunk).map((row, rowIndex) => (
            <div key={rowIndex} className="flex items-stretch">
              <Side line={row.before} runs={row.before ? runs?.get(row.before) : undefined} />
              <Side line={row.after} runs={row.after ? runs?.get(row.after) : undefined} end />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
