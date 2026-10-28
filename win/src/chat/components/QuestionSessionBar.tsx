import React, { useState } from "react";
import type { QuestionSession } from "../questionTypes";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/icons/Icon";

export interface QuestionSessionBarProps {
  session: QuestionSession;
  onViewAll?: () => void;
  onDismiss?: () => void;
  t: (key: string) => string;
}

export function QuestionSessionBar({
  session,
  onViewAll,
  onDismiss,
  t,
}: QuestionSessionBarProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || session.status === "skipped") {
    return null;
  }

  const answeredCount = session.answers.length;
  const totalCount = session.questions.length;
  const isCompleted = session.status === "completed" || answeredCount >= totalCount;
  const isExpired = session.status === "expired";
  const needsAction = !isCompleted && !isExpired;

  // Status styles
  let statusColor = "bg-blue-500/10 text-blue-400 border-blue-500/20";
  let statusText = t("question.sessionBar");
  let dotColor = "bg-blue-400";

  if (isCompleted) {
    statusColor = "bg-accent-soft text-accent border-accent/30";
    statusText = t("question.sessionCompleted");
    dotColor = "bg-accent";
  } else if (isExpired) {
    statusColor = "bg-danger/10 text-danger border-danger/25";
    statusText = t("question.timeout");
    dotColor = "bg-danger";
  } else if (needsAction) {
    statusColor = "bg-amber-500/10 text-amber-400 border-amber-500/25";
    statusText = t("question.requiresAction");
    dotColor = "bg-amber-400 animate-pulse";
  }

  const progressLabel = `${answeredCount}/${totalCount} ${t("skillsYours") ? "questions" : "answered"}`;

  return (
    <div
      role="region"
      aria-label={t("question.sessionBar")}
      className="sticky top-0 z-20 flex items-center justify-between gap-3 px-4 py-2 bg-surface-raised/95 border-b border-rule backdrop-blur transition-all duration-150"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border ${statusColor}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
          {statusText}
        </span>
        <span className="text-[12px] text-text-secondary truncate font-mono">
          {progressLabel}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {onViewAll && (
          <Button variant="ghost" size="dense" onClick={onViewAll}>
            {t("question.viewAll")}
          </Button>
        )}
        <button
          type="button"
          aria-label="Dismiss session bar"
          onClick={() => {
            setDismissed(true);
            onDismiss?.();
          }}
          className="w-6 h-6 rounded flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-surface-base transition-colors"
        >
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>
  );
}
