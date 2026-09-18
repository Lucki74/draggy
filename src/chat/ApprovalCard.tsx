import { Check, ShieldAlert, SquareTerminal, X } from "lucide-react";
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

/** A tool call the permission mode does not cover, asked where the call happens. The turn waits on
 * this card until a button is pressed. */
export default function ApprovalCard({ step, t, onAnswer }: ApprovalCardProps) {
  const approval = step.approval;
  if (!approval) return null;

  const command = approval.kind === "command";
  // A command that cannot be read safely is never remembered, so only "once" is offered for it.
  const remembers = !command || Boolean(approval.allows?.length);

  if (step.answer) {
    const allowed = step.answer !== "no";

    return (
      <div className="flex items-center space-x-3 mb-3 text-[var(--text-muted)]">
        {allowed ? (
          <Check className="w-4 h-4 opacity-60 flex-shrink-0" />
        ) : (
          <X className="w-4 h-4 opacity-60 flex-shrink-0" />
        )}
        <span className="min-w-0 text-sm font-bold tracking-tight truncate">
          {allowed ? t("approvalAllowed") : t("approvalDeclined")}
          <span className={`opacity-60 ${command ? "font-mono" : ""}`}>
            {" "}
            · {command && approval.target ? approval.target : approval.tool}
          </span>
        </span>
      </div>
    );
  }

  const labelFor = (choice: (typeof CHOICES)[number]) =>
    command && choice.answer === "workspace"
      ? t("allowAlwaysCommand").replace("{command}", (approval.allows ?? []).join(", "))
      : t(choice.label);

  return (
    <div className="mb-3 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] p-4">
      <div className="flex items-center space-x-3">
        <ShieldAlert className="w-4 h-4 flex-shrink-0 text-[var(--text-main)]" />
        <span className="text-sm font-bold tracking-tight text-[var(--text-main)]">
          {t("approvalNeeded")}
        </span>
      </div>

      {command ? (
        <>
          <p className="mt-2 flex items-center gap-2 text-sm font-bold tracking-tight text-[var(--text-main)]">
            <SquareTerminal className="w-4 h-4 flex-shrink-0 opacity-70" />
            {t("approvalRunCommand")}
          </p>
          <pre className="mt-2 max-h-40 overflow-auto rounded-lg border-2 border-[var(--border-light)] bg-[var(--bg-base)] px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all text-[var(--text-main)]">
            {approval.target}
          </pre>
        </>
      ) : (
        <>
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
        </>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {CHOICES.filter((choice) => remembers || choice.answer === "once").map((choice) => (
          <button
            key={choice.answer}
            onClick={() => onAnswer?.(approval.id, choice.answer)}
            className={
              choice.primary
                ? "rounded-xl bg-[var(--bg-inverted)] px-3 py-2 text-xs font-bold uppercase tracking-wider text-[var(--text-inverted)] transition-opacity hover:opacity-90"
                : "rounded-xl border-[3px] border-[var(--border-light)] px-3 py-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] transition-colors hover:text-[var(--text-main)]"
            }
          >
            {labelFor(choice)}
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
