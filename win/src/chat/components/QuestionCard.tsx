import React, { useEffect, useMemo, useState } from "react";
import type { QuestionOption, QuestionSession, UserAnswer, UserQuestion } from "../questionTypes";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/icons/Icon";

export interface QuestionCardProps {
  session: QuestionSession;
  questionIndex?: number;
  onAnswer: (questionId: string, value: string | string[]) => void;
  onSkip?: (questionId: string) => void;
  onNavigate?: (index: number) => void;
  onComplete?: () => void;
  readOnly?: boolean;
  t: (key: string) => string;
}

export function QuestionCard({
  session,
  questionIndex,
  onAnswer,
  onSkip,
  onNavigate,
  onComplete,
  readOnly = false,
  t,
}: QuestionCardProps) {
  const currentIndex = questionIndex ?? session.currentIndex;
  const question: UserQuestion | undefined = session.questions[currentIndex];

  // Existing submitted answer if any
  const existingAnswer = useMemo(() => {
    return session.answers.find((a) => a.questionId === question?.id);
  }, [session.answers, question?.id]);

  // Draft answers state
  const [singleValue, setSingleValue] = useState<string>("");
  const [multiValue, setMultiValue] = useState<string[]>([]);
  const [textValue, setTextValue] = useState<string>("");

  // Sync draft state when question or existing answer changes
  useEffect(() => {
    if (existingAnswer) {
      if (Array.isArray(existingAnswer.value)) {
        setMultiValue(existingAnswer.value);
        setSingleValue("");
        setTextValue("");
      } else {
        setSingleValue(existingAnswer.value);
        setTextValue(existingAnswer.value);
        setMultiValue([]);
      }
    } else {
      setSingleValue("");
      setMultiValue([]);
      setTextValue("");
    }
  }, [existingAnswer, question?.id]);

  if (!question) {
    return null;
  }

  const isExpired =
    session.status === "expired" ||
    (Boolean(question.expiresAt) && Date.now() > (question.expiresAt ?? 0));
  const isAnswered = Boolean(existingAnswer);
  const isLastQuestion = currentIndex >= session.questions.length - 1;

  // Determine button enablement
  let canSubmit = false;
  if (!readOnly && !isExpired) {
    if (question.type === "single") {
      canSubmit = Boolean(singleValue);
    } else if (question.type === "multi") {
      const min = question.minSelections ?? 0;
      canSubmit = multiValue.length >= min;
    } else if (question.type === "text") {
      canSubmit = !question.required || Boolean(textValue.trim());
    }
  }

  const handleSubmit = () => {
    if (!canSubmit) return;
    if (question.type === "single") {
      onAnswer(question.id, singleValue);
    } else if (question.type === "multi") {
      onAnswer(question.id, multiValue);
    } else if (question.type === "text") {
      onAnswer(question.id, textValue.trim());
    }

    if (isLastQuestion && onComplete) {
      onComplete();
    }
  };

  const handleSkip = () => {
    if (!question.required && onSkip) {
      onSkip(question.id);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const toggleMultiOption = (optId: string) => {
    if (readOnly || isExpired) return;
    setMultiValue((prev) => {
      const max = question.maxSelections ?? (question.options?.length ?? 999);
      if (prev.includes(optId)) {
        return prev.filter((id) => id !== optId);
      }
      if (prev.length >= max) return prev;
      return [...prev, optId];
    });
  };

  // Progress text: "1 of 4"
  const progressText = t("question.progress")
    .replace("{current}", String(currentIndex + 1))
    .replace("{total}", String(session.questions.length));

  return (
    <div
      data-testid="question-card"
      onKeyDown={handleKeyDown}
      className="my-3 max-w-[760px] mx-auto w-full rounded-lg border border-rule-strong bg-surface-base/90 p-4 shadow-sm backdrop-blur transition-all duration-150"
    >
      {/* Header: Status + Navigation + Progress */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-rule">
        <div className="flex items-center gap-2">
          {isExpired ? (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-danger/15 text-danger border border-danger/25">
              <span className="w-1.5 h-1.5 rounded-full bg-danger" />
              {t("question.timeout")}
            </span>
          ) : session.status === "skipped" ? (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-surface-raised text-text-tertiary border border-rule">
              {t("question.autoSkip")}
            </span>
          ) : isAnswered ? (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-accent-soft text-accent border border-accent/25">
              <Icon name="check" size={12} />
              {t("question.sessionCompleted")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              {t("question.requiresAction")}
            </span>
          )}

          <span className="text-[12px] text-text-tertiary">
            {question.type === "single"
              ? t("question.singleSelect")
              : question.type === "text"
                ? t("question.submit")
                : question.type === "multi"
              ? t("question.multiSelect")
              : t("question.text")}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {session.questions.length > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Previous question"
                disabled={currentIndex === 0}
                onClick={() => onNavigate && onNavigate(currentIndex - 1)}
                className="w-6 h-6 rounded flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-raised disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <Icon name="caret-left" size={14} />
              </button>
              <span className="text-[12px] text-text-secondary font-mono px-1">
                {progressText}
              </span>
              <button
                type="button"
                aria-label="Next question"
                disabled={currentIndex >= session.questions.length - 1}
                onClick={() => onNavigate && onNavigate(currentIndex + 1)}
                className="w-6 h-6 rounded flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-raised disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <Icon name="caret-right" size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Question Prompt */}
      <div className="py-3">
        <h4 className="text-[15px] font-semibold text-text-primary leading-snug">
          {question.text}
        </h4>
        {question.context && (
          <p className="mt-1 text-[12px] text-text-tertiary">{question.context}</p>
        )}
      </div>

      {/* Options / Input Body */}
      <div className="space-y-2 py-1">
        {question.type === "single" && (
          <div className="space-y-1.5" role="radiogroup" aria-label={question.text}>
            {question.options?.map((option: QuestionOption) => {
              const selected = singleValue === option.id;
              return (
                <label
                  key={option.id}
                  className={`group flex items-start gap-3 p-3 rounded-lg border text-start cursor-pointer transition-all duration-150 ${
                    selected
                      ? "border-accent/70 bg-accent/10 text-text-primary shadow-[0_0_0_1px_rgba(var(--accent-rgb,59,130,246),0.15)]"
                      : "border-rule bg-surface-raised/30 hover:bg-surface-raised/70 text-text-primary hover:border-rule-strong"
                  } ${readOnly || isExpired ? "cursor-default opacity-85" : ""}`}
                >
                  <input
                    type="radio"
                    name={`q_${question.id}`}
                    value={option.id}
                    checked={selected}
                    disabled={readOnly || isExpired}
                    onChange={() => setSingleValue(option.id)}
                    className="sr-only"
                  />
                  <div
                    className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 mt-0.5 transition-all duration-150 ${
                      selected
                        ? "border-accent bg-accent/15"
                        : "border-rule-control bg-surface-base group-hover:border-rule-strong"
                    }`}
                    aria-hidden="true"
                  >
                    {selected && <span className="w-2 h-2 rounded-full bg-accent" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium leading-5">{option.label}</div>
                    {option.description && (
                      <div className="text-[12px] text-text-secondary leading-4 mt-0.5">
                        {option.description}
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        )}

        {question.type === "multi" && (
          <div>
            {multiValue.length > 0 && (
              <div className="text-[12px] text-accent mb-2 font-medium">
                {t("question.selectedCount").replace("{count}", String(multiValue.length))}
              </div>
            )}
            <div className="space-y-1.5">
              {question.options?.map((option: QuestionOption) => {
                const selected = multiValue.includes(option.id);
                return (
                  <label
                    key={option.id}
                    className={`group flex items-start gap-3 p-3 rounded-lg border text-start cursor-pointer transition-all duration-150 ${
                      selected
                        ? "border-accent/70 bg-accent/10 text-text-primary shadow-[0_0_0_1px_rgba(var(--accent-rgb,59,130,246),0.15)]"
                        : "border-rule bg-surface-raised/30 hover:bg-surface-raised/70 text-text-primary hover:border-rule-strong"
                    } ${readOnly || isExpired ? "cursor-default opacity-85" : ""}`}
                  >
                    <input
                      type="checkbox"
                      value={option.id}
                      checked={selected}
                      disabled={readOnly || isExpired}
                      onChange={() => toggleMultiOption(option.id)}
                      className="sr-only"
                    />
                    <div
                      className={`w-4 h-4 rounded-[4px] border flex items-center justify-center shrink-0 mt-0.5 transition-all duration-150 ${
                        selected
                          ? "border-accent bg-accent text-surface-canvas shadow-xs"
                          : "border-rule-control bg-surface-base group-hover:border-rule-strong"
                      }`}
                      aria-hidden="true"
                    >
                      {selected && <Icon name="check" size={11} className="stroke-[3]" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium leading-5">{option.label}</div>
                      {option.description && (
                        <div className="text-[12px] text-text-secondary leading-4 mt-0.5">
                          {option.description}
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {question.type === "text" && (
          <div>
            <textarea
              rows={3}
              value={textValue}
              disabled={readOnly || isExpired}
              onChange={(e) => setTextValue(e.target.value)}
              placeholder={t("question.placeholderText")}
              className="w-full rounded-md border border-rule-control bg-surface-base p-2.5 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus disabled:opacity-60 resize-y"
            />
          </div>
        )}
      </div>

      {/* Bottom Footer Actions */}
      {!readOnly && !isExpired && (
        <div className="mt-3 pt-3 border-t border-rule flex items-center justify-between gap-2">
          <div>
            {!question.required && (
              <Button variant="ghost" size="dense" onClick={handleSkip}>
                {t("question.skip")}
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-block text-[11px] text-text-tertiary">
              Ctrl+Enter
            </span>
            <Button
              variant="primary"
              size="dense"
              disabled={!canSubmit}
              onClick={handleSubmit}
            >
              {isLastQuestion
                ? t("question.send")
                : question.type === "multi"
                ? t("question.send")
                : t("question.next")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
