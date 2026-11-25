import { useContext, useEffect, useState } from "react";
import { Button, Icon } from "../ui";
import { AnswerQuestionContext } from "./questionContext";
import type { QuestionAnswer, QuestionItem, SearchStep } from "../types";

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const EMPTY: QuestionAnswer = { choices: [], text: "" };
const given = (answer: QuestionAnswer | undefined) =>
  answer ? [...answer.choices, answer.text].filter(Boolean).join("; ") : "";

/** A question the model asked, answered where it was asked. A card may hold several questions,
 * which the user steps through. Digits pick an option, Enter goes on and Esc skips. */
export default function QuestionCard({ step, t }: { step: SearchStep; t: (key: string) => string }) {
  const question = step.question;
  const answer = useContext(AnswerQuestionContext);
  const items: QuestionItem[] = question ? [question, ...(question.more ?? [])] : [];
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<QuestionAnswer[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState("");
  const pending = Boolean(question && !step.reply && answer);
  const item = items[index];
  const last = index === items.length - 1;
  const hasOptions = Boolean(item?.options.length);
  const hasAnswer = picked.length > 0 || text.trim().length > 0;

  /** Records this question's answer and moves on, or sends everything after the last one. */
  const advance = (choices: string[], note: string) => {
    if (!question || !answer) return;
    const next = [...answers.slice(0, index), { choices, text: note.trim() }];
    if (!last) {
      const kept = answers[index + 1] ?? EMPTY;
      setAnswers([...next, ...answers.slice(index + 1)]);
      setIndex(index + 1);
      setPicked(kept.choices);
      setText(kept.text);
      return;
    }
    const [first, ...more] = next;
    if (!next.some((one) => one.choices.length || one.text)) {
      answer(question.id, null);
      return;
    }
    answer(question.id, { ...first, ...(more.length ? { more } : {}) });
  };

  const back = () => {
    const before = answers[index - 1] ?? EMPTY;
    setAnswers((now) => {
      const copy = [...now];
      copy[index] = { choices: picked, text: text.trim() };
      return copy;
    });
    setIndex(index - 1);
    setPicked(before.choices);
    setText(before.text);
  };

  const toggle = (option: string) => {
    if (!item) return;
    if (item.multiple) {
      setPicked((now) => (now.includes(option) ? now.filter((one) => one !== option) : [...now, option]));
      return;
    }
    // One choice answers at once, unless a note is already typed to go with it.
    if (!text.trim()) advance([option], "");
    else setPicked([option]);
  };

  const skip = () => (last && !answers.some((one) => one.choices.length || one.text) ? answer?.(question!.id, null) : advance([], ""));

  useEffect(() => {
    if (!pending || !question || !item) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape") {
        event.preventDefault();
        answer?.(question.id, null);
        return;
      }
      if (isTyping(event.target)) return;
      const option = item.options[Number(event.key) - 1];
      if (option) {
        event.preventDefault();
        toggle(option);
      } else if (event.key === "Enter" && hasAnswer) {
        event.preventDefault();
        advance(picked, text);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // toggle and advance close over the card's state, so they follow it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, question, item, index, picked, text, answers, answer]);

  if (!question) return null;

  if (step.reply) {
    const reply = step.reply === "cancelled" ? null : step.reply;
    const replies = reply ? [reply, ...(reply.more ?? [])] : [];
    return (
      <div className="mb-2 flex flex-col gap-1.5 text-[13px] text-text-secondary">
        {items.map((one, at) => {
          const said = given(replies[at]);
          return (
            <div key={at} className="flex min-h-7 items-start gap-2">
              <Icon name={said ? "check" : "x"} size={16} className="mt-0.5 flex-shrink-0" />
              <span className="min-w-0">
                <span className="text-text-tertiary">{one.text}</span>
                <span className="block break-words text-text-primary">
                  {said ? `${t("questionYouAnswered")}: ${said}` : t("questionSkipped")}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  if (!item) return null;

  return (
    <div
      role="group"
      aria-live="polite"
      aria-label={t("questionAsked")}
      data-approval={question.id}
      className="mb-4 overflow-hidden rounded-md border border-rule-strong bg-surface-base"
    >
      <div className="flex items-center gap-2 border-b border-rule px-4 py-2 text-[12px] text-accent-ink">
        <Icon name="chat-circle" size={14} className="flex-shrink-0" />
        <span className="font-medium">{t("questionAsked")}</span>
        {items.length > 1 && (
          <>
            <span className="ms-auto text-text-tertiary">
              {t("questionProgress").replace("{current}", String(index + 1)).replace("{total}", String(items.length))}
            </span>
            <span aria-hidden="true" className="flex gap-1">
              {items.map((_, at) => (
                <span
                  key={at}
                  className={`h-1.5 w-4 rounded-full ${at === index ? "bg-accent" : at < index ? "bg-accent-soft" : "bg-rule"}`}
                />
              ))}
            </span>
          </>
        )}
      </div>

      <div className="p-4">
        <p className="whitespace-pre-wrap break-words text-[15px] font-medium text-text-primary">{item.text}</p>

        {hasOptions && (
          <div role={item.multiple ? "group" : "radiogroup"} className="mt-3 flex flex-col gap-1.5">
            {item.options.map((option, at) => {
              const on = picked.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  role={item.multiple ? "checkbox" : "radio"}
                  aria-checked={on}
                  aria-keyshortcuts={String(at + 1)}
                  onClick={() => toggle(option)}
                  className={`flex items-start gap-2.5 rounded-sm border px-3 py-2 text-start text-[14px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus ${
                    on ? "border-accent bg-accent-soft text-text-primary" : "border-rule text-text-primary hover:border-rule-control hover:bg-surface-canvas"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="mt-px flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-xs border border-rule font-mono text-[11px] text-text-tertiary"
                  >
                    {at + 1}
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
              if (hasAnswer) advance(picked, text);
            }
          }}
          aria-label={hasOptions ? t("questionOther") : item.text}
          placeholder={hasOptions ? t("questionOther") : ""}
          className="mt-3 w-full resize-none rounded-sm border border-rule bg-surface-canvas px-3 py-2 text-[14px] text-text-primary outline-none placeholder:text-text-tertiary focus-visible:ring-2 focus-visible:ring-focus"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {index > 0 && (
            <Button variant="ghost" size="dense" onClick={back}>
              {t("questionBack")}
            </Button>
          )}
          <Button variant="primary" size="dense" disabled={!hasAnswer} onClick={() => advance(picked, text)}>
            {last ? t("questionSend") : t("questionNext")}
          </Button>
          <Button variant="ghost" size="dense" onClick={skip}>
            {t("questionSkip")}
          </Button>
          <span className="ms-auto hidden text-[11px] text-text-tertiary sm:inline">{t("questionHint")}</span>
        </div>
      </div>
    </div>
  );
}
