import { useState } from "react";
import { ArrowDown, ArrowUp, Check, Play, Plus, X } from "lucide-react";
import {
  addItem,
  isFinished,
  moveItem,
  planSummary,
  removeItem,
  toggleItem,
} from "./plan";
import type { PlanItem } from "./plan";

interface PlanPanelProps {
  items: PlanItem[];
  onChange: (items: PlanItem[]) => void;
  /** Sends the model back to work on a plan it did not finish. */
  onContinue?: () => void;
  running: boolean;
  t: (key: string) => string;
}

/**
 * What the model said it would do, and where it has got to. The user can tick,
 * add, remove and reorder while it works: the loop is told on its next pass,
 * which is the difference between a plan and a progress bar.
 */
export default function PlanPanel({
  items,
  onChange,
  onContinue,
  running,
  t,
}: PlanPanelProps) {
  const [draft, setDraft] = useState("");

  const { done, total } = planSummary(items);
  const finished = isFinished(items);

  const submit = () => {
    const next = addItem(items, draft);
    if (next !== items) {
      onChange(next);
      setDraft("");
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex items-center justify-between gap-2 px-3 py-2 border-b-[3px]"
        style={{ borderColor: "var(--border-light)" }}
      >
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
          {t("plan")}
        </span>
        <span className="text-[10px] font-bold tabular-nums text-[var(--text-muted)]">
          {done}/{total}
        </span>
      </div>

      <ul className="flex-1 overflow-y-auto p-2">
        {items.map((item, index) => (
          <li key={item.id} className="group/step flex items-start gap-1.5 py-1">
            <button
              onClick={() => onChange(toggleItem(items, item.id))}
              aria-label={item.text}
              aria-pressed={item.status === "done"}
              className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border-[2px] transition-colors ${
                item.status === "done"
                  ? "border-[var(--bg-inverted)] bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                  : "border-[var(--border-light)]"
              }`}
            >
              {item.status === "done" && <Check className="h-3 w-3" />}
            </button>

            <span
              className={`flex-1 text-xs leading-5 ${
                item.status === "done"
                  ? "text-[var(--text-muted)] line-through"
                  : item.status === "doing"
                    ? "font-bold"
                    : ""
              }`}
            >
              {item.text}
            </span>

            <span className="flex flex-shrink-0 opacity-0 transition-opacity group-hover/step:opacity-60">
              <button
                onClick={() => onChange(moveItem(items, item.id, -1))}
                disabled={index === 0}
                aria-label={t("moveUp")}
                className="p-0.5 hover:opacity-100 disabled:opacity-30"
              >
                <ArrowUp className="h-3 w-3" />
              </button>
              <button
                onClick={() => onChange(moveItem(items, item.id, 1))}
                disabled={index === items.length - 1}
                aria-label={t("moveDown")}
                className="p-0.5 hover:opacity-100 disabled:opacity-30"
              >
                <ArrowDown className="h-3 w-3" />
              </button>
              <button
                onClick={() => onChange(removeItem(items, item.id))}
                aria-label={t("removeStep")}
                className="p-0.5 hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </li>
        ))}
      </ul>

      <div
        className="flex items-center gap-1 border-t-[3px] p-2"
        style={{ borderColor: "var(--border-light)" }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          placeholder={t("addStep")}
          aria-label={t("addStep")}
          className="min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1 text-xs outline-none placeholder:text-[var(--text-muted)]"
        />
        <button
          onClick={submit}
          aria-label={t("addStep")}
          className="p-1 rounded-lg text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {!running && !finished && onContinue && (
        <button
          onClick={onContinue}
          className="flex items-center justify-center gap-2 border-t-[3px] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-main)]"
          style={{ borderColor: "var(--border-light)" }}
        >
          <Play className="h-3 w-3" />
          {t("continuePlan")}
        </button>
      )}
    </div>
  );
}
