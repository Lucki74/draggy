import { classifyDiff } from "../project/gitView";
import type { DiffLineKind } from "../project/gitView";

const LINE_CLASS: Record<DiffLineKind, string> = {
  add: "bg-ok/10 text-ok",
  remove: "bg-danger/10 text-danger",
  hunk: "text-text-tertiary bg-surface-raised",
  meta: "text-text-tertiary font-semibold",
  context: "text-text-primary",
};

/** A diff as git printed it, coloured line by line. Used where the text comes from git rather than
 * from a before and after Draggy holds itself. */
export default function UnifiedDiff({ diff, maxHeight = 360 }: { diff: string; maxHeight?: number }) {
  const lines = classifyDiff(diff);

  return (
    <div
      className="overflow-auto rounded-xl border border-rule bg-surface-base font-mono text-[11px] leading-[1.45]"
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
