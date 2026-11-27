import { useState } from "react";
import { StepLine } from "./StepLine";
import { RailContext } from "./railContext";
import WorkBlock from "./WorkBlock";
import type { SearchStep } from "../types";

const VERB_KEY: Record<string, string> = {
  queued: "subagentQueued",
  running: "subagentRunning",
  done: "subagentDone",
  stopped: "subagentStopped",
  failed: "subagentFailed",
};

/** A child agent run as one rail row. Its own steps and summary open on a click, the rest stays folded. */
export function SubagentCard({ step, t }: { step: SearchStep; t: (key: string) => string }) {
  const [clicked, setClicked] = useState<boolean | null>(null);
  const run = step.subagent;
  if (!run) return null;
  const active = run.status === "running" || run.status === "queued";
  const open = clicked ?? false;
  const count = t(run.toolCount === 1 ? "subagentToolCountOne" : "subagentToolCount").replace("{n}", String(run.toolCount));
  const meta = run.readOnly ? `${count} · ${t("subagentReadOnly")}` : `${count} · ${t("subagentCanEdit")}`;

  const details = (
    <div className="flex flex-col gap-1 pt-1">
      <div className="text-[12px] text-text-tertiary">{t("subagentTask")}</div>
      <p className="m-0 whitespace-pre-wrap break-words text-[13px] text-text-secondary">{run.task}</p>
      {run.steps.length > 0 && (
        <RailContext.Provider value={true}>
          <div role="list" aria-label={t("subagentSteps")} className="ms-1 flex flex-col gap-0.5 border-s border-rule ps-3">
            {run.steps.map((child) => (
              <div role="listitem" key={child.id}>
                <WorkBlock step={child} t={t} />
              </div>
            ))}
          </div>
        </RailContext.Provider>
      )}
      {run.steps.length === 0 && active && <div className="text-[12px] text-text-tertiary">{t("subagentNoSteps")}</div>}
      {run.summary && (
        <>
          <div className="pt-1 text-[12px] text-text-tertiary">{t("subagentSummary")}</div>
          <p className="m-0 whitespace-pre-wrap break-words text-[13px] text-text-secondary">{run.summary}</p>
        </>
      )}
    </div>
  );

  return (
    <div role="group" aria-label={t("subagentTitle")}>
      <StepLine
        verb={t(VERB_KEY[run.status] ?? "subagentDone")}
        target={run.label || run.task}
        meta={meta}
        active={active}
        failed={run.status === "failed"}
        open={open}
        onToggle={() => setClicked(!open)}
        hoverCaret
        details={details}
        t={t}
      />
    </div>
  );
}
export default SubagentCard;
