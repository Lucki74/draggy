import { useContext, useEffect, useState } from "react";
import { Button, Icon } from "../ui";
import { AnswerQuestionContext } from "./questionContext";
import type { SearchStep } from "../types";

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** A question the model asked, answered where it was asked. Digits pick an option, Enter sends and
 * Esc skips, as in Claude Code's question menu. */
export default function QuestionCard({ step, t }: { step: SearchStep; t: (key: string) => string }) {
  const question = step.question;
  const answer = useContext(AnswerQuestionContext);
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState("");
  const pending = Boolean(question && !step.reply && answer);
  const hasOptions = Boolean(question?.options.length);

  const send = () => {
    if (!question || !answer) return;
    if (!picked.length && !text.trim()) return;
    answer(question.id, { choices: picked, text: text.trim() });
  };

  const toggle = (option: string) => {
    if (!question) return;
    if (question.multiple) {
      setPicked((now) => (now.includes(option) ? now.filter((one) => one !== option) : [...now, option]));
      return;
    }
    // One choice answers at once, unless a note is already typed to go with it.
    if (!text.trim() && answer) answer(question.id, { choices: [option], text: "" });
    else setPicked([option]);
  };

  useEffect(() => {
    if (!pending || !question) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape") {
        event.preventDefault();
        answer?.(question.id, null);
        return;
      }
      if (isTyping(event.target)) return;
      const option = question.options[Number(event.key) - 1];
      if (option) {
        event.preventDefault();
        toggle(option);
      } else if (event.key === "Enter" && picked.length) {
        event.preventDefault();
        send();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // toggle and send close over picked and text, so they follow them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, question, picked, text, answer]);

  if (!question) return null;

  if (step.reply) {
    const reply = step.reply;
    const given = reply === "cancelled" ? [] : [...reply.choices, reply.text].filter(Boolean);
    return (
      <div className="mb-1 flex min-h-7 items-start gap-2 text-[13px] text-text-secondary">
        <Icon name={given.length ? "check" : "x"} size={16} className="mt-0.5 flex-shrink-0" />
        <span className="min-w-0">
          <span className="text-text-tertiary">{question.text}</span>
          <span className="block break-words text-text-primary">
            {given.length ? `${t("questionYouAnswered")}: ${given.join("; ")}` : t("questionSkipped")}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-live="polite"
      aria-label={t("questionAsked")}
      data-approval={question.id}
      className="mb-4 rounded-md border border-rule-strong bg-surface-base p-4"
    >
      <p className="text-[13px] text-accent-ink">{t("questionAsked")}</p>
      <p className="mt-2 whitespace-pre-wrap break-words text-[15px] font-medium text-text-primary">{question.text}</p>

      {hasOptions && (
        <div role={question.multiple ? "group" : "radiogroup"} className="mt-3 flex flex-col gap-1.5">
          {question.options.map((option, index) => {
            const on = picked.includes(option);
            return (
              <button
                key={option}
                type="button"
                role={question.multiple ? "checkbox" : "radio"}
                aria-checked={on}
                aria-keyshortcuts={String(index + 1)}
                onClick={() => toggle(option)}
                className={`flex items-start gap-2 rounded-sm border px-3 py-2 text-start text-[14px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus ${
                  on ? "border-accent bg-accent-soft text-text-primary" : "border-rule text-text-primary hover:border-rule-control"
                }`}
              >
                <span aria-hidden="true" className="mt-0.5 font-mono text-[11px] opacity-60">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 break-words">{option}</span>
                {on && <Icon name="check" size={16} className="mt-0.5 flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      )}

      <textarea
        value={text}
        rows={hasOptions ? 1 : 3}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
          }
        }}
        aria-label={hasOptions ? t("questionOther") : question.text}
        placeholder={hasOptions ? t("questionOther") : ""}
        className="mt-3 w-full resize-none rounded-sm border border-rule bg-surface-canvas px-3 py-2 text-[14px] text-text-primary outline-none placeholder:text-text-tertiary focus-visible:ring-2 focus-visible:ring-focus"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" size="dense" disabled={!picked.length && !text.trim()} onClick={send}>
          {t("questionSend")}
        </Button>
        <Button variant="ghost" size="dense" onClick={() => answer?.(question.id, null)}>
          {t("questionSkip")}
        </Button>
        <span className="ms-auto text-[11px] text-text-tertiary">{t("questionHint")}</span>
      </div>
    </div>
  );
}
