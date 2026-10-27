import React, { useState } from "react";
import type { QuestionSession } from "../questionTypes";
import { Icon } from "../../ui/icons/Icon";

export interface QuestionHistoryCardProps {
  session: QuestionSession;
  t: (key: string) => string;
}

export function QuestionHistoryCard({ session, t }: QuestionHistoryCardProps) {
  const [expanded, setExpanded] = useState(false);

  const answeredCount = session.answers.length;
  const isSkipped = session.status === "skipped";
  const countText =
    answeredCount === 1
      ? (!t("question.singleAnswer") || t("question.singleAnswer") === "question.singleAnswer"
          ? "1 answer"
          : t("question.singleAnswer"))
      : (!t("question.multipleAnswers") || t("question.multipleAnswers") === "question.multipleAnswers"
          ? `${answeredCount} answers`
          : t("question.multipleAnswers").replace("{count}", String(answeredCount)));

  return (
    <div className="my-2 max-w-[760px] mx-auto w-full rounded-md border border-rule bg-surface-raised/30 text-text-primary text-[13px] overflow-hidden transition-all duration-150">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-start hover:bg-surface-raised/60 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span
            className={`w-4 h-4 rounded-full flex items-center justify-center ${
              isSkipped
                ? "bg-surface-raised text-text-tertiary"
                : "bg-accent/15 text-accent"
            }`}
          >
            <Icon name={isSkipped ? "x" : "check"} size={11} />
          </span>
          <span className="font-medium text-text-secondary text-[12px]">
            {isSkipped ? t("question.autoSkip") : `${t("question.sessionCompleted")}: ${countText}`}
          </span>
        </div>
        <div className="flex items-center gap-1 text-text-tertiary text-[11px]">
          <span>{expanded ? t("question.collapseAnswers") : t("question.expandAnswers")}</span>
          <Icon
            name="caret-down"
            size={13}
            className={`transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      {expanded && (
        <div className="px-3.5 py-2.5 border-t border-rule space-y-2.5 bg-surface-base/50">
          {session.questions.map((q, idx) => {
            const ans = session.answers.find((a) => a.questionId === q.id);
            let displayAnswer = "–";
            if (ans) {
              if (Array.isArray(ans.value)) {
                const labels = ans.value.map((id) => {
                  const opt = q.options?.find((o) => o.id === id);
                  return opt ? opt.label : id;
                });
                displayAnswer = labels.join(", ");
              } else {
                const opt = q.options?.find((o) => o.id === ans.value);
                displayAnswer = opt ? opt.label : ans.value;
              }
            }

            return (
              <div key={q.id} className="border-b border-rule/40 pb-2 last:border-b-0 last:pb-0">
                <div className="text-[12px] font-medium text-text-secondary">
                  {idx + 1}. {q.text}
                </div>
                <div className="text-[12px] text-text-primary font-medium mt-0.5 ps-2.5 border-s-2 border-accent/40">
                  {displayAnswer}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
