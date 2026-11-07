import { useContext, useState } from "react";
import { Button, Icon } from "../ui";
import { AnswerQuestionContext } from "./questionContext";
import { DEPTH_IDS, DEPTHS, SOURCE_KINDS, type Depth, type ResearchPlan, type SourceKind } from "../research/run";
import type { SearchStep } from "../types";

const DEPTH_KEY: Record<Depth, string> = {
  quick: "researchDepthQuick",
  standard: "researchDepthStandard",
  deep: "researchDepthDeep",
};

const SOURCE_KEY: Record<SourceKind, string> = {
  web: "researchSourceWeb",
  papers: "researchSourcePapers",
  wiki: "researchSourceWiki",
  code: "researchSourceCode",
};

export const PLAN_APPROVE = "approve";

const chip = (on: boolean) =>
  `rounded-sm border px-2.5 py-1 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus ${
    on ? "border-accent bg-accent-soft text-text-primary" : "border-rule text-text-secondary hover:border-rule-control hover:bg-surface-canvas"
  }`;

/** The plan a research run waits on. The user edits the sub-questions, depth and sources, then
 * approves it, and the edited plan goes back to the model as JSON in the reply text. */
export default function ResearchPlanCard({ step, t }: { step: SearchStep; t: (key: string) => string }) {
  const answer = useContext(AnswerQuestionContext);
  const drafted = step.researchPlan;
  const [questions, setQuestions] = useState<string[]>(drafted?.subQuestions ?? []);
  const [depth, setDepth] = useState<Depth>(drafted?.depth ?? "standard");
  const [sources, setSources] = useState<SourceKind[]>(drafted?.sources ?? ["web"]);

  if (!drafted || !step.question) return null;
  const id = step.question.id;

  if (step.reply) {
    const approved = step.reply !== "cancelled" && step.reply.choices.includes(PLAN_APPROVE);
    return (
      <div className="mb-2 flex min-h-7 items-start gap-2 text-[13px] text-text-secondary">
        <Icon name={approved ? "check" : "x"} size={16} className="mt-0.5 flex-shrink-0" />
        <span className="min-w-0 break-words">
          {approved ? t("researchApproved") : t("researchCancelled")}: {drafted.question}
        </span>
      </div>
    );
  }

  const cleaned = questions.map((one) => one.trim()).filter(Boolean);
  const max = DEPTHS[depth].maxQuestions;
  const approve = () => {
    const plan: ResearchPlan = { question: drafted.question, subQuestions: cleaned, depth, sources };
    answer?.(id, { choices: [PLAN_APPROVE], text: JSON.stringify(plan) });
  };
  const toggleSource = (kind: SourceKind) =>
    setSources((now) => (now.includes(kind) ? (now.length > 1 ? now.filter((one) => one !== kind) : now) : [...now, kind]));

  return (
    <div
      role="group"
      aria-label={t("researchPlanTitle")}
      data-approval={id}
      className="mb-4 overflow-hidden rounded-md border border-rule-strong bg-surface-base"
    >
      <div className="flex items-center gap-2 border-b border-rule px-4 py-2 text-[12px] text-accent-ink">
        <Icon name="magnifying-glass" size={14} className="flex-shrink-0" />
        <span className="font-medium">{t("researchPlanTitle")}</span>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <p className="break-words text-[15px] font-medium text-text-primary">{drafted.question}</p>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[12px] text-text-tertiary">{t("researchSubQuestions")}</legend>
          {questions.map((text, at) => (
            <div key={at} className="flex items-center gap-2">
              <span aria-hidden="true" className="w-4 flex-shrink-0 text-end font-mono text-[11px] text-text-tertiary">
                {at + 1}
              </span>
              <input
                value={text}
                onChange={(event) => setQuestions((now) => now.map((one, i) => (i === at ? event.target.value : one)))}
                aria-label={`${t("researchSubQuestions")} ${at + 1}`}
                className="min-w-0 flex-1 rounded-sm border border-rule bg-surface-canvas px-2.5 py-1.5 text-[14px] text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-focus"
              />
              <button
                type="button"
                aria-label={t("researchRemoveQuestion")}
                title={t("researchRemoveQuestion")}
                disabled={questions.length <= 1}
                onClick={() => setQuestions((now) => now.filter((_, i) => i !== at))}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-sm text-text-tertiary outline-none hover:bg-surface-canvas hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
          {questions.length < max && (
            <button
              type="button"
              onClick={() => setQuestions((now) => [...now, ""])}
              className="ms-6 flex items-center gap-1.5 self-start rounded-sm px-1.5 py-1 text-[13px] text-text-secondary outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus"
            >
              <Icon name="plus" size={14} />
              {t("researchAddQuestion")}
            </button>
          )}
        </fieldset>

        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <div role="radiogroup" aria-label={t("researchDepth")} className="flex flex-col gap-1.5">
            <span className="text-[12px] text-text-tertiary">{t("researchDepth")}</span>
            <div className="flex flex-wrap gap-1.5">
              {DEPTH_IDS.map((one) => (
                <button key={one} type="button" role="radio" aria-checked={depth === one} onClick={() => setDepth(one)} className={chip(depth === one)}>
                  {t(DEPTH_KEY[one])}
                  <span className="ms-1.5 text-[11px] text-text-tertiary">
                    {t("researchMinutes").replace("{n}", String(DEPTHS[one].wallMs / 60_000))}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div role="group" aria-label={t("researchSources")} className="flex flex-col gap-1.5">
            <span className="text-[12px] text-text-tertiary">{t("researchSources")}</span>
            <div className="flex flex-wrap gap-1.5">
              {SOURCE_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="checkbox"
                  aria-checked={sources.includes(kind)}
                  onClick={() => toggleSource(kind)}
                  className={chip(sources.includes(kind))}
                >
                  {t(SOURCE_KEY[kind])}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="dense" disabled={cleaned.length === 0} onClick={approve}>
            {t("researchApprove")}
          </Button>
          <Button variant="ghost" size="dense" onClick={() => answer?.(id, null)}>
            {t("researchCancel")}
          </Button>
        </div>
      </div>
    </div>
  );
}
