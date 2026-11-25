import type { DiffLine, ParsedFileDiff } from "./diffParser";
import { LINE_MARKS, LINE_TINTS, segmentStyle, useDiffHighlight, type Segment } from "./diffHighlight";

interface UnifiedDiffViewProps {
  fileDiff: ParsedFileDiff;
}

/** A line's code, highlighted when token runs are ready. */
export function LineCode({ line, runs, className = "" }: { line: DiffLine; runs?: Segment[]; className?: string }) {
  return (
    <span className={`flex-1 min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] text-text-primary ${className}`}>
      {runs && runs.length > 0
        ? runs.map((run, index) => (
            <span key={index} style={segmentStyle(run.classes)}>
              {run.text}
            </span>
          ))
        : line.text || " "}
    </span>
  );
}

/** One column of lines, each with its number and a tint for what changed. */
export function UnifiedDiffView({ fileDiff }: UnifiedDiffViewProps) {
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
          {hunk.lines.map((line, lineIndex) => (
            <div key={lineIndex} data-kind={line.kind} className={`flex items-start ${LINE_TINTS[line.kind]}`}>
              <span className={`w-10 flex-shrink-0 select-none pe-3 text-end text-[11px] ${LINE_MARKS[line.kind]}`}>
                {line.afterLine ?? line.beforeLine ?? ""}
              </span>
              <span className={`w-3 flex-shrink-0 select-none ${LINE_MARKS[line.kind]}`}>
                {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : ""}
              </span>
              <LineCode line={line} runs={runs?.get(line)} className="pe-4" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
