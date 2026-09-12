import { Check, ShieldAlert, X } from "lucide-react";
import type { ApprovalAnswer, SearchStep } from "../types";

interface ApprovalCardProps {
  step: SearchStep;
  t: (key: string) => string;
  onAnswer?: (approvalId: string, answer: ApprovalAnswer) => void;
}

const CHOICES: { answer: ApprovalAnswer; label: string; primary?: boolean }[] = [
  { answer: "once", label: "allowOnce", primary: true },
  { answer: "task", label: "allowForTask" },
  { answer: "workspace", label: "allowAlways" },
];

/**
 * A tool call the conversation's permission mode does not cover, put to the
 * user in the timeline where the call would have happened. The turn is parked
 * on this card until one of the buttons is pressed.
 */
export default function ApprovalCard({ step, t, onAnswer }: ApprovalCardProps) {
  const approval = step.approval;
  if (!approval) return null;

  if (step.answer) {
    const allowed = step.answer !== "no";

    return (
      <div className="flex items-center space-x-3 mb-3 text-[var(--text-muted)]">
        {allowed ? (
          <Check className="w-4 h-4 opacity-60 flex-shrink-0" />
        ) : (
          <X className="w-4 h-4 opacity-60 flex-shrink-0" />
        )}
        <span className="text-sm font-bold tracking-tight">
          {allowed ? t("approvalAllowed") : t("approvalDeclined")}
          <span className="opacity-60"> · {approval.tool}</span>
        </span>
      </div>
    );
  }

  return (
    <div className="mb-3 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] p-4">
      <div className="flex items-center space-x-3">
        <ShieldAlert className="w-4 h-4 flex-shrink-0 text-[var(--text-main)]" />
        <span className="text-sm font-bold tracking-tight text-[var(--text-main)]">
          {t("approvalNeeded")}
        </span>
      </div>

      <p className="mt-2 text-sm font-bold tracking-tight text-[var(--text-main)]">
        {approval.tool}
      </p>

      {approval.target && (
        <p
          className="mt-1 text-xs text-[var(--text-muted)] break-all"
          title={approval.target}
        >
          {approval.target}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {CHOICES.map((choice) => (
          <button
            key={choice.answer}
            onClick={() => onAnswer?.(approval.id, choice.answer)}
            className={
              choice.primary
                ? "rounded-xl bg-[var(--bg-inverted)] px-3 py-2 text-xs font-bold uppercase tracking-wider text-[var(--text-inverted)] transition-opacity hover:opacity-90"
                : "rounded-xl border-[3px] border-[var(--border-light)] px-3 py-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] transition-colors hover:text-[var(--text-main)]"
            }
          >
            {t(choice.label)}
          </button>
        ))}

        <button
          onClick={() => onAnswer?.(approval.id, "no")}
          className="rounded-xl border-[3px] border-[var(--border-light)] px-3 py-2 text-xs font-bold uppercase tracking-wider text-red-500 transition-colors hover:border-red-500"
        >
          {t("approvalNo")}
        </button>
      </div>
    </div>
  );
}
