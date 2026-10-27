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

  return (
    <div className="my-2 max-w-[760px] mx-auto w-full rounded-md border border-rule bg-surface-raised/40 text-text-primary text-[13px] overflow-hidden transition-all duration-150">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between px-3.5 py-2 text-start hover:bg-surface-raised/70 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-accent/15 text-accent flex items-center justify-center">
            <Icon name="check" size={12} />
          </span>
          <span className="font-medium text-text-secondary">
            {t("question.sessionCompleted")}: {answeredCount} {t("skillsYours") ? "answers" : "questions"}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-text-tertiary text-[12px]">
          <span>{expanded ? t("question.collapseAnswers") : t("question.expandAnswers")}</span>
          <Icon
            name="caret-down"
            size={14}
            className={`transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      {expanded && (
        <div className="px-4 py-3 border-t border-rule space-y-3 bg-surface-base/60">
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
              <div key={q.id} className="border-b border-rule/50 pb-2.5 last:border-b-0 last:pb-0">
                <div className="text-[12px] font-medium text-text-secondary">
                  {idx + 1}. {q.text}
                </div>
                <div className="text-[13px] text-text-primary font-medium mt-0.5 ps-3 border-s-2 border-accent/40">
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
