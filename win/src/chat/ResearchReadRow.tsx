import { useState } from "react";
import SiteBadge from "./SiteBadge";
import { StepLine } from "./StepLine";
import { stepView } from "./stepView";
import { hostnameOf } from "../utils";
import type { ResearchRunView } from "../research/runView";
import type { SearchStep } from "../types";

/** A page read during research: how many notes it gave, the question they answer, and in verbose the quotes. */
export function ResearchReadRow({ step, run, verbose, t }: { step: SearchStep; run: ResearchRunView; verbose: boolean; t: (key: string) => string }) {
  const [clicked, setClicked] = useState<boolean | null>(null);
  const url = step.retryUrl ?? "";
  const host = hostnameOf(url).replace(/^www\./i, "");
  const source = run.sources.find((entry) => entry.url === url);
  const notes = source ? run.notes.filter((note) => note.sourceId === source.id) : [];
  const live = !step.isComplete;
  const asked = notes.find((note) => note.subQuestion)?.subQuestion;
  const question = asked ? run.questions[asked - 1]?.text : undefined;
  const title = source && source.title !== source.url ? source.title : host || url;
  const open = clicked ?? verbose;
  const quotes = notes.length > 0 ? (
    <div className="flex flex-col gap-1.5 ps-[22px]">
      {notes.map((note) => (
        <blockquote
          key={note.id}
          className={`m-0 border-s-2 ps-2.5 text-[12.5px] leading-[18px] ${note.verified === false ? "border-danger/60 text-text-tertiary" : "border-ok text-text-secondary"}`}
        >
          “{note.quote}”
          {note.verified === false && <span className="ms-1.5 text-[11.5px] text-danger">{t("researchQuoteMissing")}</span>}
        </blockquote>
      ))}
    </div>
  ) : null;

  return (
    <StepLine
      verb={
        <span className="flex items-center gap-[7px]">
          <SiteBadge hostname={host} small />
          <span className="swap" key={live ? "live" : "done"}>{stepView(step, t)?.name ?? t("researchStatusRead")}</span>
        </span>
      }
      target={title}
      meta={live ? undefined : notes.length > 0 ? t(notes.length === 1 ? "researchRunNotesOne" : "researchRunNotes").replace("{n}", String(notes.length)) : undefined}
      active={live}
      open={open && Boolean(quotes)}
      onToggle={quotes ? () => setClicked(!open) : undefined}
      hoverCaret
      time={question && !live ? <span className="ms-auto min-w-0 max-w-[38%] flex-none truncate ps-3 text-[12px] text-text-tertiary">{question}</span> : undefined}
      details={quotes}
      t={t}
    />
  );
}
export default ResearchReadRow;
