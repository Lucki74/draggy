import { useState } from "react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Icon, type IconName } from "../ui/icons/Icon";
import {
  addItem,
  editItem,
  isFinished,
  moveItem,
  planProgress,
  removeItem,
  toggleItem,
} from "./plan";
import type { PlanItem, PlanStatus } from "./plan";

interface PlanPanelProps {
  items: PlanItem[];
  onChange: (items: PlanItem[]) => void;
  /** Sends the model back to work on a plan it did not finish. */
  onContinue?: () => void;
  running: boolean;
  t: (key: string) => string;
  hideHeader?: boolean;
  /** Plan mode: the model wrote a plan and stopped, so the user reviews it before anything changes. */
  awaitingReview?: boolean;
  onProceed?: () => void;
  onComment?: (text: string) => void;
}

const STATUS: Record<PlanStatus, { icon: IconName; label: string; tone: string }> = {
  todo: { icon: "circle", label: "planStatusTodo", tone: "text-text-tertiary" },
  doing: { icon: "circle-half", label: "planStatusDoing", tone: "text-text-primary" },
  done: { icon: "check-circle", label: "planStatusDone", tone: "text-ok" },
};

/** One step's text. Reads as plain text and only looks like a field while it has focus. */
function StepText({ item, onCommit, label }: { item: PlanItem; onCommit: (text: string) => void; label: string }) {
  const [value, setValue] = useState(item.text);

  return (
    <input
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => (value.trim() ? onCommit(value) : setValue(item.text))}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setValue(item.text);
          requestAnimationFrame(() => (event.target as HTMLInputElement).blur());
        }
      }}
      aria-label={label}
      className={`min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-[13px] leading-5 outline-none transition-colors focus:border-rule-control focus:bg-surface-base ${
        item.status === "done"
          ? "text-text-tertiary line-through focus:no-underline"
          : item.status === "doing"
            ? "font-medium text-text-primary"
            : "text-text-secondary"
      }`}
    />
  );
}

/** The model's plan and progress. The user can tick, reword, add, remove and reorder while it
 * works, and the loop is told on its next pass. */
export default function PlanPanel({
  items,
  onChange,
  onContinue,
  running,
  t,
  hideHeader = false,
  awaitingReview = false,
  onProceed,
  onComment,
}: PlanPanelProps) {
  const [draft, setDraft] = useState("");
  const [comment, setComment] = useState("");

  const finished = isFinished(items);
  const reviewing = awaitingReview && !running && items.length > 0 && !finished;

  const submit = () => {
    const next = addItem(items, draft);
    if (next !== items) {
      onChange(next);
      setDraft("");
    }
  };

  const sendComment = () => {
    if (!comment.trim()) return;
    onComment?.(comment.trim());
    setComment("");
  };

  return (
    <div className="flex h-full flex-col bg-surface-canvas">
      {!hideHeader && (
        <div className="flex h-9 items-center justify-between gap-2 border-b border-rule px-3">
          <span className="text-[12px] font-medium text-text-secondary">{t("plan")}</span>
          <span className="text-[12px] tabular-nums text-text-tertiary">{planProgress(items, t)}</span>
        </div>
      )}

      <ul className="flex-1 overflow-y-auto px-2 py-1.5">
        {items.map((item, index) => {
          const status = STATUS[item.status];
          return (
            <li key={item.id} className="group/step flex min-h-8 items-center gap-1 rounded-md hover:bg-surface-raised/60">
              <button
                type="button"
                onClick={() => onChange(toggleItem(items, item.id))}
                aria-label={`${item.text}, ${t(status.label)}`}
                aria-pressed={item.status === "done"}
                title={t(status.label)}
                className={`flex size-7 flex-shrink-0 items-center justify-center rounded-md ${status.tone} hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus`}
              >
                <Icon name={status.icon} size={16} filled={item.status === "done"} />
              </button>

              <StepText
                key={item.text}
                item={item}
                label={t("editStep")}
                onCommit={(text) => {
                  const next = editItem(items, item.id, text);
                  if (next !== items) onChange(next);
                }}
              />

              {item.status === "doing" && (
                <span className="flex-shrink-0 pe-1 text-[11px] text-text-tertiary group-hover/step:hidden group-focus-within/step:hidden">
                  {t(status.label)}
                </span>
              )}

              <span className="hidden flex-shrink-0 group-hover/step:flex group-focus-within/step:flex">
                <IconButton
                  name="arrow-up"
                  size="sm"
                  label={t("moveUp")}
                  disabled={index === 0}
                  onClick={() => onChange(moveItem(items, item.id, -1))}
                />
                <IconButton
                  name="arrow-down"
                  size="sm"
                  label={t("moveDown")}
                  disabled={index === items.length - 1}
                  onClick={() => onChange(moveItem(items, item.id, 1))}
                />
                <IconButton name="x" size="sm" label={t("removeStep")} onClick={() => onChange(removeItem(items, item.id))} />
              </span>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center gap-1 border-t border-rule px-2 py-1.5">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          placeholder={t("addStep")}
          aria-label={t("addStep")}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[13px] text-text-primary outline-none placeholder:text-text-tertiary focus:border-rule-control focus:bg-surface-base"
        />
        <IconButton name="plus" size="dense" label={t("addStep")} onClick={submit} />
      </div>

      {reviewing && (
        <div className="flex flex-col gap-2 border-t border-rule bg-surface-base p-3">
          <p className="text-[12px] leading-5 text-text-secondary">{t("planReviewHint")}</p>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) sendComment();
            }}
            rows={2}
            placeholder={t("planComment")}
            aria-label={t("planComment")}
            className="w-full resize-none rounded-md border border-rule-control bg-surface-canvas px-2 py-1.5 text-[13px] text-text-primary outline-none placeholder:text-text-tertiary focus:border-focus"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="dense" disabled={!comment.trim()} onClick={sendComment}>
              {t("planSendComment")}
            </Button>
            <Button size="dense" icon={<Icon name="play" size={16} />} onClick={onProceed}>
              {t("planProceed")}
            </Button>
          </div>
        </div>
      )}

      {!reviewing && !running && !finished && onContinue && (
        <div className="border-t border-rule p-2">
          <Button variant="ghost" size="dense" className="w-full" icon={<Icon name="play" size={16} />} onClick={onContinue}>
            {t("continuePlan")}
          </Button>
        </div>
      )}
    </div>
  );
}
