import { classifyDiff } from "../project/gitView";
import type { DiffLineKind } from "../project/gitView";

const LINE_CLASS: Record<DiffLineKind, string> = {
  add: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  remove: "bg-red-500/10 text-red-600 dark:text-red-400",
  hunk: "text-[var(--text-muted)] bg-[var(--hover-bg)]",
  meta: "text-[var(--text-muted)] font-bold",
  context: "text-[var(--text-main)]",
};

/** A diff as git printed it, coloured line by line. Used where the text comes from git rather than
 * from a before and after Draggy holds itself. */
export default function UnifiedDiff({ diff, maxHeight = 360 }: { diff: string; maxHeight?: number }) {
  const lines = classifyDiff(diff);

  return (
    <div
      className="overflow-auto rounded-xl border-[2px] border-[var(--border-light)] bg-[var(--bg-base)] font-mono text-[11px] leading-[1.45]"
      style={{ maxHeight }}
    >
      <pre className="m-0 min-w-fit py-1">
        {lines.map((line, index) => (
          <div key={index} data-kind={line.kind} className={`px-3 whitespace-pre ${LINE_CLASS[line.kind]}`}>
            {line.text || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}
