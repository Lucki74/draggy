import { useEffect, useRef } from "react";
import { Button, Icon } from "../ui";
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

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** A tool call the permission mode does not cover, asked where the call happens. The turn waits on
 * this card until a button is pressed, or its number key, as in Claude Code's menus. */
export default function ApprovalCard({ step, t, onAnswer }: ApprovalCardProps) {
  const approval = step.approval;
  const command = approval?.kind === "command";
  // A command that cannot be read safely is never remembered, so only "once" is offered for it.
  const remembers = !command || Boolean(approval?.allows?.length);
  const offered = CHOICES.filter((choice) => remembers || choice.answer === "once");
  const answers: ApprovalAnswer[] = [...offered.map((choice) => choice.answer), "no"];
  const pending = Boolean(approval && !step.answer && onAnswer);
  const approvalId = approval?.id;
  const firstChoice = useRef<HTMLButtonElement>(null);

  // Focus the first action only if the user is not actively typing in an input.
  useEffect(() => {
    if (pending && !isTyping(document.activeElement)) {
      firstChoice.current?.focus({ preventScroll: false });
    }
  }, [pending, approvalId]);

  useEffect(() => {
    if (!pending || !approvalId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      const index = Number(event.key) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= answers.length) return;
      event.preventDefault();
      onAnswer?.(approvalId, answers[index]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // answers is derived from approval; its join is a stable dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, approvalId, answers.join(), onAnswer]);

  if (!approval) return null;

  if (step.answer) {
    const allowed = step.answer !== "no";

    return (
      <div className="flex items-center gap-2 min-h-7 mb-1 text-[13px] text-text-secondary">
        <Icon name={allowed ? "check" : "x"} size={16} className="flex-shrink-0" />
        <span className="min-w-0 truncate">
          {allowed ? t("approvalAllowed") : t("approvalDeclined")}
          <span className={`text-text-tertiary ${command ? "font-mono text-[12px]" : ""}`}>
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

  const digit = (n: number) => (
    <span aria-hidden="true" className="font-mono text-[11px] opacity-60">
      {n}
    </span>
  );

  return (
    <div role="group" aria-live="polite" aria-label={t("approvalNeeded")} data-approval={approval.id} className="mb-4 rounded-md border border-rule-strong bg-surface-base p-4">
      <p className="text-[13px] text-warn">{t("approvalNeeded")}</p>

      {command ? (
        <>
          <p className="mt-2 text-[15px] font-medium text-text-primary">{t("approvalRunCommand")}</p>
          <pre className="mt-2 max-h-40 overflow-auto rounded-sm border border-rule bg-surface-canvas px-3 py-2 font-mono text-[13px] leading-5 whitespace-pre-wrap break-all text-text-primary">
            {approval.target}
          </pre>
        </>
      ) : (
        <>
          <p className="mt-2 font-mono text-[14px] text-text-primary">{approval.tool}</p>
          {approval.target && (
            <p className="mt-1 font-mono text-[12px] text-text-secondary break-all" title={approval.target}>
              {approval.target}
            </p>
          )}
        </>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {offered.map((choice, index) => (
          <Button
            key={choice.answer}
            ref={index === 0 ? firstChoice : undefined}
            variant={choice.primary ? "primary" : "secondary"}
            size="dense"
            aria-keyshortcuts={String(index + 1)}
            onClick={() => onAnswer?.(approval.id, choice.answer)}
          >
            {labelFor(choice)}
            {digit(index + 1)}
          </Button>
        ))}

        <Button
          variant="ghost"
          size="dense"
          className="!text-danger"
          aria-keyshortcuts={String(offered.length + 1)}
          onClick={() => onAnswer?.(approval.id, "no")}
        >
          {t("approvalNo")}
          {digit(offered.length + 1)}
        </Button>
      </div>
    </div>
  );
}
